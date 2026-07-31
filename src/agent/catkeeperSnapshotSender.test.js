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
  sendReminderPlan,
  sendSnapshot,
  testConnection,
  requestFocusReviewSync,
  requestFocusSessions,
  describeFocusReviewSyncStatus,
  shouldAutoRequestYesterdaySync,
  recordAutoRequestOutcome,
  autoRequestYesterdaySyncIfDue,
  yesterdayLocalDate,
  todayLocalDate,
  requestSnowDustCommentary,
  describeSnowDustCommentaryStatus,
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

test("sends Reminder Plans through the saved local Cyberboss connection with its bearer token", async () => {
  const plan = { schemaVersion: 1, localDate: "2026-07-27", revision: 3, reminders: [] };
  const result = await sendReminderPlan(plan, settings, { fetchImpl: async (url, init) => {
    assert.equal(url, "http://127.0.0.1:4319/events/catkeeper/reminder-plan");
    assert.equal(init.headers.Authorization, "Bearer secret-token");
    assert.deepEqual(JSON.parse(init.body), plan);
    return response(200, { status: "accepted", acceptedRevision: 3, created: 2, updated: 1, canceled: 4, unchanged: 0 });
  } });
  assert.deepEqual(result, { status: "accepted", ok: true, acceptedRevision: 3, created: 2, updated: 1, canceled: 4, unchanged: 0 });
});

test("does not send Reminder Plans without the existing enabled local connection", async () => {
  const result = await sendReminderPlan({ revision: 1 }, { enabled: false }, { fetchImpl: () => { throw new Error("must not fetch"); } });
  assert.deepEqual(result, { status: "not_configured", ok: false });
});

test("preserves an idempotent unchanged reminder-plan response and reports unavailable service clearly", async () => {
  const unchanged = await sendReminderPlan({ revision: 7 }, settings, { fetchImpl: async () => response(200, { status: "unchanged", acceptedRevision: 7, unchanged: 1 }) });
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.created, 0);
  assert.equal(unchanged.unchanged, 1);
  assert.equal((await sendReminderPlan({ revision: 7 }, settings, { fetchImpl: async () => { throw new TypeError("offline"); } })).status, "cors_or_network_error");
});

