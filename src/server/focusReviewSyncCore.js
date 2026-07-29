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

// Bumped whenever the SERVER-SIDE field-projection write logic changes in a
// way that could make a previously-written result wrong/incomplete even
// though the underlying Focus session set (sourceRevision) is unchanged —
// e.g. the dot-path-vs-nested-key fix, or (v3) adding misc.today.progress /
// synthesizeUnclassifiedFocusNote so a session that only ever lands on the
// bare "misc" bucket gets a visible breakdown line. The no-op check in
// api/focus-review-sync.js requires BOTH sourceRevision AND this version to
// match before skipping a write, so deploying a projection-logic fix safely
// forces every date to reproject once on its next sync — never by fudging
// sourceRevision. A second apply at the SAME new version, with the SAME
// session data, is still a real no-op (see isNoopSync below) — this isn't a
// license to reproject on every sync, only once per version bump.
// v5: fixes a real "everything displays ~8h off" production bug — every
// Focus note-line timestamp shown in the daily review (e.g. "12:23–13:00
// 象棋") was formatted using the CALLER-supplied body.timezone instead of a
// fixed Beijing timezone, so a misconfigured Cyberboss-side
// CATKEEPER_FOCUS_SYNC_TIMEZONE (e.g. left at "UTC") silently shifted every
// displayed clock time. Also hardens raw timestamp parsing — see
// normalizeFocusTimestamp below — so an offset-less startedAt/endedAt string
// is interpreted as Beijing wall-clock time rather than however the
// process's own TZ happens to be set (Vercel defaults to UTC). Bumping this
// forces every date to reproject once on its next sync so old,
// wrongly-timed note text gets corrected — never by fudging sourceRevision.
export const FOCUS_FIELD_PROJECTION_VERSION = 5;

// The ONLY timezone ever used to interpret an offset-less Focus timestamp or
// to format a displayed clock time in the daily review — deliberately NEVER
// the caller (Cyberboss)-supplied body.timezone, which is trusted for
// nothing but diagnostics. This is what makes a misconfigured
// CATKEEPER_FOCUS_SYNC_TIMEZONE on the Cyberboss side incapable of shifting
// what Claire actually sees.
export const TRUSTED_DISPLAY_TIMEZONE = "Asia/Shanghai";

// UTC offset, in minutes, for every timezone normalizeFocusTimestamp is
// actually asked to interpret naive strings as. Deliberately a small fixed
// table (not a general tz database) — this project only ever needs Beijing
// time; an unrecognized timezone falls back to the runtime's own Date.parse
// interpretation rather than guessing.
const KNOWN_TIMEZONE_OFFSET_MINUTES = { "Asia/Shanghai": 8 * 60 };

/**
 * Parses an ISO-ish timestamp into epoch milliseconds. A string that already
 * carries an explicit UTC 'Z' or a numeric offset is trusted as-is (it says
 * what instant it means). A string with NO offset (e.g. "2026-07-
 * 28T12:23:00", the raw shape a naive TickTick/dida-cli timestamp can arrive
 * in) is interpreted as wall-clock time IN `timezone` — never left to
 * whatever timezone the running process happens to be in. Returns NaN for
 * anything unparseable, exactly like Date.parse.
 */
export function normalizeFocusTimestamp(value, timezone = TRUSTED_DISPLAY_TIMEZONE) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return NaN;
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (hasExplicitOffset) return Date.parse(raw);
  const offsetMinutes = KNOWN_TIMEZONE_OFFSET_MINUTES[timezone];
  if (offsetMinutes === undefined) return Date.parse(raw);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offsetText = `${sign}${String(Math.floor(absMinutes / 60)).padStart(2, "0")}:${String(absMinutes % 60).padStart(2, "0")}`;
  return Date.parse(`${raw}${offsetText}`);
}

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
 *
 * `isKnownCategoryId(categoryId)` lets the caller widen "is this a real
 * target" beyond the static canonical taxonomy — the endpoint passes one
 * that also accepts a categoryId present in the user's OWN LIVE
 * profile.classificationTaxonomy (a genuine active, non-archived, leaf
 * custom category the user created), never an arbitrary unknown string.
 * Defaults to canonical-only for callers (and every existing test) that
 * don't pass one, so this is purely additive.
 */
