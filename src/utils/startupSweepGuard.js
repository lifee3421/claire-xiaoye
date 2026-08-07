/**
 * Pure state machine for the startup sweep (entry point 1) guard.
 *
 * The startup sweep useEffect has `data` in its dep array — required because
 * the effect must not run until `data` loads from null. But subscribeUserData
 * fires onSnapshot for 17+ collections during initial load, each calling
 * setData() and re-triggering the effect. Without a guard, 17+ concurrent
 * retryPendingReconcileJobsForUser calls flood the Firestore write stream.
 *
 * This guard ensures entry point 1 initiates at most once per signed-in user
 * session:
 *   - shouldRun() returns true exactly once per uid after data loads
 *   - markInitiated(uid) locks it for that uid
 *   - reset() unlocks so a new session (logout → login, feature toggle off/on,
 *     or a sweep failure) can run again
 *
 * Extracted from App.jsx so the state machine can be unit-tested without React.
 */
export function makeStartupSweepGuardState() {
  let initiatedForUid = null;
  return {
    shouldRun(uid) {
      return initiatedForUid !== uid;
    },
    markInitiated(uid) {
      initiatedForUid = uid;
    },
    reset() {
      initiatedForUid = null;
    },
  };
}
