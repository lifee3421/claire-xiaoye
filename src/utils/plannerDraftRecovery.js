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

// A recovery snapshot is a crash-safety copy of ONLY the in-progress draft for
// the current planning day. Long-term config (settings / dayTemplates /
// archive / baseline snapshot) is the authoritative copy in Firestore and must
// NOT be duplicated into localStorage — duplicating it bloated every per-date
// key and exhausted the 5MB origin quota (QuotaExceededError), which used to
// escape into React and white-screen the Planner.
function isQuotaError(err) {
  if (!err) return false;
  if (err.name === "QuotaExceededError") return true;
  if (err.code === 22 || err.code === 1014) return true; // Firefox / Safari quota
  return /quota/i.test(String(err.name || err.message || ""));
}

const warnedRecovery = new Set();
function warnOnce(message) {
  if (warnedRecovery.has(message)) return;
  warnedRecovery.add(message);
  try { console.warn("[planner-recovery] " + message); } catch {}
}

// Remove only THIS app's other-date recovery keys; never touch keys belonging
// to other features. This caps the origin's localStorage growth across planning
// days without deleting unrelated user data.
function evictOtherDateRecoveryKeys(storage, profileId, keepDate) {
  const base = `${PREFIX}:${profileId || "demo-user"}`;
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (key === base || key.startsWith(base + ":")) {
        const datePart = key.slice(base.length + 1);
        if (key === base || (datePart && datePart !== keepDate)) keys.push(key);
      }
    }
  } catch {
    return;
  }
  keys.forEach((key) => { try { storage.removeItem(key); } catch {} });
}

export function savePlannerRecovery(profileId, value, targetDateOrStorage, maybeStorage) {
  const explicitDate = looksLikeStorage(targetDateOrStorage) ? "" : normalizeRecoveryDate(targetDateOrStorage);
  const storage = looksLikeStorage(targetDateOrStorage) ? targetDateOrStorage : maybeStorage;
  const recoveryDate = explicitDate || normalizeRecoveryDate(value?.draft?.targetDate || value?.draft?.savedOn || "");
  const target = storageFor(storage);
  const updatedAt = value?.updatedAt || new Date().toISOString();

  // Minimal payload: the in-progress draft (minus the Firestore-authoritative
  // baseline snapshot) and a timestamp. Nothing else — no settings, no archive.
  const incomingDraft = value?.draft && typeof value.draft === "object" ? value.draft : {};
  const safeDraft = { ...incomingDraft };
  delete safeDraft.baselinePlanSnapshot;
  const payload = { draft: safeDraft, updatedAt };

  if (!target) return payload;

  const write = () => {
    target.setItem(plannerRecoveryKey(profileId, recoveryDate), JSON.stringify(payload));
  };

  try {
    write();
  } catch (err) {
    // A localStorage failure must NEVER escape into React render/effect.
    if (isQuotaError(err)) {
      // Free space owned by this app's stale recovery keys, then retry once.
      try {
        evictOtherDateRecoveryKeys(target, profileId, recoveryDate);
        write();
      } catch {
        warnOnce("local recovery unavailable (quota); Firestore remains source of truth");
      }
    } else {
      warnOnce("local recovery write failed: " + (err && err.name));
    }
  }
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