export function validateProjectionPayload(body, { date, isKnownCategoryId } = {}) {
  const isCategoryIdAccepted = typeof isKnownCategoryId === "function" ? isKnownCategoryId : (id) => Boolean(findCanonicalNode(id));
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
    if (categoryId !== UNMAPPED_CATEGORY_ID && !isCategoryIdAccepted(categoryId)) {
      errors.push(`${prefix}.categoryId is not a canonical id, a known active custom category, or "unmapped": ${categoryId}`);
    }

    const minutes = Number(session.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) errors.push(`${prefix}.minutes must be a non-negative finite number`);
    // Optional, additive: exact unrounded seconds. Older callers that only
    // send `minutes` still validate fine — `seconds` is only checked when
    // present, and aggregation falls back to `minutes * 60` when absent.
    if (session.seconds !== undefined) {
      const seconds = Number(session.seconds);
      if (!Number.isFinite(seconds) || seconds < 0) errors.push(`${prefix}.seconds must be a non-negative finite number`);
    }

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
// Exact seconds for one session — prefers the caller's own `seconds` field
// (unrounded) and only falls back to `minutes * 60` for older payloads that
// don't send it yet. Never rounds here; rounding happens exactly once, at
// the point a bucket's total is finalized (see below).
function sessionSeconds(session) {
  return Number.isFinite(Number(session.seconds)) ? Math.max(0, Number(session.seconds)) : Math.max(0, Number(session.minutes) || 0) * 60;
}

// Mirrors Cyberboss's own UNCERTAIN_MAPPING_SOURCES (focus-category-mapping-
// service.js) — mappingSource values where the session landed in a category
// by COARSE fallback (TickTick list bucket, or "give up, use misc") rather
// than a precise title/alias/taskId match.
const COARSE_MAPPING_SOURCES = new Set(["project_bucket", "misc_unclassified", "ambiguous_title"]);
const PRECISE_DYNAMIC_MAPPING_SOURCES = new Set(["title_exact", "title_alias_exact", "local_title", "taskId_binding"]);

// A session needs a synthesized breakdown line whenever the categoryId it
// landed on can't itself show WHICH activity the minutes came from:
// - it got there via a coarse mappingSource (no precise leaf/taskId match
//   was ever attempted or found for it), OR
// - it landed directly on the literal "misc" bucket itself (never a
//   misc.* leaf) — even a CONFIRMED taskId binding can point straight at
//   "misc" (e.g. a "做饭" task deliberately bound to the whole 杂项 bucket
//   rather than a dedicated taxonomy leaf), and "misc" has no schema field
//   of its own that identifies a specific activity, only a total.
function synthesizeUnclassifiedFocusNote(session, seconds) {
  const isCoarseMapping = COARSE_MAPPING_SOURCES.has(session.mappingSource);
  const isBareMiscBucket = session.categoryId === "misc";
  if (!isCoarseMapping && !isBareMiscBucket) return "";
  const title = typeof session.rawTitle === "string" ? session.rawTitle.trim() : "";
  if (!title) return "";
  return `${title} ${Math.round(seconds / 60)}min`;
}

// `timezone` is intentionally NOT accepted here — a Focus note line is
// always displayed in TRUSTED_DISPLAY_TIMEZONE, regardless of anything the
// caller (Cyberboss) claims about its own timezone. See
// TRUSTED_DISPLAY_TIMEZONE's comment above for why.
export function aggregateSessionsByCategory(sessions) {
  const sorted = [...sessions].sort((a, b) => normalizeFocusTimestamp(a.startedAt) - normalizeFocusTimestamp(b.startedAt));
  const byCategory = new Map();
  const unmapped = [];

  for (const session of sorted) {
    const seconds = sessionSeconds(session);
    if (session.categoryId === UNMAPPED_CATEGORY_ID) {
      unmapped.push({ sessionId: session.sessionId, rawTaskId: session.rawTaskId || null, rawTitle: session.rawTitle || null, startedAt: session.startedAt, endedAt: session.endedAt, minutes: Math.round(seconds / 60) });
      continue;
    }
    if (!byCategory.has(session.categoryId)) byCategory.set(session.categoryId, { seconds: 0, minutes: 0, sessionCount: 0, noteEntries: [], fallbackTitleEntries: [] });
    const bucket = byCategory.get(session.categoryId);
    // Accumulate exact SECONDS across every session in this category — never
    // round per-session before summing, or the per-category total can drift
    // from the true sum once a category has more than a couple of sessions.
    bucket.seconds += seconds;
    bucket.sessionCount += 1;
    const realNote = typeof session.note === "string" ? session.note.replace(/\s+/g, " ").trim() : "";
    // A session that only landed in this category via a COARSE mapping tier
    // (project_bucket / misc_unclassified / ambiguous_title — i.e. Cyberboss
    // couldn't resolve it to a precise taxonomy leaf) would otherwise
    // contribute ONLY to this category's totalMinutes, with no visible trace
    // of where those minutes came from — exactly the "父级有总数，但用户找不到
    //这段时间来自哪里" failure mode. Synthesize a note line from the raw
    // TickTick title so it still shows up as a real, identifiable row (e.g.
    // "做饭 16min"). Real note text always takes priority when present.
    const text = realNote || synthesizeUnclassifiedFocusNote(session, seconds);
    if (text) {
      bucket.noteEntries.push({ text, startedAt: session.startedAt, endedAt: session.endedAt });
    } else if (PRECISE_DYNAMIC_MAPPING_SOURCES.has(session.mappingSource)) {
      const rawTitle = typeof session.rawTitle === "string" ? session.rawTitle.trim() : "";
      if (rawTitle) bucket.fallbackTitleEntries.push({ text: rawTitle, startedAt: session.startedAt, endedAt: session.endedAt });
    }
  }

  // Round exactly once per category, from the exact accumulated seconds.
  for (const bucket of byCategory.values()) bucket.minutes = Math.round(bucket.seconds / 60);

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
    const seenFallbackTitle = new Set();
    bucket.fallbackProgressText = bucket.fallbackTitleEntries
      .filter((entry) => {
        if (seenFallbackTitle.has(entry.text)) return false;
        seenFallbackTitle.add(entry.text);
        return true;
      })
      .map((entry) => formatNoteLine(entry))
      .join("\n");
    delete bucket.noteEntries;
    delete bucket.fallbackTitleEntries;
  }

  return { byCategory, unmapped };
}

