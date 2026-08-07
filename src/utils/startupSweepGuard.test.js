import test from "node:test";
import assert from "node:assert/strict";
import { makeStartupSweepGuardState } from "./startupSweepGuard.js";

// Simulates the startup sweep effect body: given a sequence of (uid, loading,
// dataLoaded) render states — as produced by React re-rendering every time
// `data` updates — count how many times the sweep actually fires.
function runEffectSequence(renders, { onSweepStart, onSweepFail } = {}) {
  const guard = makeStartupSweepGuardState();
  let sweepCount = 0;
  const enableUnifiedTracker = true;
  const isFirebaseConfigured = true;

  for (const { uid, loading, dataLoaded } of renders) {
    const featureGateOk = Boolean(enableUnifiedTracker && isFirebaseConfigured && uid);
    if (!featureGateOk) {
      guard.reset();
      continue;
    }
    if (loading || !dataLoaded) continue;
    if (!guard.shouldRun(uid)) continue;
    guard.markInitiated(uid);
    sweepCount++;
    const simulatedFail = onSweepStart?.(sweepCount);
    if (simulatedFail) {
      guard.reset();
      onSweepFail?.();
    }
  }

  return { sweepCount, guard };
}

// Case 1: data=null initially, then 17 rapid subscription snapshots — only 1 sweep.
test("startup sweep guard: 17 successive data updates after initial null fire exactly 1 sweep", () => {
  const uid = "user-abc";
  const renders = [
    // data still null (loading screen)
    { uid, loading: false, dataLoaded: false },
    // 17 onSnapshot callbacks from subscribeUserData (each updates `data`)
    ...Array.from({ length: 17 }, () => ({ uid, loading: false, dataLoaded: true })),
  ];

  const { sweepCount } = runEffectSequence(renders);

  assert.strictEqual(sweepCount, 1, "sweep should fire exactly once across 17 data updates");
});

// Case 2: same user, routine data updates (e.g. later settlements sync) never re-trigger.
test("startup sweep guard: subsequent data updates for same user are no-ops", () => {
  const uid = "user-abc";
  const initial = [{ uid, loading: false, dataLoaded: true }]; // sweep fires here
  const later = Array.from({ length: 50 }, () => ({ uid, loading: false, dataLoaded: true }));

  const { sweepCount } = runEffectSequence([...initial, ...later]);

  assert.strictEqual(sweepCount, 1, "later data updates must not re-arm the sweep for the same user");
});

// Case 3: logout (uid goes null → guard resets) then login allows a new sweep.
test("startup sweep guard: logout then login resets guard and allows new sweep", () => {
  const uid = "user-abc";
  const renders = [
    { uid, loading: false, dataLoaded: true }, // sweep 1 fires
    { uid: null, loading: false, dataLoaded: false }, // logout: feature gate off → guard.reset()
    { uid, loading: false, dataLoaded: true }, // re-login: sweep 2 fires
    { uid, loading: false, dataLoaded: true }, // extra update: must NOT fire again
  ];

  const { sweepCount } = runEffectSequence(renders);

  assert.strictEqual(sweepCount, 2, "each login session should get exactly one sweep");
});

// Case 4: switching users always passes through null uid (Firebase logout clears
// uid before the next user signs in). The null renders trigger the feature-gate
// branch (uid falsy → shouldRunUnifiedTrackerSweep returns false → guard.reset()),
// so each fresh login session gets exactly one startup sweep regardless of whether
// the same uid has swept before in a prior session.
test("startup sweep guard: each login session (any uid) gets its own sweep via logout→login transitions", () => {
  const uid1 = "user-alice";
  const uid2 = "user-bob";
  const renders = [
    { uid: uid1, loading: false, dataLoaded: true },  // session 1: uid1 sweeps
    { uid: uid1, loading: false, dataLoaded: true },  // uid1 re-render: no-op
    { uid: null,  loading: false, dataLoaded: false }, // logout → guard.reset()
    { uid: uid2, loading: false, dataLoaded: true },  // session 2: uid2 sweeps
    { uid: uid2, loading: false, dataLoaded: true },  // uid2 re-render: no-op
    { uid: null,  loading: false, dataLoaded: false }, // logout → guard.reset()
    { uid: uid1, loading: false, dataLoaded: true },  // session 3: uid1 sweeps again (new session)
    { uid: uid1, loading: false, dataLoaded: true },  // uid1 re-render: no-op
  ];

  const { sweepCount } = runEffectSequence(renders);

  assert.strictEqual(sweepCount, 3, "each login session (uid1 session1, uid2, uid1 session2) sweeps exactly once");
});

// Case 5a: a sweep failure resets the guard, allowing the next data update to retry.
test("startup sweep guard: failure resets guard so next data update can retry (not permanently blocked)", () => {
  const uid = "user-abc";
  let failOnFirst = true;

  const renders = [
    { uid, loading: false, dataLoaded: true },  // attempt 1 → will fail
    { uid, loading: false, dataLoaded: true },  // attempt 2 → succeeds (retry after reset)
    { uid, loading: false, dataLoaded: true },  // attempt 3 → blocked (already succeeded)
  ];

  let attempt = 0;
  const { sweepCount } = runEffectSequence(renders, {
    onSweepStart: () => {
      attempt++;
      if (failOnFirst && attempt === 1) {
        failOnFirst = false;
        return true; // signal failure → guard.reset() will be called
      }
      return false; // success
    },
  });

  assert.strictEqual(sweepCount, 2, "first attempt fails + resets; second attempt succeeds; third is blocked");
});

// Case 5b: after a successful sweep, a failure in a *later* data-update re-fire
// does not happen — the guard has been set by the successful run and no new
// attempt is made, so there is nothing to fail or reset.
test("startup sweep guard: successful sweep permanently blocks entry point 1 for that uid", () => {
  const uid = "user-abc";
  const renders = [
    { uid, loading: false, dataLoaded: true }, // sweep fires and succeeds
    ...Array.from({ length: 10 }, () => ({ uid, loading: false, dataLoaded: true })),
  ];

  let sweepAttempts = 0;
  runEffectSequence(renders, { onSweepStart: () => { sweepAttempts++; return false; } });

  assert.strictEqual(sweepAttempts, 1, "guard must not allow further entry-point-1 runs after success");
});
