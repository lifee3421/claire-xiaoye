import assert from "node:assert/strict";
import test from "node:test";
import {
  clearConnectionSettings,
  createSnapshotAutoSync,
  getLastSyncStatus,
  loadConnectionSettings,
  normalizeBaseUrl,
  saveConnectionSettings,
  sendCategoryCatalog,
  sendSnapshot,
  testConnection,
} from "./catkeeperSnapshotSender.js";
import { buildAgentDaySnapshotFromDailyData } from "./buildAgentDaySnapshot.js";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}

function response(status, body = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const settings = { enabled: true, baseUrl: "http://127.0.0.1:4319///", token: "secret-token" };
const snapshot = { schemaVersion: 1, date: "2026-07-16", timeline: [] };

test("saves and loads only local connection settings", () => {
  const local = storage();
  saveConnectionSettings(settings, local);
  const loaded = loadConnectionSettings(local);
  assert.equal(loaded.token, "secret-token");
  assert.equal(loaded.baseUrl, "http://127.0.0.1:4319");
  assert.equal([...local.values.keys()].length, 1);
});

test("normalizes trailing baseUrl slashes", () => {
  assert.equal(normalizeBaseUrl(" http://127.0.0.1:4319/// "), "http://127.0.0.1:4319");
});

test("does not serialize connection settings as a profile or firestore payload", () => {
  const local = storage();
  saveConnectionSettings(settings, local);
  const stored = JSON.parse([...local.values.values()][0]);
  assert.deepEqual(Object.keys(stored).sort(), ["baseUrl", "enabled", "lastCatalogSyncStatus", "lastCatalogSyncedAt", "lastSyncStatus", "lastSyncedAt", "lastSyncedDate", "lastTestStatus", "lastTestedAt", "token"].sort());
  assert.equal("profile" in stored, false);
  assert.equal("firestore" in stored, false);
});

test("health success maps to connected", async () => {
  const result = await testConnection(settings, { fetchImpl: async (url, init) => { assert.equal(url, "http://127.0.0.1:4319/events/catkeeper/health"); assert.equal(init.headers.Authorization, "Bearer secret-token"); return response(200, { status: "ok" }); }, storage: storage() });
  assert.equal(result.status, "connected");
});

test("health 401 maps to unauthorized", async () => {
  const result = await testConnection(settings, { fetchImpl: async () => response(401), storage: storage() });
  assert.equal(result.status, "unauthorized");
});

test("health network errors return safely", async () => {
  const result = await testConnection(settings, { fetchImpl: async () => { throw new TypeError("network"); }, storage: storage() });
  assert.equal(result.status, "cors_or_network_error");
});

test("health maps an unavailable receiver and missing local configuration", async () => {
  assert.equal((await testConnection(settings, { fetchImpl: async () => response(503), storage: storage() })).status, "receiver_unavailable");
  assert.equal((await testConnection({ enabled: false, baseUrl: settings.baseUrl, token: "" }, { fetchImpl: async () => response(200), storage: storage() })).status, "not_configured");
});

test("send maps accepted, duplicate, and ignored_stale", async () => {
  for (const status of ["accepted", "duplicate", "ignored_stale"]) {
    const result = await sendSnapshot(snapshot, settings, { fetchImpl: async () => response(200, { status }), storage: storage() });
    assert.equal(result.status, status);
  }
});

test("sends the category catalog through its independent endpoint", async () => {
  const catalog = { schemaVersion: 1, generatedAt: "2026-07-17T00:00:00.000Z", categories: [], taskTemplates: [] };
  const local = storage();
  const result = await sendCategoryCatalog(catalog, settings, {
    fetchImpl: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:4319/events/catkeeper/category-catalog");
      assert.deepEqual(JSON.parse(init.body), catalog);
      return response(202, { status: "accepted" });
    },
    storage: local,
  });
  assert.equal(result.status, "accepted");
  assert.equal(loadConnectionSettings(local).lastCatalogSyncStatus, "accepted");
});

