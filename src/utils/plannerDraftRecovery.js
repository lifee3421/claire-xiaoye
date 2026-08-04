const PREFIX = "daily_planner_recovery_v1";

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function timestamp(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function storageFor(storage) {
  return storage || (typeof localStorage === "undefined" ? null : localStorage);
}

function looksLikeStorage(value) {
  return Boolean(value && typeof value.getItem === "function" && typeof value.setItem === "function");
}

function normalizeRecoveryDate(value = "") {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export function plannerRecoveryKey(profileId = "demo-user", targetDate = "") {
  const date = normalizeRecoveryDate(targetDate);
  return date ? `${PREFIX}:${profileId || "demo-user"}:${date}` : `${PREFIX}:${profileId || "demo-user"}`;
}

export function loadPlannerRecovery(profileId, targetDateOrStorage, maybeStorage) {
  const targetDate = looksLikeStorage(targetDateOrStorage) ? "" : normalizeRecoveryDate(targetDateOrStorage);
  const storage = looksLikeStorage(targetDateOrStorage) ? targetDateOrStorage : maybeStorage;
  const target = storageFor(storage);
  if (!target) return null;
  const saved = targetDate
    ? safeParse(target.getItem(plannerRecoveryKey(profileId, targetDate)) || "")
    : null;
  const legacySaved = saved || safeParse(target.getItem(plannerRecoveryKey(profileId)) || "");
  const finalSaved = legacySaved?.draft?.targetDate && targetDate && legacySaved.draft.targetDate !== targetDate ? null : legacySaved;
  return finalSaved?.draft && finalSaved?.updatedAt ? finalSaved : null;
}

export function savePlannerRecovery(profileId, value, targetDateOrStorage, maybeStorage) {
  const explicitDate = looksLikeStorage(targetDateOrStorage) ? "" : normalizeRecoveryDate(targetDateOrStorage);
  const storage = looksLikeStorage(targetDateOrStorage) ? targetDateOrStorage : maybeStorage;
  const recoveryDate = explicitDate || normalizeRecoveryDate(value?.draft?.targetDate || value?.draft?.savedOn || "");
  const target = storageFor(storage);
  const payload = { ...value, updatedAt: value?.updatedAt || new Date().toISOString() };
  if (target) target.setItem(plannerRecoveryKey(profileId, recoveryDate), JSON.stringify(payload));
  return payload;
}

// Settings fields that describe the user's *template library*, not the state
// of any single day's draft. A local recovery snapshot is a crash-safety copy
// of one day's in-progress draft; it happens to carry a whole `settings` blob
// along for the ride, but it is NOT an edit log for these fields. Because
// `chooseNewestPlannerState` picks a winner purely from the draft's
// `updatedAt`, a snapshot whose *draft* is newer would otherwise drag its
// stale *template library* along with it and overwrite the newer remote one —
// which then gets pushed straight back to Firestore by the autosave effect.
// That is the "模板回去了" report: templates silently reverting to an older set
// after a reload.
export const PLANNER_TEMPLATE_AUTHORITY_FIELDS = [
  "dayTemplates",
  "defaultDayTemplateId",
  "deletedDayTemplateSystemKeys",
];

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return value !== undefined && value !== null;
}

// Re-assert the remote (Firestore) copy as the source of truth for the
// template-library fields after a local draft recovery has won. The remote
// copy only falls back to the recovered one when it holds nothing meaningful
// at all, so a genuinely offline-first first-run still keeps its templates
// instead of being blanked.
export function preservePlannerTemplateAuthority(recoveredSettings, remoteSettings) {
  const recovered = recoveredSettings && typeof recoveredSettings === "object" ? recoveredSettings : {};
  const remote = remoteSettings && typeof remoteSettings === "object" ? remoteSettings : {};
  const merged = { ...recovered };
  PLANNER_TEMPLATE_AUTHORITY_FIELDS.forEach((field) => {
    if (hasMeaningfulValue(remote[field])) merged[field] = remote[field];
  });
  return merged;
}

export function chooseNewestPlannerState(remoteDraft = {}, localRecovery = null, currentDate = "") {
  if (!localRecovery?.draft) return { source: "remote", draft: remoteDraft || {} };
  const localDate = localRecovery.draft.targetDate || "";
  if (currentDate && localDate && localDate < currentDate) return { source: "remote", draft: remoteDraft || {} };
  if (timestamp(localRecovery.updatedAt) > timestamp(remoteDraft?.updatedAt)) return { source: "local", draft: localRecovery.draft };
  return { source: "remote", draft: remoteDraft || {} };
}
