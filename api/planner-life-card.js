// Narrow direct-write endpoint for factual life-card completion. This is not a
// re-planning endpoint: Snow-dust may call it only when the user has already
// stated the fact (e.g. "午饭吃完了"). It can only toggle lunch/dinner/nap-startup
// completion and cannot move/delete/create anything. The write is date-isolated
// just like planner apply, so it works even when the browser has not opened the
// prepared day yet.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { applyPlannerLifeCardCompletion } from "../src/server/plannerLifeCardCompletion.js";
import { resolvePlannerDraftForDate, buildPlannerDateWritePatch } from "../src/schedule/plannerDatePersistence.js";

export const config = { api: { bodyParser: false } };

export async function handlePlannerLifeCardRequest({ db, uid, body = {}, now = new Date() } = {}) {
  const userRef = db.collection("users").doc(uid);
  const date = String(body.date || "").trim();
  return db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const profile = userSnap.exists ? userSnap.data() : {};
    const { draft: targetDraft, source } = resolvePlannerDraftForDate(profile, date);
    if (source === "new") return { ok: false, reason: "planner_day_not_found", date };

    const result = applyPlannerLifeCardCompletion(targetDraft, {
      date,
      cardId: String(body.cardId || "").trim(),
      completed: body.completed !== false,
      now,
    });
    if (!result.ok || result.noop) return result;

    const nextDraft = { ...result.nextDraft, targetDate: date, savedOn: date, updatedAt: now.toISOString() };
    transaction.set(userRef, buildPlannerDateWritePatch(profile, date, nextDraft), { merge: true });
    return { ...result, nextDraft: undefined };
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
    const result = await handlePlannerLifeCardRequest({ db: getDb(), uid, body });
    if (!result.ok) {
      res.status(result.reason === "wrong_date" || result.reason === "planner_day_not_found" ? 409 : 400).json(result);
      return;
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || "internal error" });
  }
}
