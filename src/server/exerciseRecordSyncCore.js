// Pure, framework-free core logic for the Keep-exercise -> exerciseRecords +
// Daily Review sync endpoint (api/exercise-record-sync.js). No firebase-admin
// import, so this can be unit-tested directly under `node --test` without
// real Firestore credentials — the endpoint itself is a thin wrapper that
// wires this logic to an actual Firestore write.
//
// Two collaborating layers, per the "exercise = fact layer, daily review =
// projection layer" design (mirrors readingSessions/books vs. the reading
// section, and focusSummary/focusSync vs. the Focus projection):
//   - users/{uid}/exerciseRecords/{date}: the full Keep snapshot (summary +
//     every session), fully OVERWRITTEN on each sync for that date — Keep's
//     page is always "today so far in full", never a delta to append.
//   - dailyReviewDrafts/{date}.fields["exercise.today.totalMinutes"/"activity"]:
//     only ever patched as autoValue/autoValueSource/sourceRevision, exactly
//     like the Focus sync's own fields — a manual edit (manuallyEdited=true)
//     is never touched or overwritten here.
//
// The caller (Cyberboss) is the one holding the actual screenshot bytes, so
// IT computes source.sourceSnapshotHash (e.g. a hash of the image bytes) and
// sends it as an opaque idempotency token — this module never recomputes it
// from the extracted JSON, because two separate vision-model extractions of
// the exact same image are not guaranteed to produce byte-identical JSON.
// Comparing the caller-supplied image hash is what makes "the same
// screenshot sent twice" a true no-op regardless of extraction variance.

import { verifyHmacSignature, isTimestampFresh } from "./focusReviewSyncCore.js";

export const EXERCISE_SYNC_SCHEMA_VERSION = 1;
export const KEEP_EXERCISE_SOURCE = "keep_exercise";

const MAX_DISPLAYED_MINUTES = 24 * 60;
const MAX_CALORIES = 20000;
const MAX_SESSION_DURATION_SECONDS = 24 * 60 * 60;
const MAX_SESSIONS = 60;
const MAX_TITLE_CHARS = 200;
const MAX_DISPLAY_TIME_CHARS = 20;
const MAX_HASH_CHARS = 128;
const MAX_ACTIVITY_SUMMARY_ITEMS = 6;
const MAX_ACTIVITY_SUMMARY_CHARS = 120;

export { verifyHmacSignature, isTimestampFresh };

// --- Request body validation ------------------------------------------------

function isFiniteNonNegative(value, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max;
}

/**
 * Structural + semantic validation of a Keep exercise sync payload. Returns
 * {valid, errors, normalized}. Deliberately rejects rather than guesses on
 * anything ambiguous (spec section 6/19.9) — a rejected payload never
 * reaches Firestore.
 */
