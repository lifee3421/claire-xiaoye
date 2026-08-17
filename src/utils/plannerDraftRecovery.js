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

export function chooseNewestPlannerState(remoteDraft = {}, localRecovery = null, currentDate = "") {
  if (!localRecovery?.draft) return { source: "remote", draft: remoteDraft || {} };
  const localDate = localRecovery.draft.targetDate || "";
  if (currentDate && localDate && localDate < currentDate) return { source: "remote", draft: remoteDraft || {} };
  if (timestamp(localRecovery.updatedAt) > timestamp(remoteDraft?.updatedAt)) return { source: "local", draft: localRecovery.draft };
  return { source: "remote", draft: remoteDraft || {} };
}
