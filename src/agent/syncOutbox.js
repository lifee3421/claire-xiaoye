/**
 * Generic, domain-agnostic single-flight retry/outbox coordinator.
 *
 * One instance owns exactly one "latest pending payload". It debounces the
 * first send, retries bounded failures with backoff, and — critically for the
 * Catkeeper→Snow-dust reliability fix — never lets a transient failure
 * (Cyberboss restart, localhost blip, CORS) leave Snow-dust permanently stale:
 *
 *   schedule(payload)   supersede any older pending with the latest, debounce
 *   failure             backoff retry [5s, 30s, 60s], then keep pending with
 *                       NO active timer (so it can't spin) until either
 *                       visibility returns to "visible" or the next schedule()
 *   success             clear pending ONLY if it hasn't been superseded; if a
 *                       newer payload arrived during the in-flight send, pump it
 *   not_configured      keep pending, do NOT aggressively retry (the caller's
 *                       send reports notConfigured) — a later schedule() or
 *                       visibility flip will retry once the user configures
 *
 * The coordinator never sends two payloads concurrently (single-flight): an
 * in-flight completion re-checks `pending` and, if a newer one is waiting,
 * sends it immediately. This is what makes the revision race safe on the
 * client side — a stale in-flight cannot overwrite a newer pending.
 *
 * The coordinator knows nothing about snapshots, reminder plans, revisions, or
 * HTTP. The caller supplies `send(payload) -> { ok, notConfigured? }` and an
 * optional `onPendingChange(hasPending)` for UI.
 */

const RETRY_DELAYS_MS = [5_000, 30_000, 60_000];

export function createSyncOutbox({
  send,
  onPendingChange = () => {},
  timers = globalThis,
  visibilityTarget = typeof document !== "undefined" ? document : null,
} = {}) {
  if (typeof send !== "function") throw new Error("createSyncOutbox requires a send function");

  let debounceTimer = null;
  let retryTimer = null;
  let pending = null;
  let inFlight = false;
  let retryIndex = 0;

  function clearDebounce() { if (debounceTimer) { timers.clearTimeout(debounceTimer); debounceTimer = null; } }
  function clearRetry() { if (retryTimer) { timers.clearTimeout(retryTimer); retryTimer = null; } }
  function setPending(value) { pending = value; onPendingChange(value !== null); }

  // Drains the (at most one) pending payload one send at a time. A successful
  // send clears pending unless a newer payload superseded it mid-flight, in
  // which case the loop continues to send the newer one. A failed send either
  // schedules a backoff retry (if still current) or moves on to a newer
  // pending. `notConfigured` is treated as a soft stop: keep pending, no
  // aggressive retry, wait for a config change / visibility / next schedule.
  async function pump() {
    while (pending && !inFlight) {
      inFlight = true;
      const current = pending;
      let keepPumping = false;
      try {
        const outcome = await send(current);
        if (outcome && outcome.ok) {
          if (pending === current) { setPending(null); retryIndex = 0; }
          else { keepPumping = true; }
        } else if (pending === current) {
          if (!(outcome && outcome.notConfigured)) scheduleRetry();
        } else {
          keepPumping = true;
        }
      } catch {
        if (pending === current) scheduleRetry();
        else keepPumping = true;
      } finally {
        inFlight = false;
      }
      if (!keepPumping) break;
    }
  }

  function scheduleRetry() {
    clearRetry();
    if (retryIndex >= RETRY_DELAYS_MS.length) return; // exhausted; pending stays for visibility/next schedule
    const delay = RETRY_DELAYS_MS[retryIndex];
    retryIndex += 1;
    retryTimer = timers.setTimeout(() => { retryTimer = null; pump(); }, delay);
  }

  function onVisibility() {
    if (visibilityTarget && visibilityTarget.visibilityState === "visible" && pending && !inFlight) {
      retryIndex = 0;
      clearRetry();
      pump();
    }
  }
  if (visibilityTarget && typeof visibilityTarget.addEventListener === "function") {
    visibilityTarget.addEventListener("visibilitychange", onVisibility);
  }

  return {
    schedule({ payload, delayMs = 2500 } = {}) {
      setPending(payload);
      retryIndex = 0;
      clearRetry();
      clearDebounce();
      debounceTimer = timers.setTimeout(() => { debounceTimer = null; pump(); }, delayMs);
      return true;
    },
    flushNow() { clearDebounce(); clearRetry(); retryIndex = 0; return pump(); },
    hasPending() { return pending !== null; },
    cancel() { clearDebounce(); clearRetry(); setPending(null); retryIndex = 0; inFlight = false; },
    destroy() {
      clearDebounce(); clearRetry(); setPending(null); retryIndex = 0; inFlight = false;
      if (visibilityTarget && typeof visibilityTarget.removeEventListener === "function") {
        visibilityTarget.removeEventListener("visibilitychange", onVisibility);
      }
    },
  };
}