export function validateExercisePayload(body) {
  const errors = [];
  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["body must be an object"], normalized: null };
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push("date must be a YYYY-MM-DD string");
  }

  const summary = body.summary && typeof body.summary === "object" ? body.summary : {};
  const sourceDisplayedMinutes = Number(summary.sourceDisplayedMinutes);
  if (!isFiniteNonNegative(sourceDisplayedMinutes, MAX_DISPLAYED_MINUTES)) {
    errors.push("summary.sourceDisplayedMinutes must be a finite number between 0 and 1440");
  }
  const calories = summary.calories === undefined ? 0 : Number(summary.calories);
  if (!isFiniteNonNegative(calories, MAX_CALORIES)) {
    errors.push("summary.calories must be a finite non-negative number");
  }

  const rawSessions = Array.isArray(body.sessions) ? body.sessions : null;
  if (!rawSessions || rawSessions.length === 0) {
    errors.push("sessions must be a non-empty array");
  } else if (rawSessions.length > MAX_SESSIONS) {
    errors.push(`sessions must not exceed ${MAX_SESSIONS} entries`);
  }

  const sessions = [];
  if (rawSessions) {
    rawSessions.forEach((session, index) => {
      if (!session || typeof session !== "object") {
        errors.push(`sessions[${index}] must be an object`);
        return;
      }
      const title = typeof session.title === "string" ? session.title.trim() : "";
      if (!title || title.length > MAX_TITLE_CHARS) {
        errors.push(`sessions[${index}].title must be a non-empty string up to ${MAX_TITLE_CHARS} chars`);
      }
      const durationSeconds = Number(session.durationSeconds);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_SESSION_DURATION_SECONDS) {
        errors.push(`sessions[${index}].durationSeconds must be a finite number between 0 and ${MAX_SESSION_DURATION_SECONDS} (exclusive of 0)`);
      }
      const sessionCalories = session.calories === undefined ? 0 : Number(session.calories);
      if (!isFiniteNonNegative(sessionCalories, MAX_CALORIES)) {
        errors.push(`sessions[${index}].calories must be a finite non-negative number`);
      }
      const displayTime = typeof session.displayTime === "string" ? session.displayTime.trim().slice(0, MAX_DISPLAY_TIME_CHARS) : "";
      if (errors.length === 0 || (title && Number.isFinite(durationSeconds))) {
        sessions.push({ title, durationSeconds: Math.round(durationSeconds), calories: Math.round(sessionCalories), displayTime });
      }
    });
  }

  const source = body.source && typeof body.source === "object" ? body.source : {};
  const sourceSnapshotHash = typeof source.sourceSnapshotHash === "string" ? source.sourceSnapshotHash.trim() : "";
  if (!sourceSnapshotHash || sourceSnapshotHash.length > MAX_HASH_CHARS) {
    errors.push("source.sourceSnapshotHash must be a non-empty string identifying this exact screenshot");
  }

  const timezone = typeof body.timezone === "string" && body.timezone ? body.timezone : "Asia/Shanghai";

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  const durationSecondsTotal = sessions.reduce((sum, item) => sum + item.durationSeconds, 0);
  const sessionsWithIds = sessions.map((session, index) => ({
    id: stableSessionId(date, session, index),
    ...session,
  }));

  const normalized = {
    schemaVersion: EXERCISE_SYNC_SCHEMA_VERSION,
    date,
    timezone,
    summary: {
      // durationSeconds is authoritative from the sessions themselves (spec
      // 4.2) — never trusted from the caller's own total, which could drift
      // from the per-session breakdown.
      durationSeconds: durationSecondsTotal,
      // sourceDisplayedMinutes is Keep's own page-level integer minute count
      // (spec 4.5/4.6) — kept verbatim, never re-derived by rounding
      // durationSeconds, so the daily review shows exactly what Keep showed.
      sourceDisplayedMinutes: Math.round(sourceDisplayedMinutes),
      calories: Math.round(calories),
      // sessionCount is recomputed from the actual session array, not the
      // caller's own count, so it can never disagree with what's stored.
      sessionCount: sessionsWithIds.length,
    },
    sessions: sessionsWithIds,
    source: {
      type: "keep_screenshot",
      sourceSnapshotHash,
    },
  };

  return { valid: true, errors: [], normalized };
}

// A small, fast, non-cryptographic hash (FNV-1a) for deriving a stable
// per-session id from its own content — not a security boundary, just
// change/identity detection so the same logical session keeps the same id
// across a same-day resync.
function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableSessionId(date, session, index) {
  const key = `${date}|${index}|${session.title}|${session.durationSeconds}|${session.displayTime || ""}`;
  return `keep-${fnv1aHex(key)}`;
}

// --- Human-readable activity summary ---------------------------------------

// Strips a Keep session title down to a short, display-only label. This
// feeds ONLY exercise.today.activity (cosmetic/commentary — never a scoring
// input, see reviewDraftSerializer.js's buildLegacyReviewValues, which reads
// exercise.today.totalMinutes/intensity, not activity). Titles commonly look
// like "15分钟马甲线养成 · 高效塑形 第1次" or "燃脂派对 · Club 02 第2次"; this
// strips the trailing "第N次" repeat counter, keeps the text before the
// first "·" (Keep's own title/subtitle separator), and drops a leading
// "N分钟" duration prefix.
function shortenSessionTitle(title) {
  let short = String(title || "").trim();
  short = short.replace(/第\s*\d+\s*次\s*$/u, "").trim();
  const separatorIndex = short.indexOf("·");
  if (separatorIndex >= 0) short = short.slice(0, separatorIndex).trim();
  short = short.replace(/^\d+\s*分钟/u, "").trim();
  return short || String(title || "").trim();
}

/**
 * Builds a short, human-readable activity summary like "燃脂派对
 * ×2、马甲线养成" from a normalized sessions array — grouped by shortened
 * title, most-frequent first, capped so it can never grow unbounded.
 */
