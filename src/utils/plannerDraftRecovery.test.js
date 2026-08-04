import assert from "node:assert/strict";
import test from "node:test";
import { chooseNewestPlannerState, loadPlannerRecovery, plannerRecoveryKey, savePlannerRecovery } from "./plannerDraftRecovery.js";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), values };
}

test("saves and restores a local planner draft by profile", () => {
  const local = storage();
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "local" }, settings: {}, updatedAt: "2026-07-16T10:00:00.000Z" }, local);
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "local");
  assert.equal(local.values.has(plannerRecoveryKey("u1", "2026-07-17")), true);
});

test("still reads legacy profile-only recovery when the date-specific key is missing", () => {
  const local = storage();
  local.setItem(plannerRecoveryKey("u1"), JSON.stringify({
    draft: { targetDate: "2026-07-17", marker: "legacy" },
    updatedAt: "2026-07-16T10:00:00.000Z",
  }));
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "legacy");
  assert.equal(loadPlannerRecovery("u1", "2026-07-18", local), null);
});

test("isolates planner recovery by target date", () => {
  const local = storage();
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "today" }, settings: {}, updatedAt: "2026-07-16T10:00:00.000Z" }, "2026-07-17", local);
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-18", marker: "tomorrow" }, settings: {}, updatedAt: "2026-07-16T10:05:00.000Z" }, "2026-07-18", local);
  assert.notEqual(plannerRecoveryKey("u1", "2026-07-17"), plannerRecoveryKey("u1", "2026-07-18"));
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "today");
  assert.equal(loadPlannerRecovery("u1", "2026-07-18", local).draft.marker, "tomorrow");
});

test("updating one date does not overwrite another date recovery", () => {
  const local = storage();
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "today-a" }, updatedAt: "2026-07-16T10:00:00.000Z" }, "2026-07-17", local);
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-18", marker: "tomorrow" }, updatedAt: "2026-07-16T10:01:00.000Z" }, "2026-07-18", local);
  savePlannerRecovery("u1", { draft: { targetDate: "2026-07-17", marker: "today-b" }, updatedAt: "2026-07-16T10:02:00.000Z" }, "2026-07-17", local);
  assert.equal(loadPlannerRecovery("u1", "2026-07-17", local).draft.marker, "today-b");
  assert.equal(loadPlannerRecovery("u1", "2026-07-18", local).draft.marker, "tomorrow");
});

test("uses the newer local state but never restores an expired date", () => {
  const remote = { targetDate: "2026-07-17", marker: "remote", updatedAt: "2026-07-16T09:00:00.000Z" };
  const local = { draft: { targetDate: "2026-07-17", marker: "local" }, updatedAt: "2026-07-16T10:00:00.000Z" };
  assert.equal(chooseNewestPlannerState(remote, local, "2026-07-16").source, "local");
  assert.equal(chooseNewestPlannerState(remote, { ...local, draft: { ...local.draft, targetDate: "2026-07-15" } }, "2026-07-16").source, "remote");
});

test("keeps the newer cloud draft when local recovery is older or missing", () => {
  const remote = { targetDate: "2026-07-17", updatedAt: "2026-07-16T10:00:00.000Z" };
  const local = { draft: { targetDate: "2026-07-17" }, updatedAt: "2026-07-16T09:00:00.000Z" };
  assert.equal(chooseNewestPlannerState(remote, local).source, "remote");
  assert.equal(chooseNewestPlannerState(remote, null).source, "remote");
});

// ---- Recovery storage robustness (QuotaExceededError P0) ----

function richStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (i) => Array.from(values.keys())[i] ?? null,
    getItem: (k) => (values.has(k) ? values.get(k) : null),
    setItem: (k, v) => { values.set(k, v); },
    removeItem: (k) => { values.delete(k); },
    values,
  };
}

function quotaStorage(initial = {}, { failFirst = 0 } = {}) {
  const values = new Map(Object.entries(initial));
  let calls = 0;
  return {
    get length() { return values.size; },
    key: (i) => Array.from(values.keys())[i] ?? null,
    getItem: (k) => (values.has(k) ? values.get(k) : null),
    setItem: (k, v) => {
      calls += 1;
      if (failFirst && calls <= failFirst) {
        const e = new Error("quota");
        e.name = "QuotaExceededError";
        throw e;
      }
      values.set(k, v);
    },
    removeItem: (k) => { values.delete(k); },
    values,
  };
}

