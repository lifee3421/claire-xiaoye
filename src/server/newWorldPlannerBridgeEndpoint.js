import { getDb, readRawBody } from "./adminFirestore.js";
import { createHash } from "node:crypto";
import { verifyHmacSignature, isTimestampFresh } from "./hmacAuth.js";
import { buildPlannerUiContext } from "./plannerUiContextEndpoint.js";
import { validateStandaloneMutation, mutateStandaloneMeta } from "./plannerStandaloneEndpoints.js";
import { handlePlannerDraftSidecarRequest, validatePlannerUiProposal } from "./consolidatedPlannerEndpoints.js";
import { commitCanonicalDailyPlannerMutation } from "./canonicalPlannerCommit.js";
import { markInboxItemScheduled } from "../utils/plannerInbox.js";
import { handlePlannerProposalRequest } from "../../api/planner-proposal.js";
import { handlePlannerApplyRequest } from "../../api/planner-apply.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { resolvePlannerDraftForDate } from "../schedule/plannerDatePersistence.js";

export const NEW_WORLD_PLANNER_BRIDGE_PATHS = Object.freeze(new Set([
  "/api/planner-ui-context",
  "/api/planner-standalone-mutate",
  "/api/planner-standalone-meta",
  "/api/planner-draft-sidecar",
  "/api/planner-ui-proposal",
  "/api/planner-ui-proposal-apply",
  "/api/planner-canonical-export",
]));

const PLANNER_CANONICAL_EXPORT_SCHEMA_VERSION = 1;

function plannerDate(value = {}) {
  return typeof value?.targetDate === "string" && value.targetDate
    ? value.targetDate
    : (typeof value?.savedOn === "string" ? value.savedOn : "");
}

function canonicalJsonValue(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.valueOf())) return date.toISOString();
  }
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalJsonValue(value[key])]));
}

function plannerExportFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(canonicalJsonValue(value))).digest("hex");
}