// `timezone` is deliberately NEVER the caller-supplied body.timezone — see
// TRUSTED_DISPLAY_TIMEZONE. A caller may still pass a DIFFERENT explicit
// timezone (e.g. for a future feature), but nothing in this codebase ever
// does, and nothing should ever wire body.timezone into either parameter.
export function formatNoteLine({ text, startedAt, endedAt }, timezone = TRUSTED_DISPLAY_TIMEZONE) {
  const start = formatClockTime(startedAt, timezone);
  const end = formatClockTime(endedAt, timezone);
  return start && end ? `${start}–${end} ${text}` : text;
}

export function formatClockTime(iso, timezone = TRUSTED_DISPLAY_TIMEZONE) {
  const ms = normalizeFocusTimestamp(iso, timezone);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone || TRUSTED_DISPLAY_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
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
 * Decides which fields to write autoValue into, using ONLY categoryId -> the
 * app's own REVIEW_BINDINGS (static leaves) or live reviewConfig (dynamic,
 * taxonomy-only leaves, resolved by the caller from
 * profile.classificationTaxonomy — the same field/pipeline the UI itself
 * reads, never a second taxonomy source).
 *
 * Returns NESTED delta objects — `fieldUpdates: { [fieldId]: {autoValue,
 * autoValueSource} }`, `categoryEntryUpdates: { [categoryId]: { duration?,
 * progress? } }` — using the field/category id as a literal JS object KEY,
 * NEVER a Firestore dot-path string. This is deliberate: draft.fields and
 * draft.categoryReviewEntries are maps keyed by ids that themselves contain
 * dots (e.g. "study.math.linearAlgebra.duration", "misc.water-plants") — a
 * Firestore dot-path string like `fields.study.math.linearAlgebra.duration.
 * autoValue` is NOT a way to address that flat key; Firestore parses every
 * dot in a path as a nested-field separator, so that string instead creates
 * a bogus 6-level-deep tree (fields → study → math → linearAlgebra →
 * duration → autoValue) alongside the real flat key, which the UI never
 * reads. The caller (api/focus-review-sync.js) applies these deltas to the
 * ALREADY-READ current draft.fields/categoryReviewEntries via
 * applyFieldUpdates/applyCategoryEntryUpdates and writes back the complete
 * reconstructed nested object — never a dotted string key.
 *
 * Also returns the new fieldProjection describing exactly what was targeted
 * this run (used by computeRollbackUpdates on the NEXT sync to safely undo
 * stale targets — and only ones THIS mechanism itself previously wrote).
 */
