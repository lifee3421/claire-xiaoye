import test from "node:test";
import assert from "node:assert/strict";
import { canApplyTrackerOverviewResult, resolveTrackerOverviewFacts } from "./trackerOverviewLoadState.js";
import { resolveEffectiveTrackers, DEFAULT_TRACKERS } from "./trackerDefaults.js";
import { projectTrackerDailyOverview } from "./trackerDailyOverview.js";

// Mirrors the exact control flow of the unified habit overview effect in
// App.jsx (ScheduleAssistant). Keeping it here lets us regression-test the
// "no permanent loading" guarantee — including stale-request cancellation and
// unmount safety — without mounting the whole schedule engine (which needs a
// DOM + Firebase). If this flow drifts from App.jsx, the wiring test in
// TrackerDailySummary.wiring.test.js must be updated in lockstep.
function runOverviewLoad({ loadFacts, trackers, targetDate, requestRef, setState }) {
  let active = true;
  const requestId = ++requestRef.current;
  setState({ status: "loading", facts: [], error: "" });
  resolveTrackerOverviewFacts({ loadFacts, trackers, targetDate })
    .then((nextState) => {
      if (!canApplyTrackerOverviewResult({ active, requestId, currentRequestId: requestRef.current })) return;
      setState(nextState);
    })
    .catch((error) => {
      if (!canApplyTrackerOverviewResult({ active, requestId, currentRequestId: requestRef.current })) return;
      setState({ status: "error", facts: [], error: error instanceof Error ? error.message : String(error) });
    });
  return () => { active = false; };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("overview load: empty CompletionEvents resolve to ready, never stuck on loading", async () => {
  const requestRef = { current: 0 };
  let state = { status: "loading" };
  const cancel = runOverviewLoad({
    loadFacts: async () => [],
    trackers: resolveEffectiveTrackers({}),
    targetDate: "2026-08-03",
    requestRef,
    setState: (s) => { state = s; },
  });
  await tick();
  cancel();
  assert.equal(state.status, "ready");
  assert.deepEqual(state.facts, []);
});

test("overview load: a rejecting fetch becomes a visible error, not loading", async () => {
  const requestRef = { current: 0 };
  let state = { status: "loading" };
  runOverviewLoad({
    loadFacts: async () => { throw Object.assign(new Error("Missing index"), { code: "failed-precondition" }); },
    trackers: resolveEffectiveTrackers({}),
    targetDate: "2026-08-03",
    requestRef,
    setState: (s) => { state = s; },
  });
  await tick();
  assert.equal(state.status, "error");
  assert.match(state.error, /Missing index/);
});

test("overview load: rapid re-runs discard the stale result and keep only the latest (no permanent loading)", async () => {
  const requestRef = { current: 0 };
  let state = { status: "loading" };
  const setState = (s) => { state = s; };
  const trackers = resolveEffectiveTrackers({});
  // Run #1 resolves LATE, simulating a slow Firestore read.
  const slowFacts = new Promise((res) => setTimeout(() => res([{ trackerId: "family-a" }]), 50));
  const cancel1 = runOverviewLoad({ loadFacts: async () => slowFacts, trackers, targetDate: "2026-08-03", requestRef, setState });
  // Run #2 (a genuine re-run, e.g. date change) resolves immediately.
  const cancel2 = runOverviewLoad({ loadFacts: async () => [{ trackerId: "family-b" }], trackers, targetDate: "2026-08-03", requestRef, setState });
  cancel1();
  await tick(80);
  cancel2();
  assert.equal(state.status, "ready");
  assert.deepEqual(state.facts, [{ trackerId: "family-b" }]);
});

test("overview load: unmount cancels the in-flight request without setState-after-unmount or throwing", async () => {
  const requestRef = { current: 0 };
  let state = { status: "loading" };
  let threw = false;
  const cancel = runOverviewLoad({
    loadFacts: async () => new Promise((res) => setTimeout(() => res([{ trackerId: "family-a" }]), 50)),
    trackers: resolveEffectiveTrackers({}),
    targetDate: "2026-08-03",
    requestRef,
    setState: (s) => { state = s; },
  });
  cancel(); // simulate unmount before the request settles
  try {
    await tick(80);
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, false);
  // The late resolve is discarded by the stale-request guard, so state stays
  // at its last pre-unmount value (loading) — never stranded in an error, and
  // never a setState-after-unmount.
  assert.equal(state.status, "loading");
});

test("overview load: retry (reloadKey bump) re-runs the loader and can recover to ready", async () => {
  const requestRef = { current: 0 };
  let state = { status: "loading" };
  const setState = (s) => { state = s; };
  const trackers = resolveEffectiveTrackers({});
  // First attempt fails.
  runOverviewLoad({ loadFacts: async () => { throw new Error("boom"); }, trackers, targetDate: "2026-08-03", requestRef, setState });
  await tick();
  assert.equal(state.status, "error");
  // Retry succeeds.
  runOverviewLoad({ loadFacts: async () => [], trackers, targetDate: "2026-08-03", requestRef, setState });
  await tick();
  assert.equal(state.status, "ready");
});

test("effective trackers: all seven defaults render even with empty facts", () => {
  const trackers = resolveEffectiveTrackers({});
  assert.equal(trackers.length, DEFAULT_TRACKERS.length);
  const summaries = trackers.map((tracker) => projectTrackerDailyOverview({ tracker, facts: {}, today: "2026-08-03" }));
  assert.equal(summaries.length, 7);
  // No summary is gated by the presence of facts: every row yields a renderable
  // status (待设置 / 历史尚未迁移 / schedule status), so an empty CompletionEvents
  // collection must still show all seven habit rows.
  assert.ok(summaries.every((summary) => typeof summary.status === "string" && summary.status.length > 0));
  // requiresSetup trackers must read 待设置, never be treated as "loading".
  const requiresSetup = summaries.filter((summary) => summary.status === "待设置");
  assert.ok(requiresSetup.length >= 1);
});