test("maps the receiver's canceledFromPreviousRevision field for reminder plan results", async () => {
  const result = await sendReminderPlan({ revision: 2 }, settings, { fetchImpl: async () => response(202, { status: "accepted", acceptedRevision: 2, canceledFromPreviousRevision: 3 }) });
  assert.equal(result.canceled, 3);
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

test("8. requestFocusReviewSync posts to /focus-review-sync with exactly the given date, using the same connection settings/token as sendSnapshot/sendCategoryCatalog", async () => {
  let seenUrl = null;
  let seenBody = null;
  let seenAuth = null;
  const fetchImpl = async (url, options) => {
    seenUrl = url;
    seenBody = JSON.parse(options.body);
    seenAuth = options.headers.Authorization;
    return response(200, { status: "synced", date: "2026-07-24" });
  };
  const result = await requestFocusReviewSync("2026-07-24", settings, { fetchImpl });
  assert.equal(seenUrl, "http://127.0.0.1:4319/focus-review-sync");
  assert.deepEqual(seenBody, { date: "2026-07-24" });
  assert.equal(seenAuth, "Bearer secret-token");
  assert.equal(result.status, "synced");
  assert.equal(result.date, "2026-07-24");
});

test("9. requestFocusReviewSync preserves the endpoint's real status vocabulary verbatim (synced/unchanged/blocked/error/disabled), never squashed into a generic 'accepted'", async () => {
  for (const status of ["synced", "unchanged", "blocked", "error", "disabled"]) {
    const fetchImpl = async () => response(200, { status, date: "2026-07-24" });
    const result = await requestFocusReviewSync("2026-07-24", settings, { fetchImpl });
    assert.equal(result.status, status);
  }
});

test("requestFocusSessions GETs /focus-review-sync/sessions?date=... with the same auth token, returning discrete sessions", async () => {
  let seenUrl = null;
  let seenMethod = null;
  let seenAuth = null;
  const fetchImpl = async (url, options) => {
    seenUrl = url;
    seenMethod = options.method;
    seenAuth = options.headers.Authorization;
    return response(200, { date: "2026-07-24", syncedAt: "2026-07-24T12:00:00.000Z", status: "fresh", sessions: [{ sessionId: "s1", startedAt: "a", endedAt: "b", durationMinutes: 10, categoryId: "study.math" }] });
  };
  const result = await requestFocusSessions("2026-07-24", settings, { fetchImpl });
  assert.equal(seenUrl, "http://127.0.0.1:4319/focus-review-sync/sessions?date=2026-07-24");
  assert.equal(seenMethod, "GET");
  assert.equal(seenAuth, "Bearer secret-token");
  assert.equal(result.ok, true);
  assert.equal(result.status, "fresh");
  assert.equal(result.sessions.length, 1);
});

test("requestFocusSessions never fabricates sessions/status on not_configured/unauthorized/network failure", async () => {
  const notConfigured = await requestFocusSessions("2026-07-24", { ...settings, enabled: false });
  assert.equal(notConfigured.status, "not_configured");
  assert.deepEqual(notConfigured.sessions, []);

  const unauthorized = await requestFocusSessions("2026-07-24", settings, { fetchImpl: async () => response(401, {}) });
  assert.equal(unauthorized.status, "unauthorized");
  assert.deepEqual(unauthorized.sessions, []);

  const offline = await requestFocusSessions("2026-07-24", settings, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(offline.status, "cors_or_network_error");
  assert.deepEqual(offline.sessions, []);
});

test("requestFocusReviewSync reports cors_or_network_error / receiver_unavailable when Cyberboss cannot be reached (offline / not running)", async () => {
  const offline = await requestFocusReviewSync("2026-07-24", settings, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(offline.status, "cors_or_network_error");

  const notRunning = await requestFocusReviewSync("2026-07-24", settings, { fetchImpl: async () => response(503, {}) });
  assert.equal(notRunning.status, "receiver_unavailable");
});

test("requestFocusReviewSync is not_configured when the connection is disabled or missing a token — never attempts a request", async () => {
  const result = await requestFocusReviewSync("2026-07-24", { enabled: false }, { fetchImpl: () => { throw new Error("must not fetch"); } });
  assert.equal(result.status, "not_configured");
});

test("yesterdayLocalDate/todayLocalDate compute Asia/Shanghai calendar dates from a fixed instant", () => {
  const now = new Date("2026-07-25T23:55:00Z"); // 2026-07-26 07:55 in Asia/Shanghai
  assert.equal(todayLocalDate("Asia/Shanghai", now), "2026-07-26");
  assert.equal(yesterdayLocalDate("Asia/Shanghai", now), "2026-07-25");
});

test("6. shouldAutoRequestYesterdaySync is true the first time today (no stored marker), false after a settled outcome was recorded for today", () => {
  const local = storage();
  assert.equal(shouldAutoRequestYesterdaySync(local, "2026-07-26"), true);
  recordAutoRequestOutcome(local, "2026-07-26", "synced");
  assert.equal(shouldAutoRequestYesterdaySync(local, "2026-07-26"), false);
  // A NEW day always re-arms it, even though a previous day was marked.
  assert.equal(shouldAutoRequestYesterdaySync(local, "2026-07-27"), true);
});

test("6. 'unchanged' also counts as settled (a real answer was received) — must not keep retrying just because nothing changed", () => {
  const local = storage();
  recordAutoRequestOutcome(local, "2026-07-26", "unchanged");
  assert.equal(shouldAutoRequestYesterdaySync(local, "2026-07-26"), false);
});

test("7. a failed/offline/blocked outcome is NEVER recorded — the next page open on the SAME day must retry", () => {
  const local = storage();
  for (const status of ["cors_or_network_error", "receiver_unavailable", "blocked", "error", "not_configured", "timeout", "unauthorized"]) {
    recordAutoRequestOutcome(local, "2026-07-26", status);
    assert.equal(shouldAutoRequestYesterdaySync(local, "2026-07-26"), true, `status=${status} must not be recorded as settled`);
  }
});

test("6. autoRequestYesterdaySyncIfDue requests exactly yesterday's date once, then is skipped on a second call the same day", async () => {
  const local = storage();
  const calls = [];
  const request = async (date) => { calls.push(date); return { status: "synced", date }; };
  const now = new Date("2026-07-25T23:55:00Z"); // 2026-07-26 in Asia/Shanghai

  const first = await autoRequestYesterdaySyncIfDue({ now, storage: local, settings: { enabled: true, baseUrl: "http://127.0.0.1:4319", token: "t" }, request });
  assert.equal(first.status, "synced");
  assert.deepEqual(calls, ["2026-07-25"]);

  const second = await autoRequestYesterdaySyncIfDue({ now, storage: local, settings: { enabled: true, baseUrl: "http://127.0.0.1:4319", token: "t" }, request });
  assert.equal(second.skipped, "already_requested_today");
  assert.deepEqual(calls, ["2026-07-25"], "must not request a second time the same day");
});

test("7. autoRequestYesterdaySyncIfDue retries on the next call after a failure — never marks a failed attempt as done", async () => {
  const local = storage();
  const calls = [];
  const request = async (date) => { calls.push(date); return { status: "cors_or_network_error", date }; };
  const now = new Date("2026-07-25T23:55:00Z");

  await autoRequestYesterdaySyncIfDue({ now, storage: local, settings: { enabled: true, baseUrl: "http://127.0.0.1:4319", token: "t" }, request });
  await autoRequestYesterdaySyncIfDue({ now, storage: local, settings: { enabled: true, baseUrl: "http://127.0.0.1:4319", token: "t" }, request });
  assert.deepEqual(calls, ["2026-07-25", "2026-07-25"], "both calls must actually request — a failure must never suppress the retry");
});

test("describeFocusReviewSyncStatus maps the real status vocabulary onto exactly the 5 required UI states", () => {
  assert.equal(describeFocusReviewSyncStatus("synced"), "已同步");
  assert.equal(describeFocusReviewSyncStatus("unchanged"), "数据无变化");
  assert.equal(describeFocusReviewSyncStatus("cors_or_network_error"), "Cyberboss未连接");
  assert.equal(describeFocusReviewSyncStatus("not_configured"), "Cyberboss未连接");
  assert.equal(describeFocusReviewSyncStatus("receiver_unavailable"), "Cyberboss未连接");
  assert.equal(describeFocusReviewSyncStatus("timeout"), "Cyberboss未连接");
  assert.equal(describeFocusReviewSyncStatus("blocked"), "同步失败");
  assert.equal(describeFocusReviewSyncStatus("error"), "同步失败");
  assert.equal(describeFocusReviewSyncStatus("unauthorized"), "同步失败");
});

test("requestSnowDustCommentary posts {date, inputRevision, review} to /snowdust-review-commentary using the same connection settings/token as every other Cyberboss call", async () => {
  let seenUrl = null;
  let seenBody = null;
  let seenAuth = null;
  const fetchImpl = async (url, options) => {
    seenUrl = url;
    seenBody = JSON.parse(options.body);
    seenAuth = options.headers.Authorization;
    return response(200, { status: "generated", date: "2026-07-27", commentary: "今天数学推进很扎实。", generatedAt: "2026-07-27T10:00:00.000Z", inputRevision: "rev-1" });
  };
  const result = await requestSnowDustCommentary("2026-07-27", "rev-1", { study: [{ label: "线性代数", minutes: 242 }] }, settings, { fetchImpl });
  assert.equal(seenUrl, "http://127.0.0.1:4319/snowdust-review-commentary");
  assert.deepEqual(seenBody, { date: "2026-07-27", inputRevision: "rev-1", review: { study: [{ label: "线性代数", minutes: 242 }] } });
  assert.equal(seenAuth, "Bearer secret-token");
  assert.equal(result.status, "generated");
  assert.equal(result.commentary, "今天数学推进很扎实。");
  assert.equal(result.inputRevision, "rev-1");
});

test("requestSnowDustCommentary reports not_configured / unauthorized / receiver_unavailable / cors_or_network_error / timeout distinctly, and generation_failed when the server claims success but omits a real commentary", async () => {
  const notConfigured = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, { enabled: false });
  assert.equal(notConfigured.status, "not_configured");

  const unauthorized = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, settings, { fetchImpl: async () => response(401, {}) });
  assert.equal(unauthorized.status, "unauthorized");

  const unavailable = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, settings, { fetchImpl: async () => response(503, {}) });
  assert.equal(unavailable.status, "receiver_unavailable");

  const networkError = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, settings, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(networkError.status, "cors_or_network_error");

  const noCommentary = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, settings, { fetchImpl: async () => response(200, { status: "generated" }) });
  assert.equal(noCommentary.status, "generation_failed");

  const serverTimeout = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, settings, { fetchImpl: async () => response(200, { status: "timeout", date: "2026-07-27" }) });
  assert.equal(serverTimeout.status, "timeout");
});

