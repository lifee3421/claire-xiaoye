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

export function plannerRecoveryKey(profileId = "demo-user") {
  return `${PREFIX}:${profileId || "demo-user"}`;
}

export function loadPlannerRecovery(profileId, storage) {
  const target = storageFor(storage);
  if (!target) return null;
  const saved = safeParse(target.getItem(plannerRecoveryKey(profileId)) || "");
  return saved?.draft && saved?.updatedAt ? saved : null;
}

export function savePlannerRecovery(profileId, value, storage) {
  const target = storageFor(storage);
  const payload = { ...value, updatedAt: value?.updatedAt || new Date().toISOString() };
  if (target) target.setItem(plannerRecoveryKey(profileId), JSON.stringify(payload));
  return payload;
}

export function chooseNewestPlannerState(remoteDraft = {}, localRecovery = null, currentDate = "") {
  if (!localRecovery?.draft) return { source: "remote", draft: remoteDraft || {} };
  const localDate = localRecovery.draft.targetDate || "";
  if (currentDate && localDate && localDate < currentDate) return { source: "remote", draft: remoteDraft || {} };
  if (timestamp(localRecovery.updatedAt) > timestamp(remoteDraft?.updatedAt)) return { source: "local", draft: localRecovery.draft };
  return { source: "remote", draft: remoteDraft || {} };
}
