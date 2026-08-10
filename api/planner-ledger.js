// HMAC-authenticated shared-ledger endpoint for Snow-dust. The backing store is
// the existing profile.plannerInbox so the browser and Snow edit ONE list.
// This endpoint never touches timeline blocks; direct timeline edits use the
// separate planner-direct-edit endpoint.
import crypto from "node:crypto";
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import {
  addInboxItem,
  archiveInboxItem,
  normalizeInboxItems,
  removeInboxItem,
  updateInboxItem,
} from "../src/utils/plannerInbox.js";

export const config = { api: { bodyParser: false } };

const ACTIONS = new Set(["create", "update", "archive", "delete", "complete", "reopen"]);
const PATCH_KEYS = new Set([
  "title", "categoryId", "estimatedMinutes", "priority", "deadline", "note",
  "kind", "targetDate", "dueAt", "triggerType", "boundBlockId", "reminderId",
  "followupText",
]);

function cleanPatch(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(source).filter(([key]) => PATCH_KEYS.has(key)));
}

function publicItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    source: item.source,
    status: item.status,
    targetDate: item.targetDate,
    dueAt: item.dueAt,
    triggerType: item.triggerType,
    boundBlockId: item.boundBlockId,
    reminderId: item.reminderId,
    followupText: item.followupText,
    completedAt: item.completedAt,
    categoryId: item.categoryId,
    estimatedMinutes: item.estimatedMinutes,
    priority: item.priority,
    deadline: item.deadline,
    note: item.note,
  };
}

export async function handlePlannerLedgerRequest({ db, uid, body = {}, now = new Date() } = {}) {
  const action = String(body.action || "").trim();
  if (!ACTIONS.has(action)) return { ok: false, reason: "invalid_action" };
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(userRef);
    const profile = snap.exists ? snap.data() : {};
    const current = normalizeInboxItems(profile.plannerInbox);
    let next = current;
    let id = String(body.id || "").trim();

    if (action === "create") {
      const patch = cleanPatch(body.item);
      if (!String(patch.title || "").trim()) return { ok: false, reason: "title_required" };
      id = `ledger-${crypto.randomUUID()}`;
      next = addInboxItem(current, { ...patch, id, source: "snowdust" }, { now });
    } else {
      if (!id) return { ok: false, reason: "id_required" };
      const existing = current.find((item) => item.id === id);
      if (!existing) return { ok: false, reason: "not_found", id };
      if (action === "update") next = updateInboxItem(current, id, cleanPatch(body.patch), { now });
      if (action === "archive") next = archiveInboxItem(current, id, { now });
      if (action === "delete") next = removeInboxItem(current, id);
      if (action === "complete") next = updateInboxItem(current, id, { completedAt: now.toISOString(), status: "active" }, { now });
      if (action === "reopen") next = updateInboxItem(current, id, { completedAt: "", status: "active" }, { now });
    }

    transaction.set(userRef, { plannerInbox: next }, { merge: true });
    const item = next.find((entry) => entry.id === id) || null;
    return { ok: true, action, id, item: publicItem(item), removed: action === "delete" };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }
  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ ok: false, error: "server is not configured" });
    return;
  }

  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];
  if (!isTimestampFresh(timestamp) || !verifyHmacSignature({ secret, timestamp, rawBody, signature })) {
    res.status(401).json({ ok: false, error: "invalid or expired signature" });
    return;
  }

  let body;
  try { body = JSON.parse(rawBody); }
  catch { res.status(400).json({ ok: false, error: "body is not valid JSON" }); return; }

  try {
    const result = await handlePlannerLedgerRequest({ db: getDb(), uid, body });
    if (!result.ok) {
      res.status(result.reason === "not_found" ? 404 : 400).json(result);
      return;
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || "internal error" });
  }
}