test("requestSnowDustCommentary propagates the server's safe reason code (e.g. runtime_unavailable) on generation_failed — never raw exception text", async () => {
  const runtimeUnavailable = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, settings, {
    fetchImpl: async () => response(200, { status: "error", date: "2026-07-27", reason: "runtime_unavailable" }),
  });
  assert.equal(runtimeUnavailable.status, "generation_failed");
  assert.equal(runtimeUnavailable.reason, "runtime_unavailable");

  const runtimeFailed = await requestSnowDustCommentary("2026-07-27", "rev-1", {}, settings, {
    fetchImpl: async () => response(200, { status: "error", date: "2026-07-27", reason: "runtime_failed" }),
  });
  assert.equal(runtimeFailed.status, "generation_failed");
  assert.equal(runtimeFailed.reason, "runtime_failed");
});

test("describeSnowDustCommentaryStatus maps status+reason onto the 3 distinct required failure messages — never folds them into one", () => {
  assert.equal(describeSnowDustCommentaryStatus("generated"), "已发送");
  assert.equal(describeSnowDustCommentaryStatus("not_configured"), "Cyberboss未连接");
  assert.equal(describeSnowDustCommentaryStatus("cors_or_network_error"), "Cyberboss未连接");
  assert.equal(describeSnowDustCommentaryStatus("receiver_unavailable"), "Cyberboss未连接");
  assert.equal(describeSnowDustCommentaryStatus("unauthorized"), "连接验证失败");
  assert.equal(describeSnowDustCommentaryStatus("timeout"), "雪尘看得有些久，请稍后再试");
  assert.equal(describeSnowDustCommentaryStatus("generation_failed", "runtime_unavailable"), "雪尘的生成服务尚未就绪");
  assert.equal(describeSnowDustCommentaryStatus("generation_failed", "runtime_failed"), "雪尘暂时没能写下批注");
  assert.equal(describeSnowDustCommentaryStatus("generation_failed"), "雪尘暂时没能写下批注");
  assert.equal(describeSnowDustCommentaryStatus("blocked"), "雪尘暂时没能写下批注");
});
