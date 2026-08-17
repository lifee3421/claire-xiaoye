// Firebase-authenticated read adapter for the standalone SnowDustApp Today surface.
//
// This endpoint is deliberately presentation-agnostic and side-effect free:
// it reads the same persisted dated Planner draft that Snow-dust and the
// desktop planner use, projects the already-saved timeline/task-pool state,
// and returns a compact UI context. It never creates a second planner store
// and never runs the tracker-sticker sync side effect used by the AI's full
// PlannerContext endpoint.
import { getAuth } from "firebase-admin/auth";
import { getDb } from "../src/server/adminFirestore.js";
import { buildPersistedPlannerFallback } from "../src/server/plannerAutonomyContext.js";
import { resolvePlannerDraftForDate } from "../src/schedule/plannerDatePersistence.js";
import { resolvePlannerTimelineBounds } from "../src/schedule/plannerLiveTimeline.js";
import { computePlannerContextBaseRevision } from "../src/agent/buildPlannerContext.js";
import { selectSharedLedgerItems } from "../src/utils/plannerInbox.js";
import { isLivePlanBlock } from "../src/schedule/baselinePlanModel.js";

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
}

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function compactLedgerItem(item = {}) {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    source: item.source,
    status: item.status,
    categoryId: item.categoryId || "personal",
    estimatedMinutes: item.estimatedMinutes ?? null,
    priority: item.priority ?? 2,
    note: item.note || "",
    targetDate: item.targetDate || null,
    dueAt: item.dueAt || null,
    triggerType: item.triggerType || "none",
    boundBlockId: item.boundBlockId || null,
    reminderId: item.reminderId || null,
    followupText: item.followupText || null,
    completedAt: item.completedAt || null,
  };
}

function richSystemCard(card, draft) {
  const override = draft?.todaySegmentOverrides?.[card.id]
    || draft?.todaySegmentOverrides?.[`${card.id}-1`]
    || {};
  return {
    ...card,
    kind: "fixed",
    status: override.status || "pending",
    locked: override.locked ?? true,
    protected: true,
  };
}

function baselineBlocks(draft) {
  const snapshot = draft?.baselinePlanSnapshot;
  if (!snapshot || snapshot.targetDate !== draft?.targetDate || !Array.isArray(snapshot.blocks)) return [];
  return snapshot.blocks
    .filter((block) => block && (block.kind === "task" || block.kind == null) && isLivePlanBlock(block))
    .map((block) => ({
      id: block.id,
      start: Number(block.start),
      end: Number(block.end),
      categoryId: block.categoryId || null,
      category: block.category || block.categoryName || "",
      categoryColor: block.categoryColor || "",
    }))
    .filter((block) => Number.isFinite(block.start) && Number.isFinite(block.end) && block.end > block.start);
}

async function loadReadingContext(userRef) {
  const [booksSnap, readingSessionsSnap] = await Promise.all([
    userRef.collection("books").get(),
    userRef.collection("readingSessions").orderBy("date", "desc").limit(40).get(),
  ]);
  return {
    books: booksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    readingSessions: readingSessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
}

export async function buildPlannerUiContext({ db, uid, date, now = new Date() } = {}) {
  if (!isDateString(date)) return { outcome: "invalid_date" };
  const userRef = db.collection("users").doc(uid);
  const [profileSnap, reading] = await Promise.all([
    userRef.get(),
    loadReadingContext(userRef),
  ]);
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const { draft, source } = resolvePlannerDraftForDate(profile, date);
  const settings = profile.scheduleAssistantSettings && typeof profile.scheduleAssistantSettings === "object"
    ? profile.scheduleAssistantSettings
    : {};
  const fallback = buildPersistedPlannerFallback({
    draft,
    settings,
    books: reading.books,
    readingSessions: reading.readingSessions,
  });
  const { timelineStart, timelineEnd } = resolvePlannerTimelineBounds(draft);
  const taskBlocks = (Array.isArray(fallback.plan?.blocks) ? fallback.plan.blocks : [])
    .filter(isLivePlanBlock)
    .map((block) => ({ ...block, kind: block.kind || "task" }));
  const systemCards = (Array.isArray(fallback.systemCards) ? fallback.systemCards : [])
    .map((card) => richSystemCard(card, draft));
  const sharedLedger = selectSharedLedgerItems(profile.plannerInbox, date).map(compactLedgerItem);
  const followup = sharedLedger.find((item) => item.kind === "followup") || null;

  return {
    outcome: "ok",
    context: {
      schemaVersion: 1,
      date,
      timezone: profile.timezone || draft.timezone || "Asia/Shanghai",
      generatedAt: now.toISOString(),
      source,
      baseRevision: computePlannerContextBaseRevision({ draft }),
      timelineStart,
      timelineEnd,
      timelineBlocks: [...taskBlocks, ...systemCards].sort((a, b) => Number(a.start) - Number(b.start)),
      taskPool: Array.isArray(fallback.plan?.poolSegments) ? fallback.plan.poolSegments : [],
      baseline: baselineBlocks(draft),
      sharedLedger,
      followup,
      templates: Array.isArray(fallback.templates) ? fallback.templates : [],
      constraints: {
        hasBaseline: Boolean(draft?.baselinePlanSnapshot?.targetDate === date),
      },
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  try {
    const db = getDb();
    const token = bearerToken(req);
    if (!token) { res.status(401).json({ error: "missing bearer token" }); return; }
    const decoded = await getAuth().verifyIdToken(token);
    const uid = String(decoded?.uid || "").trim();
    if (!uid) { res.status(401).json({ error: "invalid bearer token" }); return; }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (!isDateString(date)) { res.status(400).json({ error: "date must be YYYY-MM-DD" }); return; }
    const result = await buildPlannerUiContext({ db, uid, date });
    if (result.outcome !== "ok") { res.status(400).json({ error: result.outcome }); return; }
    res.status(200).json(result);
  } catch (error) {
    const code = String(error?.code || "");
    if (code.startsWith("auth/")) { res.status(401).json({ error: "invalid bearer token" }); return; }
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