export function buildFieldPatches({ byCategory, liveReviewConfigById = {} } = {}) {
  const fieldUpdates = {};
  const categoryEntryUpdates = {};
  const fieldProjection = { fieldTargets: [], categoryEntryTargets: [] };

  for (const [categoryId, bucket] of byCategory.entries()) {
    const bound = resolveBoundFieldIds(categoryId);
    const progressText = bucket.notes.join("\n");

    if (bound) {
      if (bound.durationId) {
        fieldUpdates[bound.durationId] = { autoValue: bucket.minutes, autoValueSource: FOCUS_SOURCE };
        fieldProjection.fieldTargets.push(bound.durationId);
      }
      if (bound.progressId && progressText) {
        fieldUpdates[bound.progressId] = { autoValue: progressText, autoValueSource: FOCUS_SOURCE };
        fieldProjection.fieldTargets.push(bound.progressId);
      }
      continue;
    }

    const reviewConfig = liveReviewConfigById[categoryId];
    if (!reviewConfig?.enabled) continue; // no known target field for this categoryId at all
    if (reviewConfig.recordDuration) {
      categoryEntryUpdates[categoryId] = { ...categoryEntryUpdates[categoryId], duration: { autoValue: bucket.minutes, autoValueSource: FOCUS_SOURCE } };
      fieldProjection.categoryEntryTargets.push(`${categoryId}.duration`);
    }
    // Only a live dynamic custom leaf reaches this branch. Its blank-note
    // title fallback was pre-filtered above to exact mapping sources only;
    // built-in bindings and misc/coarse fallbacks retain their old semantics.
    const fallbackProgress = !progressText && reviewConfig.recordProgress ? bucket.fallbackProgressText || "" : "";
    if (reviewConfig.recordProgress && (progressText || fallbackProgress)) {
      categoryEntryUpdates[categoryId] = { ...categoryEntryUpdates[categoryId], progress: { autoValue: progressText || fallbackProgress, autoValueSource: FOCUS_SOURCE } };
      fieldProjection.categoryEntryTargets.push(`${categoryId}.progress`);
    }
  }

  return { fieldUpdates, categoryEntryUpdates, fieldProjection };
}

/**
 * Compares the PREVIOUS sync's field targets against THIS sync's targets and
 * returns clearing DELTAS (same nested-by-id shape as buildFieldPatches) for
 * anything that was targeted before but isn't anymore (e.g. a test session
 * was removed, so that category no longer has any minutes today). Only
 * clears fields this mechanism itself is known to have written (tracked in
 * fieldProjection, and further guarded by only clearing when the field's
 * current `.autoValueSource` is still FOCUS_SOURCE — if something else has
 * since taken over that field's autoValue, this never touches it) — and
 * NEVER touches `.value`, `.manuallyEdited`, or `.source` (the schema's own
 * manual/default marker for `.value` — a completely separate concern from
 * autoValue provenance).
 *
 * The cleared value is always `""` (never `0`) for BOTH duration and
 * progress fields — `""` is this schema's own universal "no value yet"
 * representation (see dailyReviewSchema.js's fieldState()/
 * categoryEntryFieldState() defaults). Clearing a duration to the number `0`
 * would render as a misleading "0min" in the UI (implying "recorded zero
 * minutes today") instead of a genuine blank/no-data state.
 */