function availablePlannerDates(profile = {}) {
  const rows = [
    profile.scheduleAssistantDraft,
    ...(Array.isArray(profile.scheduleAssistantDraftArchive) ? profile.scheduleAssistantDraftArchive : []),
  ];
  return [...new Set(rows.map(plannerDate).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

function rawPlannerExport(profile = {}, date = "") {
  const { draft, source } = resolvePlannerDraftForDate(profile, date);
  return {
    draft: canonicalJsonValue(draft),
    settings: canonicalJsonValue(profile.scheduleAssistantSettings || {}),
    classificationTaxonomy: canonicalJsonValue(profile.classificationTaxonomy || []),
    plannerCategoryOrder: canonicalJsonValue(profile.plannerCategoryOrder || []),
    plannerInbox: canonicalJsonValue(profile.plannerInbox || []),
    source,
  };
}

/**
 * Read-only migration boundary for New World. The profile is read before and
 * after the UI projection; if its Planner revision changed in between, no
 * mixed snapshot is returned. The caller may safely retry the same request.
 */
export async function buildPlannerCanonicalExport({ db, uid, date, now = new Date() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return { outcome: "invalid_date" };
  }
  const userRef = db.collection("users").doc(uid);
  const firstSnap = await userRef.get();
  const firstProfile = firstSnap.exists ? firstSnap.data() : {};
  const firstRaw = rawPlannerExport(firstProfile, date);
  const firstRevision = computePlannerContextBaseRevision({ draft: firstRaw.draft });

  const projected = await buildPlannerUiContext({ db, uid, date, now });
  if (projected.outcome !== "ok") return projected;

  const finalSnap = await userRef.get();
  const finalProfile = finalSnap.exists ? finalSnap.data() : {};
  const finalRaw = rawPlannerExport(finalProfile, date);
  const finalRevision = computePlannerContextBaseRevision({ draft: finalRaw.draft });
  if (firstRevision !== finalRevision || projected.context?.baseRevision !== finalRevision) {
    return { outcome: "source_changed_during_export", currentRevision: finalRevision };
  }

  const fingerprintInput = {
    schemaVersion: PLANNER_CANONICAL_EXPORT_SCHEMA_VERSION,
    date,
    timezone: projected.context.timezone || finalProfile.timezone || "Asia/Shanghai",
    sourceRevision: finalRevision,
    rawPlanner: finalRaw,
    projection: canonicalJsonValue(projected.context),
  };
  return {
    outcome: "ok",
    export: {
      schemaVersion: PLANNER_CANONICAL_EXPORT_SCHEMA_VERSION,
      source: "claire-xiaoye-canonical-planner",
      date,
      timezone: fingerprintInput.timezone,
      sourceRevision: finalRevision,
      exportedAt: now.toISOString(),
      availableDates: availablePlannerDates(finalProfile),
      rawPlanner: finalRaw,
      projection: fingerprintInput.projection,
      sourceFingerprint: plannerExportFingerprint(fingerprintInput),
    },
  };
}

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function verifyNewWorldPlannerBridge({ headers = {}, rawBody = "", secret = "", now = Date.now() } = {}) {
  const timestamp = headers["x-catkeeper-timestamp"] ?? headers["X-Catkeeper-Timestamp"];
  const signature = headers["x-catkeeper-signature"] ?? headers["X-Catkeeper-Signature"];
  if (!secret) return { ok: false, status: 503, code: "planner_bridge_not_configured" };
  if (!isTimestampFresh(timestamp, now)) return { ok: false, status: 401, code: "stale_signature" };
  if (!verifyHmacSignature({ secret, timestamp, rawBody, signature })) return { ok: false, status: 401, code: "invalid_signature" };
  return { ok: true };
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

function mutationResponse(result) {
  if (result.outcome === "stale") return { status: 409, body: { status: "stale", currentRevision: result.currentRevision } };
  if (result.outcome === "conflict") return { status: 409, body: { status: "conflict", conflicts: result.conflicts } };
  if (result.outcome === "rejected") return { status: 400, body: { status: "rejected", reason: result.reason, problems: result.problems, rejections: result.rejections } };
  return { status: 200, body: { status: "applied", changedBlockIds: result.changedBlockIds, summary: result.summary, appliedRevision: result.appliedRevision } };
}

async function standaloneMutation({ db, uid, body }) {
  const problems = validateStandaloneMutation(body);
  if (problems.length) return { status: 400, body: { status: "rejected", reason: "invalid_standalone_mutation", problems } };
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
  return mutationResponse(result);
}

async function proposalResponse({ db, uid, body }) {
  const problems = validatePlannerUiProposal(body);
  if (problems.length) return { status: 400, body: { status: "rejected", reason: "invalid_proposal", problems } };
  const result = await handlePlannerProposalRequest({ db, uid, body: { ...body, createdBy: "snowdust-newworld" } });
  if (result.status === "rejected") return { status: result.reason === "not_found" ? 404 : 409, body: { status: "rejected", reason: result.reason } };
  return { status: 200, body: result };
}

async function applyResponse({ db, uid, body }) {
  const result = await handlePlannerApplyRequest({ db, uid, body });
  if (result.outcome === "rejected") return { status: result.reason === "not_found" ? 404 : 409, body: { status: "rejected", reason: result.reason, problems: result.problems } };
  if (result.outcome === "stale") return { status: 409, body: { status: "stale", currentRevision: result.currentRevision } };
  if (result.outcome === "conflict") return { status: 409, body: { status: "conflict", conflicts: result.conflicts } };
  if (result.outcome === "noop") return { status: 200, body: { status: "noop", idempotent: true, changedBlockIds: result.changedBlockIds, summary: result.summary, appliedRevision: result.appliedRevision } };
  return { status: 200, body: { status: "applied", changedBlockIds: result.changedBlockIds, summary: result.summary, appliedRevision: result.appliedRevision, ...(result.rebasedEquivalentRevision ? { rebasedEquivalentRevision: true } : {}) } };
}

export async function dispatchNewWorldPlannerBridge({ db, uid, path, body = {} } = {}) {
  if (!NEW_WORLD_PLANNER_BRIDGE_PATHS.has(path)) return { status: 404, body: { error: "planner bridge path not allowed" } };

  if (path === "/api/planner-ui-context") {
    const result = await buildPlannerUiContext({ db, uid, date: String(body.date || "").trim() });
    return result.outcome === "ok"
      ? { status: 200, body: result }
      : { status: 400, body: { error: result.outcome } };
  }
  if (path === "/api/planner-canonical-export") {
    const result = await buildPlannerCanonicalExport({ db, uid, date: String(body.date || "").trim() });
    if (result.outcome === "ok") return { status: 200, body: result };
    if (result.outcome === "source_changed_during_export") {
      return { status: 409, body: { status: "stale", reason: result.outcome, currentRevision: result.currentRevision } };
    }
    return { status: 400, body: { error: result.outcome } };
  }
  if (path === "/api/planner-standalone-mutate") return standaloneMutation({ db, uid, body });
  if (path === "/api/planner-standalone-meta") {
    const result = await mutateStandaloneMeta({ db, uid, body });
    if (result.outcome === "stale") return { status: 409, body: { status: "stale", currentRevision: result.currentRevision } };
    if (result.outcome === "rejected") return { status: 400, body: { status: "rejected", reason: result.reason } };
    return { status: 200, body: { status: "saved" } };
  }
  if (path === "/api/planner-draft-sidecar") {
    const result = await handlePlannerDraftSidecarRequest({ db, uid, body });
    if (result.outcome === "rejected") return { status: 400, body: { status: "rejected", problems: result.problems } };
    return { status: 200, body: { status: "saved", date: result.date } };
  }
  if (path === "/api/planner-ui-proposal") return proposalResponse({ db, uid, body });
  return applyResponse({ db, uid, body });
}

export async function newWorldPlannerBridgeHandler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = String(process.env.CATKEEPER_USER_UID || "").trim();
  if (!secret || !uid) { res.status(503).json({ error: "planner bridge server is not configured" }); return; }

  const rawBody = await readRawBody(req);
  const auth = verifyNewWorldPlannerBridge({
    headers: {
      "x-catkeeper-timestamp": header(req, "x-catkeeper-timestamp"),
      "x-catkeeper-signature": header(req, "x-catkeeper-signature"),
    },
    rawBody,
    secret,
  });
  if (!auth.ok) { res.status(auth.status).json({ error: auth.code }); return; }

  let envelope;
  try { envelope = JSON.parse(rawBody); }
  catch { res.status(400).json({ error: "body is not valid JSON" }); return; }
  const path = String(envelope?.path || "").trim();
  const body = envelope?.body && typeof envelope.body === "object" && !Array.isArray(envelope.body) ? envelope.body : {};

  try {
    const result = await dispatchNewWorldPlannerBridge({ db: getDb(), uid, path, body });
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: error?.message || "planner bridge internal error" });
  }
}
