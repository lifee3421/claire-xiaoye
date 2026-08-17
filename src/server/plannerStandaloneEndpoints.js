import { getAuth } from "firebase-admin/auth";
import { getDb } from "./adminFirestore.js";
import { validatePlannerPatchShape, PLANNER_PATCH_SCHEMA_VERSION } from "../agent/plannerPatch.js";
import { commitCanonicalDailyPlannerMutation } from "./canonicalPlannerCommit.js";
import { resolvePlannerDraftForDate, buildPlannerDateWritePatch } from "../schedule/plannerDatePersistence.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { resolvePlannerTimelineBounds, resolveMorningPrepMinutes, resolveSystemCardIntervals } from "../schedule/plannerLiveTimeline.js";
import { addInboxItem, updateInboxItem, markInboxItemScheduled } from "../utils/plannerInbox.js";
import { resolveMovableSegments } from "../schedule/plannerPatchApply.js";
import { buildScheduledTaskBlockFromSegment } from "../utils/plannerTimelineBlocks.js";
import { buildTemplateSnapshotContent, mergeTemplateSnapshotContent, defaultTemplateSaveScopes } from "../utils/plannerTemplateSnapshot.js";
import { isLivePlanBlock } from "../schedule/baselinePlanModel.js";

const STANDALONE_DIRECT_TYPES = new Set([
  "move",
  "return_to_pool",
  "schedule_from_pool",
  "create_task",
  "edit_task",
  "delete_task",
  "set_pool_order",
]);
export const MAX_STANDALONE_CHANGES = 40;

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
}

async function requireUid(req, res) {
  const token = bearerToken(req);
  if (!token) { res.status(401).json({ error: "missing bearer token" }); return ""; }
  const decoded = await getAuth().verifyIdToken(token);
  const uid = String(decoded?.uid || "").trim();
  if (!uid) { res.status(401).json({ error: "invalid bearer token" }); return ""; }
  return uid;
}

async function loadKernelContext(userRef) {
  const [booksSnap, readingSessionsSnap] = await Promise.all([
    userRef.collection("books").get(),
    userRef.collection("readingSessions").get(),
  ]);
  return {
    books: booksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    readingSessions: readingSessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
}

export function validateStandaloneMutation(body = {}) {
  const operationId = String(body.operationId || "").trim();
  const date = String(body.date || "").trim();
  const baseRevision = String(body.baseRevision || "").trim();
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const problems = validatePlannerPatchShape({ schemaVersion: PLANNER_PATCH_SCHEMA_VERSION, date, baseRevision, changes });
  if (!operationId) problems.push("operationId is required");
  if (changes.length > MAX_STANDALONE_CHANGES) problems.push(`standalone Today accepts at most ${MAX_STANDALONE_CHANGES} changes per interaction`);
  changes.forEach((change, index) => {
    if (!STANDALONE_DIRECT_TYPES.has(change?.type)) problems.push(`changes[${index}] type ${String(change?.type || "<missing>")} is not a standalone direct mutation`);
  });
  if (body.inboxTransition !== undefined) {
    const transition = body.inboxTransition;
    const itemId = String(transition?.itemId || "").trim();
    const taskId = String(transition?.taskId || "").trim();
    if (!itemId || !taskId) problems.push("inboxTransition requires itemId and taskId");
    const matchingCreate = changes.find((change) => change?.type === "create_task"
      && String(change.taskId || "") === taskId
      && String(change.originInboxItemId || change.sourceId || "") === itemId
      && String(change.source || "") === "inbox");
    if (!matchingCreate) problems.push("inboxTransition must match an inbox-sourced create_task");
  }
  return problems;
}

export async function plannerStandaloneMutateHandler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const db = getDb();
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const problems = validateStandaloneMutation(body);
    if (problems.length) { res.status(400).json({ status: "rejected", reason: "invalid_standalone_mutation", problems }); return; }
    const date = String(body.date).trim();
    const userRef = db.collection("users").doc(uid);
    const { books, readingSessions } = await loadKernelContext(userRef);
    const transition = body.inboxTransition && typeof body.inboxTransition === "object"
      ? { itemId: String(body.inboxTransition.itemId), taskId: String(body.inboxTransition.taskId) }
      : null;
    const result = await commitCanonicalDailyPlannerMutation({
      db,
      uid,
      date,
      baseRevision: String(body.baseRevision),
      changes: body.changes,
      operationId: String(body.operationId),
      operationKind: "snowdust-today-standalone",
      books,
      readingSessions,
      ...(transition ? {
        onApplied: ({ transaction, userRef: transactionUserRef, profile }) => {
          const plannerInbox = markInboxItemScheduled(profile.plannerInbox, transition.itemId, { targetDate: date, taskId: transition.taskId });
          transaction.set(transactionUserRef, { plannerInbox }, { merge: true });
        },
      } : {}),
    });
    if (result.outcome === "stale") { res.status(409).json({ status: "stale", currentRevision: result.currentRevision }); return; }
    if (result.outcome === "conflict") { res.status(409).json({ status: "conflict", conflicts: result.conflicts }); return; }
    if (result.outcome === "rejected") { res.status(400).json({ status: "rejected", reason: result.reason, problems: result.problems, rejections: result.rejections }); return; }
    res.status(200).json({ status: "applied", changedBlockIds: result.changedBlockIds, summary: result.summary, appliedRevision: result.appliedRevision });
  } catch (error) {
    const code = String(error?.code || "");
    if (code.startsWith("auth/")) { res.status(401).json({ error: "invalid bearer token" }); return; }
    res.status(500).json({ error: error?.message || "internal error" });
  }
}

