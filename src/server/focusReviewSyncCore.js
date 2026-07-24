// Pure, framework-free core logic for the Focus -> Daily Review sync
// endpoint (api/focus-review-sync.js). Deliberately has NO firebase-admin
// import and no Node-`crypto`-only APIs beyond what `node:crypto` exposes,
// so it can be unit-tested directly under plain `node --test` without any
// real Firestore credentials — the endpoint itself is a thin wrapper that
// wires this logic to an actual Firestore transaction.
//
// Everything here operates on categoryId, never a raw fieldId or Firestore
// path supplied by the request — the CALLER (Cyberboss) sends only
// categoryId + session data; THIS module decides which fields exist and how
// they map, using the app's own REVIEW_BINDINGS / live reviewConfig. That is
// the actual enforcement of "the request cannot target an arbitrary path or
// fieldId" — there is structurally no field in the request schema that could
// carry one.

import { createHmac, timingSafeEqual } from "node:crypto";
import { findCanonicalNode, REVIEW_BINDINGS } from "../taxonomy/taxonomyContract.js";
import { resolveBoundFieldIds } from "../review/reviewTaxonomyModel.js";

export const FOCUS_SYNC_SCHEMA_VERSION = 1;
export const UNMAPPED_CATEGORY_ID = "unmapped";
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

// --- Authentication -------------------------------------------------------

/**
 * Timing-safe HMAC-SHA256 verification of `${timestamp}.${rawBody}`.
 * `rawBody` MUST be the exact raw request body text (not a re-serialized
 * JSON.stringify of the parsed object) — signature verification must happen
 * against the bytes that were actually signed.
 */
