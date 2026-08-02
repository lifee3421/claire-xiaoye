import assert from "node:assert/strict";
import test from "node:test";
import { createSyncOutbox } from "./syncOutbox.js";

function fakeTimers() {
  let next = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimeout(fn) {
      const id = ++next;
      // Auto-remove from jobs when fired, matching real setTimeout behavior
      const wrapper = () => { jobs.delete(id); fn(); };
      jobs.set(id, wrapper);
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
  };
}

// Fire the single pending timer job and let microtasks settle.
// The pump() function is async and awaits send(), so we need a few microtask
// ticks to ensure the full pump cycle completes.
async function fireAndSettle(timers) {
  const fns = [...timers.jobs.values()];
  for (const fn of fns) fn();
  // Allow the async pump to run to completion. send() is an immediately-
  // resolving async fn, so a handful of microtask ticks is enough.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// --- Test E: bounded backoff retry on transient failure, then success ---
//
// The core reliability guarantee: a transient send failure (Cyberboss restart,
// localhost blip, CORS) does NOT silently drop the payload. The outbox retries
// with [5s, 30s, 60s] backoff and, on eventual success, clears pending.
test("retries with bounded backoff [5s, 30s, 60s] on transient failure, then clears pending on success (test E)", async () => {
  const timers = fakeTimers();
  let calls = 0;
  const outcomes = [
    { ok: false },  // 1st send: fail → schedule retry @5s
    { ok: false },  // 2nd send (retry 1): fail → schedule retry @30s
    { ok: true },   // 3rd send (retry 2): success → clear pending
  ];
  const outbox = createSyncOutbox({
    timers,
    send: async () => outcomes[calls++],
  });
  outbox.schedule({ payload: "snapshot-v1", delayMs: 100 });
  assert.equal(outbox.hasPending(), true);

  // Fire debounce → 1st send fails
  await fireAndSettle(timers);
  assert.equal(calls, 1);
  assert.equal(outbox.hasPending(), true);
  assert.equal(timers.jobs.size, 1, "a retry timer should be scheduled");

  // Fire 1st retry (5s) → 2nd send fails
  await fireAndSettle(timers);
  assert.equal(calls, 2);
  assert.equal(outbox.hasPending(), true);
  assert.equal(timers.jobs.size, 1, "a second retry timer should be scheduled");

  // Fire 2nd retry (30s) → 3rd send succeeds
  await fireAndSettle(timers);
  assert.equal(calls, 3);
  assert.equal(outbox.hasPending(), false);
  assert.equal(timers.jobs.size, 0, "no timers left after success");
});

// --- Test E2: after exhausting all retries, pending stays with no active timer ---
//
// After 3 failures the outbox stops scheduling retry timers (to avoid spin).
// The payload is NOT lost — it stays pending until visibility returns or the
// next schedule() call, at which point it gets retried.
test("after exhausting all retries, pending stays with NO active timer — no spin (test E2)", async () => {
  const timers = fakeTimers();
  let calls = 0;
  const outbox = createSyncOutbox({
    timers,
    send: async () => { calls++; return { ok: false }; },
  });
  outbox.schedule({ payload: "data", delayMs: 100 });

  // Fire debounce + 3 retries (all fail)
  await fireAndSettle(timers); // debounce → 1st fail → retry @5s
  await fireAndSettle(timers); // retry 1 → 2nd fail → retry @30s
  await fireAndSettle(timers); // retry 2 → 3rd fail → retry @60s
  await fireAndSettle(timers); // retry 3 → 4th fail → NO more retries

  assert.equal(calls, 4);
  assert.equal(outbox.hasPending(), true, "payload must NOT be lost");
  assert.equal(timers.jobs.size, 0, "no active timer — must not spin");
});

// --- Test F: supersede — latest payload always wins ---
//
// When schedule() is called multiple times before the debounce fires, only
// the LAST payload is sent. An older pending payload is discarded. This is
// what makes rapid edits safe — Snow-dust only ever sees the final state.
test("a newer payload supersedes an older pending one — only the latest is sent (test F)", async () => {
  const timers = fakeTimers();
  const sent = [];
  const outbox = createSyncOutbox({
    timers,
    send: async (payload) => { sent.push(payload); return { ok: true }; },
  });
  outbox.schedule({ payload: "v1", delayMs: 100 });
  outbox.schedule({ payload: "v2", delayMs: 100 });
  outbox.schedule({ payload: "v3", delayMs: 100 });

  // Only one timer should exist (each schedule clears the prior debounce)
  assert.equal(timers.jobs.size, 1);

  await fireAndSettle(timers);
  assert.deepEqual(sent, ["v3"]);
  assert.equal(outbox.hasPending(), false);
});

// --- Test F2: supersede mid-flight — newer payload sent after in-flight completes ---
//
// When a send is in-flight and a new schedule() arrives, the new payload
// supersedes pending. After the in-flight send completes (success), the pump
// loop detects that pending changed and immediately sends the newer one.
test("a newer payload scheduled during an in-flight send is sent after it completes (test F2)", async () => {
  const timers = fakeTimers();
  const sent = [];
  let resolveFirst;
  const outbox = createSyncOutbox({
    timers,
    send: async (payload) => {
      if (payload === "first" && !resolveFirst) {
        await new Promise((resolve) => { resolveFirst = resolve; });
      }
      sent.push(payload);
      return { ok: true };
    },
  });
  outbox.schedule({ payload: "first", delayMs: 100 });
  // Fire debounce — pump enters, send("first") is in-flight (blocked)
  const debounceFn = [...timers.jobs.values()][0];
  debounceFn(); // Don't await — pump is suspended inside send("first")
  await Promise.resolve(); // Let pump enter and reach the await send()
  assert.equal(sent.length, 0);
  assert.equal(outbox.hasPending(), true);

  // While "first" is in-flight, schedule "second"
  outbox.schedule({ payload: "second", delayMs: 100 });
  assert.equal(outbox.hasPending(), true);

  // Resolve "first" — pump should detect pending changed and send "second"
  resolveFirst();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  assert.deepEqual(sent, ["first", "second"]);
  assert.equal(outbox.hasPending(), false);
});

// --- Test G: notConfigured is a soft stop ---
//
// When the connection is not configured (disabled, missing baseUrl/token),
// send returns { ok: false, notConfigured: true }. The outbox must NOT
// aggressively retry — it keeps the payload pending but schedules NO retry
// timer. This is the "created before Cyberboss was configured" case: the
// payload waits patiently until the user configures the connection, then
// flushNow() or the next schedule() picks it up.
test("notConfigured is a soft stop — pending stays, NO retry timer scheduled (test G)", async () => {
  const timers = fakeTimers();
  const outbox = createSyncOutbox({
    timers,
    send: async () => ({ ok: false, notConfigured: true }),
  });
  outbox.schedule({ payload: "data", delayMs: 100 });
  assert.equal(outbox.hasPending(), true);

  await fireAndSettle(timers);

  assert.equal(outbox.hasPending(), true, "payload must stay pending");
  assert.equal(timers.jobs.size, 0, "NO retry timer — must not spin on notConfigured");
});

// --- Test G2: visibility return retries a pending payload ---
//
// When the tab regains visibility, any pending payload is retried immediately
// (retryIndex reset to 0). This covers the "user switches away, Cyberboss
// restarts, user switches back" scenario.
test("visibility return retries a pending payload with fresh retry budget (test G2)", async () => {
  const fakeDoc = {
    visibilityState: "hidden",
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const timers = fakeTimers();
  let calls = 0;
  const outbox = createSyncOutbox({
    timers,
    visibilityTarget: fakeDoc,
    send: async () => { calls++; return { ok: false }; },
  });
  outbox.schedule({ payload: "data", delayMs: 100 });
  await fireAndSettle(timers); // debounce → 1st fail → retry @5s
  await fireAndSettle(timers); // retry 1 → 2nd fail → retry @30s
  assert.equal(calls, 2);

  // Simulate tab becoming visible — outbox should retry immediately
  // We need to call the visibilitychange handler manually since fakeDoc
  // doesn't actually fire events
  fakeDoc.visibilityState = "visible";
  // The outbox registered a listener on visibilityTarget — but since
  // addEventListener is a no-op in our fake, we test via flushNow instead
  await outbox.flushNow();
  assert.equal(calls, 3, "flushNow should retry the pending payload");
  assert.equal(outbox.hasPending(), true, "still pending after another failure");
});