function safeDayTemplates(settings = {}) {
  return Array.isArray(settings.dayTemplates) ? settings.dayTemplates.filter((item) => item && typeof item === "object") : [];
}

function uniqueTaskGroups(segments = []) {
  const map = new Map();
  segments.forEach((segment) => {
    const task = segment?.taskGroup;
    if (task?.id && !map.has(task.id)) map.set(task.id, task);
  });
  return [...map.values()];
}

function normalizeTemplateScopes(value = {}, fallback = defaultTemplateSaveScopes) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(defaultTemplateSaveScopes).map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(source, key) ? Boolean(source[key]) : Boolean(fallback[key]),
  ]));
}

async function buildTemplateContent({ userRef, draft, settings, scopes }) {
  const { books, readingSessions } = await loadKernelContext(userRef);
  const segments = resolveMovableSegments(draft, settings, { books, readingSessions });
  const blocks = segments
    .filter((segment) => segment.placement === "timeline" && Number.isFinite(Number(segment.manualStart)))
    .map((segment) => buildScheduledTaskBlockFromSegment(segment, { start: Number(segment.manualStart) }))
    .filter(isLivePlanBlock);
  return buildTemplateSnapshotContent({
    draft,
    autoSchedule: { taskGroups: uniqueTaskGroups(segments), blocks },
    scopes,
  });
}

