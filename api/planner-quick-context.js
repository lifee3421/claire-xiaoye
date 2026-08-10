// Minimal HMAC planner read for Snow-dust's high-frequency direct edits.
// It intentionally skips tracker evidence, templates, shared-ledger expansion
// and sticker synchronization. The model never needs those just to resolve
// “move math +30m”; full /api/planner-context remains the planning/review path.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { buildPlannerContext } from "../src/agent/buildPlannerContext.js";
import { buildPersistedPlannerFallback } from "../src/server/plannerAutonomyContext.js";
import { resolvePlannerDraftForDate } from "../src/schedule/plannerDatePersistence.js";

export const config = { api: { bodyParser: false } };

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function handlePlannerQuickContextRequest({ db, uid, date, now = new Date() } = {}) {
  if (!isDateString(date)) return { outcome: "invalid_date", date };
  const userSnap = await db.collection("users").doc(uid).get();
  const profile = userSnap.exists ? userSnap.data() : {};
  const { draft } = resolvePlannerDraftForDate(profile, date);
  const settings = profile.scheduleAssistantSettings && typeof profile.scheduleAssistantSettings === "object"
    ? profile.scheduleAssistantSettings
    : {};
  const fallback = buildPersistedPlannerFallback({ draft, settings });
  const full = buildPlannerContext({
    date,
    timezone: profile.timezone || draft.timezone || "Asia/Shanghai",
    now,
    draft,
    plan: fallback.plan,
    effectiveStudyTarget: null,
    studyTargetProgress: [],
    dailyFacts: null,
    trackerDefs: [],
    trackerFacts: [],
    trackerFactsStatus: "not_requested",
    reviewContext: {},
  });
  return {
    outcome: "ok",
    context: {
      schemaVersion: full.schemaVersion,
      date: full.date,
      timezone: full.timezone,
      baseRevision: full.baseRevision,
      timeline: full.timeline,
      taskPool: full.taskPool,
      contextSource: "server_quick",
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) { res.status(500).json({ error: "server is not configured" }); return; }

  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];
  if (!isTimestampFresh(timestamp) || !verifyHmacSignature({ secret, timestamp, rawBody, signature })) {
    res.status(401).json({ error: "invalid or expired signature" }); return;
  }
  let body;
  try { body = JSON.parse(rawBody); }
  catch { res.status(400).json({ error: "body is not valid JSON" }); return; }
  const date = typeof body?.date === "string" ? body.date.trim() : "";
  if (!isDateString(date)) { res.status(400).json({ error: "invalid request body", details: ["date must be YYYY-MM-DD"] }); return; }

  try {
    const result = await handlePlannerQuickContextRequest({ db: getDb(), uid, date });
    if (result.outcome !== "ok") { res.status(400).json({ error: "invalid_date", date }); return; }
    res.status(200).json({ context: result.context });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