test("localStorage.setItem throwing QuotaExceededError does not propagate out of savePlannerRecovery", () => {
  const store = quotaStorage({}, { failFirst: Infinity }); // always throws
  assert.doesNotThrow(() => {
    savePlannerRecovery("u1", { draft: { targetDate: "2026-08-05", marker: "x" }, updatedAt: "t" }, "2026-08-05", store);
  });
});

test("recovery write failure does not block the Firestore save chain", () => {
  const store = quotaStorage({}, { failFirst: Infinity }); // recovery always fails
  let firestoreCalled = false;
  const persistFlow = () => {
    // mirrors persistPlannerNow: recovery write first, then Firestore persist
    savePlannerRecovery("u1", { draft: { targetDate: "2026-08-05", marker: "x" }, updatedAt: "t" }, "2026-08-05", store);
    firestoreCalled = true; // must still run even if recovery failed
    return firestoreCalled;
  };
  assert.doesNotThrow(persistFlow);
  assert.equal(firestoreCalled, true);
});

test("recovery payload omits long-term config (settings / archive / baseline snapshot / dayTemplates)", () => {
  const store = richStorage();
  savePlannerRecovery("u1", {
    draft: {
      targetDate: "2026-08-05",
      marker: "x",
      baselinePlanSnapshot: { targetDate: "2026-08-03", big: "x".repeat(1000) },
    },
    settings: { dayTemplates: [{ id: "t" }], defaultDayTemplateId: "t", deletedDayTemplateSystemKeys: [] },
    scheduleDraftArchive: [{ targetDate: "2026-08-01" }],
    updatedAt: "t",
  }, "2026-08-05", store);
  const stored = JSON.parse(store.values.get(plannerRecoveryKey("u1", "2026-08-05")));
  assert.equal(stored.settings, undefined, "settings must not be stored");
  assert.equal(stored.scheduleDraftArchive, undefined, "archive must not be stored");
  assert.equal(stored.draft.baselinePlanSnapshot, undefined, "baseline snapshot must not be stored");
  assert.equal(stored.draft.dayTemplates, undefined, "dayTemplates must not be stored");
  assert.equal(stored.draft.defaultDayTemplateId, undefined, "defaultDayTemplateId must not be stored");
  assert.equal(stored.draft.marker, "x");
  assert.equal(stored.draft.targetDate, "2026-08-05");
});

test("eviction on quota only cleans this app's recovery keys, not other apps' or other users'", () => {
  const initial = {
    "daily_planner_recovery_v1:u1:2026-08-03": "old3",
    "daily_planner_recovery_v1:u1:2026-08-04": "old4",
    "daily_planner_recovery_v1:OTHER:2026-08-05": "other-user",
    "some_other_app_key": "keep-me",
  };
  const store = quotaStorage(initial, { failFirst: 1 }); // first write throws -> evict + retry
  savePlannerRecovery("u1", { draft: { targetDate: "2026-08-05", marker: "now" }, updatedAt: "t" }, "2026-08-05", store);
  assert.equal(store.values.has("daily_planner_recovery_v1:u1:2026-08-03"), false, "own stale key removed");
  assert.equal(store.values.has("daily_planner_recovery_v1:u1:2026-08-04"), false, "own stale key removed");
  assert.equal(store.values.has(plannerRecoveryKey("u1", "2026-08-05")), true, "current key written after retry");
  assert.equal(store.values.has("some_other_app_key"), true, "other apps untouched");
  assert.equal(store.values.has("daily_planner_recovery_v1:OTHER:2026-08-05"), true, "other users untouched");
});

test("reload still recovers the real today's unsaved draft with the minimal payload", () => {
  const store = richStorage();
  savePlannerRecovery("u1", { draft: { targetDate: "2026-08-05", marker: "unsaved" }, updatedAt: "t" }, "2026-08-05", store);
  const recovered = loadPlannerRecovery("u1", "2026-08-05", store);
  assert.equal(recovered.draft.marker, "unsaved");
  assert.equal(recovered.draft.targetDate, "2026-08-05");
});