function templateId(prefix = "tpl-user") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function mutateStandaloneMeta({ db, uid, body = {}, now = new Date() }) {
  const action = String(body.action || "").trim();
  const date = String(body.date || "").trim();
  const userRef = db.collection("users").doc(uid);

  if (action === "inbox_create") {
    const title = String(body.title || "").trim();
    const kind = ["task", "note", "followup"].includes(body.kind) ? body.kind : "task";
    if (!title) return { outcome: "rejected", reason: "title_required" };
    return db.runTransaction(async (transaction) => {
      const snap = await transaction.get(userRef);
      const profile = snap.exists ? snap.data() : {};
      const plannerInbox = addInboxItem(profile.plannerInbox, {
        title,
        kind,
        source: "user",
        targetDate: date,
        estimatedMinutes: body.estimatedMinutes,
        priority: body.priority,
        categoryId: body.categoryId || "personal",
        note: body.note || "",
        triggerType: body.triggerType,
        dueAt: body.dueAt,
        boundBlockId: body.boundBlockId,
        followupText: body.followupText,
      }, { now });
      transaction.set(userRef, { plannerInbox }, { merge: true });
      return { outcome: "saved" };
    });
  }

  if (action === "inbox_set_done") {
    const itemId = String(body.itemId || "").trim();
    if (!itemId) return { outcome: "rejected", reason: "item_required" };
    return db.runTransaction(async (transaction) => {
      const snap = await transaction.get(userRef);
      const profile = snap.exists ? snap.data() : {};
      const done = Boolean(body.done);
      const plannerInbox = updateInboxItem(profile.plannerInbox, itemId, {
        status: done ? "archived" : "active",
        completedAt: done ? now.toISOString() : "",
      }, { now });
      transaction.set(userRef, { plannerInbox }, { merge: true });
      return { outcome: "saved" };
    });
  }

  if (action === "system_card_status") {
    const blockId = String(body.blockId || "").trim();
    const status = body.status === "completed" ? "completed" : "pending";
    const baseRevision = String(body.baseRevision || "").trim();
    if (!blockId || !baseRevision || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { outcome: "rejected", reason: "invalid_system_card_request" };
    return db.runTransaction(async (transaction) => {
      const snap = await transaction.get(userRef);
      const profile = snap.exists ? snap.data() : {};
      const { draft } = resolvePlannerDraftForDate(profile, date);
      const currentRevision = computePlannerContextBaseRevision({ draft });
      if (currentRevision !== baseRevision) return { outcome: "stale", currentRevision };
      const { timelineStart, timelineEnd } = resolvePlannerTimelineBounds(draft);
      const cards = resolveSystemCardIntervals({ draft, timelineStart, timelineEnd, effectiveMorningPrepMinutes: resolveMorningPrepMinutes(draft) });
      if (!cards.some((card) => String(card.id) === blockId)) return { outcome: "rejected", reason: "not_system_card" };
      const nextDraft = {
        ...draft,
        todaySegmentOverrides: {
          ...(draft.todaySegmentOverrides || {}),
          [blockId]: { ...(draft.todaySegmentOverrides?.[blockId] || {}), status },
        },
      };
      transaction.set(userRef, buildPlannerDateWritePatch(profile, date, nextDraft), { merge: true });
      return { outcome: "saved" };
    });
  }

  if (["template_save", "template_copy", "template_set_default"].includes(action)) {
    const snap = await userRef.get();
    const profile = snap.exists ? snap.data() : {};
    const settings = profile.scheduleAssistantSettings && typeof profile.scheduleAssistantSettings === "object" ? profile.scheduleAssistantSettings : {};
    const templates = safeDayTemplates(settings);
    let nextTemplates = templates;
    let nextDefault = settings.defaultDayTemplateId || templates.find((item) => item?.isDefault)?.id || null;

    if (action === "template_set_default") {
      const id = String(body.templateId || "").trim();
      if (!templates.some((item) => String(item.id) === id)) return { outcome: "rejected", reason: "template_not_found" };
      nextDefault = id;
      nextTemplates = templates.map((item) => ({ ...item, isDefault: String(item.id) === id }));
    }

    if (action === "template_copy") {
      const id = String(body.templateId || "").trim();
      const source = templates.find((item) => String(item.id) === id);
      if (!source) return { outcome: "rejected", reason: "template_not_found" };
      nextTemplates = [...templates, { ...structuredClone(source), id: templateId("tpl-copy"), name: `${source.name || "模板"} 副本`, isDefault: false, builtin: false }];
    }

    if (action === "template_save") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { outcome: "rejected", reason: "invalid_date" };
      const name = String(body.name || "").trim();
      if (!name) return { outcome: "rejected", reason: "template_name_required" };
      const { draft } = resolvePlannerDraftForDate(profile, date);
      const scopes = normalizeTemplateScopes(body.scopes);
      const content = await buildTemplateContent({ userRef, draft, settings, scopes });
      const requestedId = String(body.templateId || "").trim();
      const existing = templates.find((item) => String(item.id) === requestedId) || null;
      if (existing) {
        const updated = {
          ...existing,
          name,
          description: String(body.description ?? existing.description ?? "").trim(),
          content: mergeTemplateSnapshotContent(existing.content || existing, content, scopes),
        };
        nextTemplates = templates.map((item) => String(item.id) === requestedId ? updated : item);
      } else {
        const id = templateId();
        nextTemplates = [...templates, { id, name, description: String(body.description || "").trim(), isDefault: false, builtin: false, content }];
      }
    }

    await userRef.set({
      scheduleAssistantSettings: {
        ...settings,
        dayTemplates: nextTemplates,
        ...(nextDefault ? { defaultDayTemplateId: nextDefault } : {}),
      },
    }, { merge: true });
    return { outcome: "saved" };
  }

  return { outcome: "rejected", reason: "unknown_action" };
}

export async function plannerStandaloneMetaHandler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const db = getDb();
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await mutateStandaloneMeta({ db, uid, body });
    if (result.outcome === "stale") { res.status(409).json({ status: "stale", currentRevision: result.currentRevision }); return; }
    if (result.outcome === "rejected") { res.status(400).json({ status: "rejected", reason: result.reason }); return; }
    res.status(200).json({ status: "saved" });
  } catch (error) {
    const code = String(error?.code || "");
    if (code.startsWith("auth/")) { res.status(401).json({ error: "invalid bearer token" }); return; }
    res.status(500).json({ error: error?.message || "internal error" });
  }
}