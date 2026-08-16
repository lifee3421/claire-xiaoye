// Canonical-vs-sidecar field boundary for one dated planner draft.
//
// Canonical fields are anything that can change the day's planned schedule or
// its mutation/history semantics. Sidecar fields are display/derived/history
// metadata that may live beside the draft without changing placement. Keeping
// this list small and explicit is deliberate: unknown fields fail closed into
// canonical state rather than accidentally becoming a browser-direct bypass.

export const PLANNER_DRAFT_IDENTITY_FIELDS = new Set([
  "targetDate",
  "savedOn",
  "updatedAt",
]);

export const PLANNER_DRAFT_SIDECAR_FIELDS = new Set([
  "stickers",
  "suppressedStickerGenerationKeys",
  "generatedPrompt",
  "reviewPrefill",
  "segmentGoals",
  "reminderPlanSyncByDate",
  "baselinePlanSnapshot",
  "revision",
]);

export const PLANNER_DRAFT_TRANSIENT_FIELDS = new Set([
  "__canonicalPlannerMutations",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function fnv1a(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function isCanonicalDailyDraftField(key) {
  return typeof key === "string"
    && !PLANNER_DRAFT_IDENTITY_FIELDS.has(key)
    && !PLANNER_DRAFT_SIDECAR_FIELDS.has(key)
    && !PLANNER_DRAFT_TRANSIENT_FIELDS.has(key);
}

export function extractCanonicalDailyState(draft = {}) {
  const source = isPlainObject(draft) ? draft : {};
  return Object.fromEntries(
    Object.keys(source)
      .filter(isCanonicalDailyDraftField)
      .sort()
      .map((key) => [key, source[key]])
  );
}

export function extractPlannerDraftSidecar(draft = {}) {
  const source = isPlainObject(draft) ? draft : {};
  return Object.fromEntries(
    [...PLANNER_DRAFT_SIDECAR_FIELDS]
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, source[key]])
  );
}

export function canonicalDailyStateFingerprint(draft = {}) {
  return fnv1a(stableSerialize(extractCanonicalDailyState(draft)));
}

export function plannerDraftSidecarFingerprint(draft = {}) {
  return fnv1a(stableSerialize(extractPlannerDraftSidecar(draft)));
}

export function canonicalDailyStatesEqual(left = {}, right = {}) {
  return canonicalDailyStateFingerprint(left) === canonicalDailyStateFingerprint(right);
}

export function validateCanonicalDailyStatePayload(state) {
  if (!isPlainObject(state)) return ["state must be an object"];
  const problems = [];
  Object.keys(state).forEach((key) => {
    if (!isCanonicalDailyDraftField(key)) problems.push(`state.${key} is not a canonical daily field`);
  });
  return problems;
}

export function replaceCanonicalDailyState(draft = {}, state = {}) {
  const problems = validateCanonicalDailyStatePayload(state);
  if (problems.length) return { ok: false, problems };
  const next = { ...(isPlainObject(draft) ? draft : {}) };
  Object.keys(next).filter(isCanonicalDailyDraftField).forEach((key) => { delete next[key]; });
  Object.assign(next, state);
  return { ok: true, draft: next };
}

export function mergePlannerDraftSidecar(draft = {}, sidecar = {}) {
  const next = { ...(isPlainObject(draft) ? draft : {}) };
  for (const [key, value] of Object.entries(isPlainObject(sidecar) ? sidecar : {})) {
    if (!PLANNER_DRAFT_SIDECAR_FIELDS.has(key)) continue;
    next[key] = value;
  }
  return next;
}