export function buildActivitySummary(sessions = []) {
  const counts = new Map();
  for (const session of sessions) {
    const label = shortenSessionTitle(session.title);
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const parts = entries
    .slice(0, MAX_ACTIVITY_SUMMARY_ITEMS)
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label));
  const summary = parts.join("、");
  return summary.length > MAX_ACTIVITY_SUMMARY_CHARS ? `${summary.slice(0, MAX_ACTIVITY_SUMMARY_CHARS)}…` : summary;
}

// --- Daily review field projection ------------------------------------------

/**
 * Builds the ONLY two field patches this sync is allowed to make, plus a
 * lightweight `exerciseSync` metadata block (mirrors focusSummary/focusSync)
 * that carries sessionCount/calories for the Snow-dust commentary payload
 * without it needing to separately read the exerciseRecords collection.
 * Never touches `value`/`manuallyEdited` — exactly like focus-review-sync.
 */
export function buildExerciseFieldPatch(normalized) {
  const activity = buildActivitySummary(normalized.sessions);
  const fieldUpdates = {
    "exercise.today.totalMinutes": {
      autoValue: normalized.summary.sourceDisplayedMinutes,
      autoValueSource: KEEP_EXERCISE_SOURCE,
      sourceRevision: normalized.source.sourceSnapshotHash,
    },
    "exercise.today.activity": {
      autoValue: activity,
      autoValueSource: KEEP_EXERCISE_SOURCE,
      sourceRevision: normalized.source.sourceSnapshotHash,
    },
  };
  const exerciseSync = {
    date: normalized.date,
    sessionCount: normalized.summary.sessionCount,
    calories: normalized.summary.calories,
    durationSeconds: normalized.summary.durationSeconds,
    sourceDisplayedMinutes: normalized.summary.sourceDisplayedMinutes,
    sourceSnapshotHash: normalized.source.sourceSnapshotHash,
    schemaVersion: EXERCISE_SYNC_SCHEMA_VERSION,
  };
  return { fieldUpdates, exerciseSync };
}

/**
 * Applies fieldUpdates onto an existing draft.fields map, only ever touching
 * autoValue/autoValueSource/sourceRevision on the two known field ids — the
 * field's `value`/`manuallyEdited`/`source` (manual-edit bookkeeping) pass
 * through completely untouched, exactly like buildLegacyReviewValues/
 * resolveEffectiveReviewValue expect.
 */
export function applyExerciseFieldUpdates(currentFields = {}, fieldUpdates = {}) {
  const next = { ...currentFields };
  for (const [fieldId, patch] of Object.entries(fieldUpdates)) {
    const existing = next[fieldId] || { value: "", autoValue: "", source: "default", sourceRevision: "", manuallyEdited: false, editedAt: "", updatedAt: "" };
    next[fieldId] = { ...existing, ...patch };
  }
  return next;
}

// --- Idempotency / same-day update semantics --------------------------------

/**
 * True when the incoming screenshot is byte-identical (per Cyberboss's own
 * image hash) to what's already stored for this date — a duplicate send of
 * the SAME screenshot, which must never re-charge/re-append anything (spec
 * 19.3). A DIFFERENT screenshot for the same date (a later, larger Keep
 * snapshot) always returns false here and is treated as a full REPLACE of
 * summary+sessions, never an addition (spec 19.4).
 */
export function isSameSnapshot(existingRecord, sourceSnapshotHash) {
  return Boolean(existingRecord?.source?.sourceSnapshotHash) && existingRecord.source.sourceSnapshotHash === sourceSnapshotHash;
}

/**
 * Defends against the same "stale client autosave silently reverted a
 * correct server write" hazard focus-review-sync.js documents: even when
 * the exerciseRecords doc already has this exact snapshot hash, the draft's
 * own fields might not currently reflect it (e.g. the workbench's full-draft
 * `{merge:true}` autosave landed afterward and reset autoValue). In that
 * case the sync must still repair the draft fields, without touching
 * sourceRevision/value/manuallyEdited.
 */
export function isProjectionMaterialized(currentFields = {}, fieldUpdates = {}) {
  return Object.entries(fieldUpdates).every(([fieldId, patch]) => {
    const state = currentFields[fieldId] || {};
    return state.autoValue === patch.autoValue
      && state.autoValueSource === patch.autoValueSource
      && state.sourceRevision === patch.sourceRevision;
  });
}
