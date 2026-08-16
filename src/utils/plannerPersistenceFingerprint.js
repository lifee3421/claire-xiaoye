// Content-based dirty-checking for the planner autosave effect.
//
// The autosave effect used to gate itself on a "have I run once yet" ref
// (initializedRef), mutated in the effect body. That pattern is fundamentally
// broken under React 18 StrictMode, which double-invokes every mount effect
// (setup -> cleanup -> setup): once the cleanup undid the ref mutation to
// avoid a phantom autosave on the *first* mount, it also undid it on every
// *real* subsequent edit's cleanup — so the very next effect run (for a
// genuine user change) saw the ref reset to "not initialized" and skipped
// saving again. Net effect: real edits were silently never persisted.
//
// The fix replaces "have I run before" with "does the content I'd persist
// right now actually differ from what's already persisted" — a pure,
// StrictMode-safe, content-based fingerprint comparison.

const VOLATILE_RECOMPUTE_TIMESTAMP_KEYS = new Set(["updatedAt", "archivedAt"]);
const TRANSIENT_CLIENT_KEYS = new Set(["__canonicalPlannerMutations"]);

function stripVolatileTimestamps(value) {
  if (Array.isArray(value)) return value.map(stripVolatileTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_RECOMPUTE_TIMESTAMP_KEYS.has(key) && !TRANSIENT_CLIENT_KEYS.has(key))
        .map(([key, val]) => [key, stripVolatileTimestamps(val)])
    );
  }
  return value;
}

/**
 * Fingerprints a planner persistence payload for dirty-checking. Volatile
 * timestamps and the local canonical-mutation handoff queue are intentionally
 * excluded; neither is canonical planner content.
 */
export function fingerprintPlannerPersistencePayload(payload = {}) {
  return JSON.stringify(stripVolatileTimestamps(payload));
}