export function computeRollbackUpdates({ previousFieldProjection, nextFieldProjection, currentFields = {}, currentCategoryReviewEntries = {} } = {}) {
  const fieldUpdates = {};
  const categoryEntryUpdates = {};
  const prevFields = new Set(previousFieldProjection?.fieldTargets || []);
  const nextFields = new Set(nextFieldProjection?.fieldTargets || []);
  for (const fieldId of prevFields) {
    if (nextFields.has(fieldId)) continue;
    const current = currentFields[fieldId];
    if (current && current.autoValueSource !== undefined && current.autoValueSource !== FOCUS_SOURCE) continue; // something else now owns this field's autoValue
    fieldUpdates[fieldId] = { autoValue: "", autoValueSource: "default" };
  }

  const prevEntries = new Set(previousFieldProjection?.categoryEntryTargets || []);
  const nextEntries = new Set(nextFieldProjection?.categoryEntryTargets || []);
  for (const target of prevEntries) {
    if (nextEntries.has(target)) continue;
    const [categoryId, field] = splitCategoryEntryTarget(target);
    const current = currentCategoryReviewEntries?.[categoryId]?.[field];
    if (current && current.autoValueSource !== undefined && current.autoValueSource !== FOCUS_SOURCE) continue;
    categoryEntryUpdates[categoryId] = { ...categoryEntryUpdates[categoryId], [field]: { autoValue: "", autoValueSource: "default" } };
  }
  return { fieldUpdates, categoryEntryUpdates };
}

function splitCategoryEntryTarget(target) {
  const lastDot = target.lastIndexOf(".");
  return [target.slice(0, lastDot), target.slice(lastDot + 1)];
}

// --- Applying deltas to the current draft (nested-object, never dot-path) ---

/**
 * Merges two { [fieldId]: {...} } delta maps (e.g. buildFieldPatches' and
 * computeRollbackUpdates' fieldUpdates) into one, later entries winning per
 * field id — they never target the same field in one run since a category
 * either gets projected (buildFieldPatches) or rolled back
 * (computeRollbackUpdates), never both.
 */
export function mergeFieldUpdates(...updateMaps) {
  return Object.assign({}, ...updateMaps);
}

/** Same idea, but one level deeper (per categoryId, per duration/progress). */
export function mergeCategoryEntryUpdates(...updateMaps) {
  const result = {};
  for (const map of updateMaps) {
    for (const [categoryId, fieldsPatch] of Object.entries(map || {})) {
      result[categoryId] = { ...result[categoryId], ...fieldsPatch };
    }
  }
  return result;
}

/**
 * Applies { [fieldId]: {autoValue, autoValueSource} } deltas onto the
 * CURRENT draft.fields, preserving every other key on each field state
 * (`.value`, `.manuallyEdited`, `.source`, `.sourceRevision`, `.editedAt`,
 * `.updatedAt`) and every field this delta doesn't mention. `fieldId` is
 * used as a literal object property — including one containing dots — never
 * split or reinterpreted.
 */
export function applyFieldUpdates(currentFields, fieldUpdates) {
  const keys = Object.keys(fieldUpdates || {});
  if (!keys.length) return currentFields;
  const next = { ...currentFields };
  for (const fieldId of keys) {
    next[fieldId] = { ...(currentFields[fieldId] || {}), ...fieldUpdates[fieldId] };
  }
  return next;
}

/** Same idea for draft.categoryReviewEntries[categoryId][field]. */
export function applyCategoryEntryUpdates(currentEntries, categoryEntryUpdates) {
  const categoryIds = Object.keys(categoryEntryUpdates || {});
  if (!categoryIds.length) return currentEntries;
  const next = { ...currentEntries };
  for (const categoryId of categoryIds) {
    const currentEntry = currentEntries[categoryId] || {};
    const fieldsPatch = categoryEntryUpdates[categoryId];
    const nextEntry = { ...currentEntry };
    for (const field of Object.keys(fieldsPatch)) {
      nextEntry[field] = { ...(currentEntry[field] || {}), ...fieldsPatch[field] };
    }
    next[categoryId] = nextEntry;
  }
  return next;
}

// --- Cleanup for the malformed nested tree the dot-path bug produced -------

/**
 * A genuine field state (see dailyReviewSchema.js's fieldState()) always has
 * an `autoValue` key at its own level. The dot-path bug instead created,
 * e.g., `fields.study` as a nested object `{ math: { linearAlgebra: {
 * duration: { autoValue: ... } } } }` — an object value with NO `autoValue`
 * of its own, but object children instead. Detects exactly that signature so
 * cleanup can delete only the bogus top-level keys the bug produced, never a
 * real flat dotted-id field (which always has `.autoValue` directly), and
 * never any other part of the document.
 */