test("send maps 401 and 422 explicitly", async () => {
  assert.equal((await sendSnapshot(snapshot, settings, { fetchImpl: async () => response(401), storage: storage() })).status, "unauthorized");
  assert.equal((await sendSnapshot(snapshot, settings, { fetchImpl: async () => response(422), storage: storage() })).status, "schema_rejected");
});

test("send returns timeout when fetch aborts", async () => {
  const result = await sendSnapshot(snapshot, settings, { timeoutMs: 5, fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))), storage: storage() });
  assert.equal(result.status, "timeout");
});

test("send returns a safe network or CORS error", async () => {
  const result = await sendSnapshot(snapshot, settings, { fetchImpl: async () => { throw new TypeError("failed to fetch"); }, storage: storage() });
  assert.equal(result.status, "cors_or_network_error");
});

test("send does not modify the input snapshot", async () => {
  const original = structuredClone(snapshot);
  await sendSnapshot(snapshot, settings, { fetchImpl: async () => response(200, { status: "accepted" }), storage: storage() });
  assert.deepEqual(snapshot, original);
});

test("current-date and tomorrow snapshots can both be sent unchanged", async () => {
  const dates = [];
  const fetchImpl = async (_url, init) => { dates.push(JSON.parse(init.body).date); return response(200, { status: "accepted" }); };
  await sendSnapshot({ ...snapshot, date: "2026-07-16" }, settings, { fetchImpl, storage: storage() });
  await sendSnapshot({ ...snapshot, date: "2026-07-17" }, settings, { fetchImpl, storage: storage() });
  assert.deepEqual(dates, ["2026-07-16", "2026-07-17"]);
});

test("failed sending does not mutate related plan data", async () => {
  const plan = { targetDate: "2026-07-17", blocks: [{ id: "task" }] };
  const original = structuredClone(plan);
  await sendSnapshot({ ...snapshot, date: plan.targetDate }, settings, { fetchImpl: async () => { throw new TypeError("offline"); }, storage: storage() });
  assert.deepEqual(plan, original);
});

test("last sync status and clear configuration work", async () => {
  const local = storage();
  await sendSnapshot(snapshot, settings, { fetchImpl: async () => response(200, { status: "accepted" }), storage: local });
  assert.deepEqual(getLastSyncStatus(local).status, "accepted");
  assert.equal(clearConnectionSettings(local).token, "");
  assert.equal(loadConnectionSettings(local).enabled, false);
});

test("automatic sync debounces to the final persisted snapshot and preserves resolved stat groups after completion changes", async () => {
  const timers = { next: 0, jobs: new Map(), setTimeout(fn) { const id = ++this.next; this.jobs.set(id, fn); return id; }, clearTimeout(id) { this.jobs.delete(id); } };
  const sent = [];
  const auto = createSnapshotAutoSync({ settings, timers, send: async (value) => { sent.push(value); return { status: "accepted" }; } });
  const buildSnapshot = (status) => () => buildAgentDaySnapshotFromDailyData({
    plan: { targetDate: "2026-07-17", blocks: [{ id: "math", title: "Math", categoryId: "math", start: "09:00", end: "10:00", kind: "task", status }] },
    classificationTaxonomy: [{ id: "study", children: [{ id: "math" }] }],
    sourceMode: "demo",
    now: new Date("2026-07-16T01:45:00.000Z"),
  });
  auto.schedule({ reason: "plan_updated", delayMs: 2500, buildSnapshot: buildSnapshot("pending") });
  auto.schedule({ reason: "completion_changed", delayMs: 2500, buildSnapshot: buildSnapshot("completed") });
  await [...timers.jobs.values()][0]();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].timeline[0].status, "completed");
  assert.equal(sent[0].timeline[0].statGroup, "study");
});

test("automatic sync makes no request when the connection is disabled", () => {
  const auto = createSnapshotAutoSync({ settings: { enabled: false }, send: () => { throw new Error("must not send"); } });
  assert.equal(auto.schedule({ buildSnapshot: () => snapshot }), false);
});
