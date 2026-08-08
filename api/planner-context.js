// Vercel serverless endpoint. Snow-dust calls this when it needs a
// PlannerContext for a date but has no usable cached copy yet. The response
// uses the same PlannerContext schema as the browser push.
//
// IMPORTANT: scheduleAssistantDraft on the USER document is the planner's
// source of truth. dailyReviewDrafts/{date} is the evening-review workspace
// and must never be used to compute PlannerContext.baseRevision. The apply
// endpoint reads profile.scheduleAssistantDraft too; using the same source on
// both sides is what makes a pulled baseRevision meaningful.
//
// This server fallback still does not run the browser's full
// buildAutoSchedulePlan placement engine, so timeline/taskPool/capacity are
// intentionally empty. Browser push remains the rich fast path; this endpoint
// is the authoritative revision/targets/tracker fallback.
//
// Auth: same HMAC-SHA256 scheme as api/planner-apply.js (POST body signed
// with CATKEEPER_PLANNER_BRIDGE_SECRET, falling back to the existing Focus
// secret). Body: { date: "YYYY-MM-DD" }.

import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { buildPlannerContext } from "../src/agent/buildPlannerContext.js";
import { resolveEffectiveTrackers } from "../src/utils/trackerDefaults.js";
import { resolveTrackerEvidence } from "../src/utils/trackerFacts.js";
import { resolveDailyStudyTargets, resolveEffectiveTarget } from "../src/schedule/studyTargetResolver.js";

export const config = { api: { bodyParser: false } };

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function plannerDraftDate(draft) {
  return typeof draft?.targetDate === "string" && draft.targetDate
    ? draft.targetDate
    : (typeof draft?.savedOn === "string" ? draft.savedOn : "");
}

/**
 * Resolve a persisted planner draft for a date without ever looking at the
 * Daily Review collection. The live draft wins; archive is a read-only
 * fallback for older dates.
 */
export function resolvePersistedPlannerDraft(profile = {}, date = "") {
  const live = profile?.scheduleAssistantDraft && typeof profile.scheduleAssistantDraft === "object"
    ? profile.scheduleAssistantDraft
    : {};
  if (plannerDraftDate(live) === date) return live;

  const archive = Array.isArray(profile?.scheduleAssistantDraftArchive)
    ? profile.scheduleAssistantDraftArchive
    : [];
  const archived = archive.find((item) => plannerDraftDate(item) === date);
  return archived && typeof archived === "object" ? archived : { targetDate: date };
}

/**
 * Fetches all CompletionEvents for `date` and groups them by trackerId so
 * that resolveTrackerEvidence can compute per-tracker facts.
 */
async function loadTrackerFactsForDate(db, uid, trackers, date) {
  const snapshot = await db.collection("users").doc(uid).collection("completionEvents")
    .where("occurredOn", "==", date)
    .where("state", "==", "active")
    .get();
  const eventsByTracker = new Map();
  for (const docSnap of snapshot.docs) {
    const event = { id: docSnap.id, ...docSnap.data() };
    if (!eventsByTracker.has(event.trackerId)) eventsByTracker.set(event.trackerId, []);
    eventsByTracker.get(event.trackerId).push(event);
  }
  return trackers.map((tracker) =>
    resolveTrackerEvidence(tracker, { events: eventsByTracker.get(tracker.id) || [], today: date }),
  );
}

/**
 * Core logic, exported for unit testing. Reads Firestore, builds and returns
 * a PlannerContext for `date`. This endpoint is strictly read-only.
 */
export async function handlePlannerContextRequest({ db, uid, date, now = new Date() } = {}) {
  if (!isDateString(date)) return { outcome: "invalid_date", date };

  // One read supplies BOTH planner draft and planner settings/defaults. This
  // mirrors api/planner-apply.js, which also treats the user document as the
  // schedule authority.
  const profileSnap = await db.collection("users").doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const draft = resolvePersistedPlannerDraft(profile, date);

  const trackers = resolveEffectiveTrackers(profile);
  const trackerFacts = await loadTrackerFactsForDate(db, uid, trackers, date);

  const draftResolved = resolveDailyStudyTargets({
    defaults: profile.studyTargetDefaults,
    overrides: draft.studyTargetOverrides,
  });
  const effectiveStudyTarget = resolveEffectiveTarget({
    snapshot: draft.studyTargetSnapshot,
    draftResolved,
  });

  const timezone = profile.timezone || draft.timezone || "Asia/Shanghai";

  const context = buildPlannerContext({
    date,
    timezone,
    now,
    draft,
    plan: {},
    effectiveStudyTarget,
    studyTargetProgress: [],
    dailyFacts: null,
    trackerDefs: trackers,
    trackerFacts,
    trackerFactsStatus: "ready",
    reviewContext: {},
  });

  return { outcome: "ok", context };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_PLANNER_BRIDGE_SECRET/CATKEEPER_FOCUS_SYNC_SECRET or CATKEEPER_USER_UID)" });
    return;
  }

  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];

  if (!isTimestampFresh(timestamp)) {
    res.status(401).json({ error: "timestamp missing or outside the allowed window" });
    return;
  }
  if (!verifyHmacSignature({ secret, timestamp, rawBody, signature })) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "body is not valid JSON" });
    return;
  }

  const date = typeof body?.date === "string" ? body.date.trim() : "";
  if (!isDateString(date)) {
    res.status(400).json({ error: "invalid request body", details: ["date must be YYYY-MM-DD"] });
    return;
  }

  try {
    const result = await handlePlannerContextRequest({ db: getDb(), uid, date });
    if (result.outcome !== "ok") {
      res.status(400).json({ error: "invalid_date", date });
      return;
    }
    res.status(200).json({ context: result.context });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