export function detectMalformedFocusFieldKeys(currentFields = {}) {
  return Object.keys(currentFields).filter((key) => {
    const value = currentFields[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if ("autoValue" in value) return false; // a real field state — leave it alone
    return true;
  });
}

/**
 * Same idea for draft.categoryReviewEntries — a real entry's value is
 * `{ duration?: {autoValue,...}, progress?: {autoValue,...}, adjustment?:
 * {...} }`, i.e. its own children (if any) each have `autoValue`. The bug's
 * nested tree instead has children that are themselves further nested
 * objects with no `autoValue` anywhere at that depth (e.g. a categoryId like
 * "misc.water-plants" would nest as `categoryReviewEntries.misc["water-
 * plants"]`, so the malformed top-level key is "misc", whose child
 * "water-plants" lacks the duration/progress/adjustment shape).
 */
export function detectMalformedCategoryEntryKeys(currentEntries = {}) {
  const KNOWN_FIELDS = ["duration", "progress", "adjustment"];
  return Object.keys(currentEntries).filter((key) => {
    const value = currentEntries[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const looksLikeRealEntry = KNOWN_FIELDS.some((field) => value[field] && typeof value[field] === "object" && "autoValue" in value[field]);
    return !looksLikeRealEntry;
  });
}

// --- focusSummary / focusSync -------------------------------------------------

export function buildFocusSummary({ byCategory, unmapped, sessions }) {
  const categoryTotals = [...byCategory.entries()]
    .map(([categoryId, bucket]) => ({ categoryId, minutes: bucket.minutes, sessionCount: bucket.sessionCount }))
    .sort((a, b) => b.minutes - a.minutes);

  const timeline = [...sessions]
    .sort((a, b) => normalizeFocusTimestamp(a.startedAt) - normalizeFocusTimestamp(b.startedAt))
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
    projectionVersion: FOCUS_FIELD_PROJECTION_VERSION,
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

/**
 * Whether a sync request can be safely skipped as a no-op: the Focus session
 * set is unchanged (sourceRevision) AND the server's own field-projection
 * write logic hasn't changed since the last successful write
 * (projectionVersion) — a fix to the write logic itself must always
 * reproject once, even for an otherwise-unchanged day.
 */
export function isNoopSync(existingFocusSync, sourceRevision) {
  return Boolean(existingFocusSync) && existingFocusSync.sourceRevision === sourceRevision && existingFocusSync.projectionVersion === FOCUS_FIELD_PROJECTION_VERSION;
}

/**
 * The metadata check (isNoopSync) only proves that a matching write
 * happened SOME TIME in the past — it says nothing about whether
 * fields/categoryReviewEntries still hold that write's result RIGHT NOW.
 * A stale client autosave (full `{...draft}` payload, including its own
 * possibly-outdated fields/categoryReviewEntries) can land AFTER a correct
 * server write and silently overwrite autoValue/autoValueSource back to
 * something older, while leaving focusSync/focusSummary/sourceRevision
 * untouched (the client never writes those two keys) — permanently
 * wedging isNoopSync into skipping every future sync for that date, even
 * though the actual fields are wrong.
 *
 * This checks the OTHER half: given what THIS sync run would write
 * (`expectedFieldUpdates`/`expectedCategoryEntryUpdates` — the caller's
 * already-merged buildFieldPatches + rollback result, i.e. the complete set
 * of autoValue/autoValueSource pairs a real write would apply), does the
 * CURRENT stored draft already hold every one of them? Only true when
 * every target field/entry exists and its autoValue + autoValueSource
 * exactly match. Never inspects/requires value/manuallyEdited/source — a
 * repair triggered by this check must never touch those.
 */
export function isFocusProjectionMaterialized({
  currentFields = {},
  currentCategoryReviewEntries = {},
  expectedFieldUpdates = {},
  expectedCategoryEntryUpdates = {},
} = {}) {
  for (const [fieldId, expected] of Object.entries(expectedFieldUpdates)) {
    const current = currentFields[fieldId];
    if (!current) return false;
    if (current.autoValue !== expected.autoValue) return false;
    if ((current.autoValueSource ?? null) !== (expected.autoValueSource ?? null)) return false;
  }
  for (const [categoryId, fields] of Object.entries(expectedCategoryEntryUpdates)) {
    for (const [field, expected] of Object.entries(fields)) {
      const current = currentCategoryReviewEntries[categoryId]?.[field];
      if (!current) return false;
      if (current.autoValue !== expected.autoValue) return false;
      if ((current.autoValueSource ?? null) !== (expected.autoValueSource ?? null)) return false;
    }
  }
  return true;
}