export function verifyHmacSignature({ secret, timestamp, rawBody, signature }) {
  if (!secret || !timestamp || !rawBody || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(String(signature), "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function isTimestampFresh(timestamp, nowMs = Date.now(), maxSkewMs = MAX_TIMESTAMP_SKEW_MS) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= maxSkewMs;
}

// --- Request body validation -----------------------------------------------

/**
 * Structural + semantic validation of the projection payload. Returns
 * {valid, errors, sessions} — `sessions` is the validated, as-is session
 * list (never rewritten/reshaped here; that happens in buildFieldPatches).
 */
export function validateProjectionPayload(body, { date } = {}) {
  const errors = [];
  if (!body || typeof body !== "object") return { valid: false, errors: ["body must be an object"], sessions: [] };
  if (Number(body.schemaVersion) !== FOCUS_SYNC_SCHEMA_VERSION) errors.push(`unsupported schemaVersion: ${body.schemaVersion}`);
  if (body.source !== "ticktick_focus") errors.push(`unsupported source: ${body.source}`);
  if (!isValidCalendarDate(body.date)) errors.push("date must be a real YYYY-MM-DD calendar date");
  if (date && body.date !== date) errors.push(`date does not match the target draft date (${date})`);
  if (typeof body.sourceRevision !== "string" || !body.sourceRevision) errors.push("sourceRevision is required");
  if (!Array.isArray(body.sessions)) errors.push("sessions must be an array");

  const sessions = Array.isArray(body.sessions) ? body.sessions : [];
  const seenIds = new Set();
  const timezone = typeof body.timezone === "string" && body.timezone ? body.timezone : "Asia/Shanghai";

  sessions.forEach((session, index) => {
    const prefix = `sessions[${index}]`;
    if (!session || typeof session !== "object") { errors.push(`${prefix} must be an object`); return; }
    if (!session.sessionId) errors.push(`${prefix}.sessionId is required`);
    else if (seenIds.has(session.sessionId)) errors.push(`${prefix}.sessionId is not unique: ${session.sessionId}`);
    else seenIds.add(session.sessionId);

    const categoryId = session.categoryId;
    if (categoryId !== UNMAPPED_CATEGORY_ID && !findCanonicalNode(categoryId)) {
      errors.push(`${prefix}.categoryId is not a canonical id or "unmapped": ${categoryId}`);
    }

    const minutes = Number(session.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) errors.push(`${prefix}.minutes must be a non-negative finite number`);

    const startedAtMs = Date.parse(session.startedAt);
    const endedAtMs = Date.parse(session.endedAt);
    if (!Number.isFinite(startedAtMs)) errors.push(`${prefix}.startedAt is not a valid timestamp`);
    if (!Number.isFinite(endedAtMs)) errors.push(`${prefix}.endedAt is not a valid timestamp`);
    if (Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) && endedAtMs <= startedAtMs) {
      errors.push(`${prefix}.endedAt must be after startedAt`);
    }
    if (Number.isFinite(startedAtMs) && body.date) {
      const localDate = localDateKey(startedAtMs, timezone);
      if (localDate !== body.date) errors.push(`${prefix} does not belong to the target local date (${body.date}), got ${localDate}`);
    }
  });

  return { valid: errors.length === 0, errors, sessions };
}

function isValidCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localDateKey(ms, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

// --- Aggregation ------------------------------------------------------------

/**
 * Groups validated sessions by categoryId, summing minutes and collecting a
 * chronological, deduped, non-empty note timeline per category. Unmapped
 * sessions are aggregated separately (never merged into any real category).
 */
export function aggregateSessionsByCategory(sessions) {
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const byCategory = new Map();
  const unmapped = [];

  for (const session of sorted) {
    if (session.categoryId === UNMAPPED_CATEGORY_ID) {
      unmapped.push({ sessionId: session.sessionId, rawTaskId: session.rawTaskId || null, rawTitle: session.rawTitle || null, startedAt: session.startedAt, endedAt: session.endedAt, minutes: Math.round(Number(session.minutes) || 0) });
      continue;
    }
    if (!byCategory.has(session.categoryId)) byCategory.set(session.categoryId, { minutes: 0, sessionCount: 0, noteEntries: [] });
    const bucket = byCategory.get(session.categoryId);
    bucket.minutes += Math.round(Number(session.minutes) || 0);
    bucket.sessionCount += 1;
    const text = typeof session.note === "string" ? session.note.replace(/\s+/g, " ").trim() : "";
    if (text) bucket.noteEntries.push({ text, startedAt: session.startedAt, endedAt: session.endedAt });
  }

  // Dedupe by exact TEXT content (not by the formatted line, which would
  // always differ by timestamp) — keep the chronologically-first occurrence
  // of each distinct note, then render the final display lines.
  for (const bucket of byCategory.values()) {
    const seenText = new Set();
    const deduped = bucket.noteEntries.filter((entry) => {
      if (seenText.has(entry.text)) return false;
      seenText.add(entry.text);
      return true;
    });
    bucket.notes = deduped.map((entry) => formatNoteLine(entry));
    delete bucket.noteEntries;
  }

  return { byCategory, unmapped };
}

function formatNoteLine({ text, startedAt, endedAt }) {
  const start = formatClockTime(startedAt);
  const end = formatClockTime(endedAt);
  return start && end ? `${start}–${end} ${text}` : text;
}

function formatClockTime(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

// --- Field patch resolution --------------------------------------------------

// Provenance marker written into a dedicated `.autoValueSource` key
// alongside every autoValue this mechanism produces. Deliberately a
// DIFFERENT key from the schema's existing `.source` field — `.source`
// already means "how did `.value` get set" ("manual" vs "default", paired
// with `.manuallyEdited`); overloading it here would silently stomp a
// field's "manual" marker every time Focus re-syncs a category the user has
// also manually overridden, even though `.value`/`.manuallyEdited`
// themselves are never touched. `.autoValueSource` tracks a completely
// separate question — "where did `.autoValue` come from" — so the two never
// collide. Never written into `.value`, `.manuallyEdited`, or `.source`.
const FOCUS_SOURCE = "ticktick_focus";

/**
 * Decides which Firestore fields to write autoValue into, using ONLY
 * categoryId -> the app's own REVIEW_BINDINGS (static leaves) or live
 * reviewConfig (dynamic, taxonomy-only leaves, resolved by the caller from
 * profile.classificationTaxonomy — the same field/pipeline the UI itself
 * reads, never a second taxonomy source). Returns a patch object keyed by
 * Firestore dot-paths (ready for `transaction.set(..., {merge:true})`), plus
 * the new fieldProjection describing exactly what was targeted this run
 * (used by computeRollbackPatches on the NEXT sync to safely undo stale
 * targets — and only ones THIS mechanism itself previously wrote).
 */
export function buildFieldPatches({ byCategory, liveReviewConfigById = {} } = {}) {
  const patch = {};
  const fieldProjection = { fieldTargets: [], categoryEntryTargets: [] };

  for (const [categoryId, bucket] of byCategory.entries()) {
    const bound = resolveBoundFieldIds(categoryId);
    const progressText = bucket.notes.join("\n");

    if (bound) {
      if (bound.durationId) {
        patch[`fields.${bound.durationId}.autoValue`] = bucket.minutes;
        patch[`fields.${bound.durationId}.autoValueSource`] = FOCUS_SOURCE;
        fieldProjection.fieldTargets.push(bound.durationId);
      }
      if (bound.progressId && progressText) {
        patch[`fields.${bound.progressId}.autoValue`] = progressText;
        patch[`fields.${bound.progressId}.autoValueSource`] = FOCUS_SOURCE;
        fieldProjection.fieldTargets.push(bound.progressId);
      }
      continue;
    }

    const reviewConfig = liveReviewConfigById[categoryId];
    if (!reviewConfig?.enabled) continue; // no known target field for this categoryId at all
    if (reviewConfig.recordDuration) {
      patch[`categoryReviewEntries.${categoryId}.duration.autoValue`] = bucket.minutes;
      patch[`categoryReviewEntries.${categoryId}.duration.autoValueSource`] = FOCUS_SOURCE;
      fieldProjection.categoryEntryTargets.push(`${categoryId}.duration`);
    }
    if (reviewConfig.recordProgress && progressText) {
      patch[`categoryReviewEntries.${categoryId}.progress.autoValue`] = progressText;
      patch[`categoryReviewEntries.${categoryId}.progress.autoValueSource`] = FOCUS_SOURCE;
      fieldProjection.categoryEntryTargets.push(`${categoryId}.progress`);
    }
  }

  return { patch, fieldProjection };
}

/**
 * Compares the PREVIOUS sync's field targets against THIS sync's targets and
 * returns clearing patches for anything that was targeted before but isn't
 * anymore (e.g. a test session was removed, so that category no longer has
 * any minutes today). Only clears fields this mechanism itself is known to
 * have written (tracked in fieldProjection, and further guarded by only
 * clearing when the field's current `.autoValueSource` is still
 * FOCUS_SOURCE — if something else has since taken over that field's
 * autoValue, this never touches it) — and NEVER touches `.value`,
 * `.manuallyEdited`, or `.source` (the schema's own manual/default marker
 * for `.value` — a completely separate concern from autoValue provenance).
 *
 * The cleared value is always `""` (never `0`) for BOTH duration and
 * progress fields — `""` is this schema's own universal "no value yet"
 * representation (see dailyReviewSchema.js's fieldState()/
 * categoryEntryFieldState() defaults). Clearing a duration to the number `0`
 * would render as a misleading "0min" in the UI (implying "recorded zero
 * minutes today") instead of a genuine blank/no-data state.
 */
export function computeRollbackPatches({ previousFieldProjection, nextFieldProjection, currentFields = {}, currentCategoryReviewEntries = {} } = {}) {
  const patch = {};
  const prevFields = new Set(previousFieldProjection?.fieldTargets || []);
  const nextFields = new Set(nextFieldProjection?.fieldTargets || []);
  for (const fieldId of prevFields) {
    if (nextFields.has(fieldId)) continue;
    const current = currentFields[fieldId];
    if (current && current.autoValueSource !== undefined && current.autoValueSource !== FOCUS_SOURCE) continue; // something else now owns this field's autoValue
    patch[`fields.${fieldId}.autoValue`] = "";
    patch[`fields.${fieldId}.autoValueSource`] = "default";
  }

  const prevEntries = new Set(previousFieldProjection?.categoryEntryTargets || []);
  const nextEntries = new Set(nextFieldProjection?.categoryEntryTargets || []);
  for (const target of prevEntries) {
    if (nextEntries.has(target)) continue;
    const [categoryId, field] = splitCategoryEntryTarget(target);
    const current = currentCategoryReviewEntries?.[categoryId]?.[field];
    if (current && current.autoValueSource !== undefined && current.autoValueSource !== FOCUS_SOURCE) continue;
    patch[`categoryReviewEntries.${categoryId}.${field}.autoValue`] = "";
    patch[`categoryReviewEntries.${categoryId}.${field}.autoValueSource`] = "default";
  }
  return patch;
}

function splitCategoryEntryTarget(target) {
  const lastDot = target.lastIndexOf(".");
  return [target.slice(0, lastDot), target.slice(lastDot + 1)];
}

// --- focusSummary / focusSync -------------------------------------------------

export function buildFocusSummary({ byCategory, unmapped, sessions }) {
  const categoryTotals = [...byCategory.entries()]
    .map(([categoryId, bucket]) => ({ categoryId, minutes: bucket.minutes, sessionCount: bucket.sessionCount }))
    .sort((a, b) => b.minutes - a.minutes);

  const timeline = [...sessions]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((session) => ({
      sessionId: session.sessionId,
      rawTaskId: session.rawTaskId || null,
      rawTitle: session.rawTitle || null,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      minutes: Math.round(Number(session.minutes) || 0),
      categoryId: session.categoryId,
      mappingSource: session.mappingSource || null,
      mappingConfidence: session.mappingConfidence || null,
      note: session.note || null,
    }));

  const totalMinutes = categoryTotals.reduce((sum, row) => sum + row.minutes, 0);
  const sessionCount = sessions.length;

  return {
    schemaVersion: FOCUS_SYNC_SCHEMA_VERSION,
    totalMinutes,
    sessionCount,
    averageMinutes: sessionCount ? Math.round(totalMinutes / sessionCount) : 0,
    longestMinutes: sessions.reduce((max, s) => Math.max(max, Math.round(Number(s.minutes) || 0)), 0),
    categoryTotals,
    timeline,
    unmapped,
  };
}

export function buildFocusSync({ date, timezone, sourceRevision, sessions, byCategory, unmapped, isSettled }) {
  return {
    schemaVersion: FOCUS_SYNC_SCHEMA_VERSION,
    source: "ticktick_focus",
    date,
    timezone,
    sourceRevision,
    syncedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    mappedSessionCount: sessions.length - unmapped.length,
    unmappedSessionCount: unmapped.length,
    status: "ok",
    projectedCategoryIds: [...byCategory.keys()],
    ...(isSettled ? { hasPostSettlementChanges: true } : {}),
  };
}
