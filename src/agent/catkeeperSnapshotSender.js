import { createSyncOutbox } from "./syncOutbox.js";
import { buildReminderPlan } from "./buildReminderPlan.js";
import { prepareReminderPlanForSync } from "./reminderPlanRevision.js";

const STORAGE_KEY = "daily_catkeeper_connection_v1";
const DEFAULT_BASE_URL = "http://127.0.0.1:4319";

const defaultSettings = {
  enabled: false,
  baseUrl: DEFAULT_BASE_URL,
  token: "",
  lastTestStatus: null,
  lastTestedAt: null,
  lastSyncStatus: null,
  lastSyncedAt: null,
  lastSyncedDate: null,
  lastCatalogSyncStatus: null,
  lastCatalogSyncedAt: null,
};

function browserStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function safeResponseJson(response) {
  return response.json().catch(() => null);
}

function statusFromResponse(response, body, fallback) {
  if (response.status === 401) return "unauthorized";
  if (response.status === 422) return "schema_rejected";
  if (!response.ok) return "receiver_unavailable";
  const receiverStatus = body?.status || body?.result || body?.outcome;
  if (["accepted", "duplicate", "ignored_stale"].includes(receiverStatus)) return receiverStatus;
  return fallback;
}

function persistResult(settings, patch, storage = browserStorage()) {
  const next = { ...loadConnectionSettings(storage), ...settings, ...patch };
  saveConnectionSettings(next, storage);
  return next;
}

async function request({ settings, path, method, snapshot, fetchImpl, timeoutMs }) {
  const normalized = normalizeConnectionSettings(settings);
  if (!normalized.enabled || !normalized.baseUrl || !normalized.token) return { status: "not_configured", ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalized.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${normalized.token}`,
        ...(snapshot ? { "Content-Type": "application/json" } : {}),
      },
      ...(snapshot ? { body: JSON.stringify(snapshot) } : {}),
      signal: controller.signal,
    });
    const body = await safeResponseJson(response);
    return { status: statusFromResponse(response, body, method === "GET" ? "connected" : "accepted"), ok: response.ok };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "cors_or_network_error", ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
}

export function normalizeConnectionSettings(settings = {}) {
  return {
    ...defaultSettings,
    ...settings,
    enabled: settings.enabled === true,
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    token: String(settings.token || ""),
  };
}

export function loadConnectionSettings(storage = browserStorage()) {
  if (!storage) return { ...defaultSettings };
  return normalizeConnectionSettings(safeParse(storage.getItem(STORAGE_KEY) || "{}"));
}

export function saveConnectionSettings(settings, storage = browserStorage()) {
  const normalized = normalizeConnectionSettings(settings);
  if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearConnectionSettings(storage = browserStorage()) {
  if (storage) storage.removeItem(STORAGE_KEY);
  return { ...defaultSettings };
}

export function getLastSyncStatus(storage = browserStorage()) {
  const settings = loadConnectionSettings(storage);
  return {
    status: settings.lastSyncStatus,
    syncedAt: settings.lastSyncedAt,
    date: settings.lastSyncedDate,
  };
}

export async function testConnection(settings = loadConnectionSettings(), { fetchImpl = fetch, timeoutMs = 5000, storage = browserStorage() } = {}) {
  const result = await request({ settings, path: "/events/catkeeper/health", method: "GET", fetchImpl, timeoutMs });
  persistResult(settings, { lastTestStatus: result.status, lastTestedAt: new Date().toISOString() }, storage);
  return result;
}

export async function sendSnapshot(snapshot, settings = loadConnectionSettings(), { fetchImpl = fetch, timeoutMs = 5000, storage = browserStorage() } = {}) {
  const result = await request({ settings, path: "/events/catkeeper/day-snapshot", method: "POST", snapshot, fetchImpl, timeoutMs });
  persistResult(settings, {
    lastSyncStatus: result.status,
    lastSyncedAt: new Date().toISOString(),
    lastSyncedDate: result.status === "accepted" || result.status === "duplicate" || result.status === "ignored_stale" ? snapshot?.date || null : null,
  }, storage);
  return result;
}

/**
 * A page-local single-flight retry/outbox coordinator for day-snapshot sync.
 *
 * Reads the connection settings FRESH on every send (via getSettings) rather
 * than capturing them at creation, so a coordinator created before Cyberboss
 * was configured picks up a later settings change instead of being stuck on a
 * stale disabled snapshot forever. Transient send failures (Cyberboss restart,
 * localhost blip, CORS) retry with bounded backoff and survive until the tab
 * regains visibility or the next edit — see syncOutbox.js. The latest pending
 * snapshot always supersedes an older one, so Snow-dust can never be overwritten
 * by a stale payload arriving late.
 */
export function createSnapshotAutoSync({
  settings,                       // backward-compat: a static settings snapshot
  getSettings,                    // preferred: () => fresh connection settings
  send = sendSnapshot,
  onResult = () => {},
  onPendingChange = () => {},
  timers = globalThis,
  visibilityTarget = typeof document !== "undefined" ? document : null,
} = {}) {
  const resolveSettings = typeof getSettings === "function"
    ? getSettings
    : () => (settings === undefined ? loadConnectionSettings() : settings);
  const outbox = createSyncOutbox({
    onPendingChange,
    timers,
    visibilityTarget,
    async send(payload) {
      const s = normalizeConnectionSettings(resolveSettings());
      if (!s.enabled || !s.baseUrl || !s.token) return { ok: false, notConfigured: true };
      const snapshot = payload.buildSnapshot(payload.reason);
      const result = await send(snapshot, s);
      const ok = ["accepted", "duplicate", "ignored_stale"].includes(result.status);
      // Success is intentionally quiet; callers only surface failures.
      if (!ok) onResult(result);
      return { ok, notConfigured: false };
    },
  });
  return {
    schedule({ reason = "plan_updated", delayMs = 2500, buildSnapshot }) {
      if (typeof buildSnapshot !== "function") return false;
      outbox.schedule({ payload: { buildSnapshot, reason }, delayMs });
      return true;
    },
    flushNow: () => outbox.flushNow(),
    hasPending: () => outbox.hasPending(),
    cancel: () => outbox.cancel(),
    destroy: () => outbox.destroy(),
  };
}

export async function sendCategoryCatalog(catalog, settings = loadConnectionSettings(), { fetchImpl = fetch, timeoutMs = 5000, storage = browserStorage() } = {}) {
  const result = await request({ settings, path: "/events/catkeeper/category-catalog", method: "POST", snapshot: catalog, fetchImpl, timeoutMs });
  persistResult(settings, {
    lastCatalogSyncStatus: result.status,
    lastCatalogSyncedAt: new Date().toISOString(),
  }, storage);
  return result;
}

/** Sends a revisioned reminder plan through the same browser-local Cyberboss connection. */
export async function sendReminderPlan(plan, settings = loadConnectionSettings(), { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const normalized = normalizeConnectionSettings(settings);
  if (!normalized.enabled || !normalized.baseUrl || !normalized.token) return { status: "not_configured", ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalized.baseUrl}/events/catkeeper/reminder-plan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${normalized.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(plan),
      signal: controller.signal,
    });
    const body = await safeResponseJson(response);
    if (response.status === 401) return { status: "unauthorized", ok: false };
    if (!response.ok) return { status: "receiver_unavailable", ok: false };
    return {
      status: body?.status || "accepted",
      ok: true,
      acceptedRevision: body?.acceptedRevision,
      created: Number(body?.created) || 0,
      updated: Number(body?.updated) || 0,
      canceled: Number(body?.canceled ?? body?.canceledFromPreviousRevision) || 0,
      unchanged: Number(body?.unchanged) || 0,
    };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "cors_or_network_error", ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single-flight retry/outbox coordinator for ReminderPlan sync, mirroring
 * createSnapshotAutoSync. On a successful send it calls
 * onAccepted(revisionState, result) so the caller can record the accepted
 * revision — the caller MUST keep that record monotonic (see
 * recordAcceptedReminderPlanRevision) so a stale in-flight revision can never
 * overwrite a newer one already accepted.
 */
export function createReminderPlanAutoSync({
  settings,
  getSettings,
  send = sendReminderPlan,
  onAccepted = () => {},
  onResult = () => {},
  onPendingChange = () => {},
  timers = globalThis,
  visibilityTarget = typeof document !== "undefined" ? document : null,
} = {}) {
  const resolveSettings = typeof getSettings === "function"
    ? getSettings
    : () => (settings === undefined ? loadConnectionSettings() : settings);
  const outbox = createSyncOutbox({
    onPendingChange,
    timers,
    visibilityTarget,
    async send(payload) {
      const s = normalizeConnectionSettings(resolveSettings());
      if (!s.enabled || !s.baseUrl || !s.token) return { ok: false, notConfigured: true };
      const result = await send(payload.plan, s);
      if (!result.ok) { onResult(result); return { ok: false, notConfigured: false }; }
      onAccepted(payload.revisionState, result);
      return { ok: true, notConfigured: false };
    },
  });
  return {
    schedule({ payload, delayMs = 2500 }) {
      if (!payload || !payload.plan || !payload.revisionState) return false;
      outbox.schedule({ payload, delayMs });
      return true;
    },
    flushNow: () => outbox.flushNow(),
    hasPending: () => outbox.hasPending(),
    cancel: () => outbox.cancel(),
    destroy: () => outbox.destroy(),
  };
}

/**
 * Decides whether a ReminderPlan should be auto-synced after an autosave, and
 * if so builds the exact {plan, revisionState} to send. Pure — no side effects,
 * no network — so it can be unit-tested and called from the save path without
 * worrying about stale closures.
 *
 * Rules (the required sync semantics):
 *  - date not yet manually confirmed (no accepted revision) -> skip
 *  - content fingerprint unchanged since the last accepted revision -> skip
 *  - content changed -> bump revision, return the plan to send
 * Reuses prepareReminderPlanForSync exactly — never a second revision scheme.
 */
export function resolveAutoReminderPlanSync({
  syncByDate = {},
  date,
  cards = [],
  deskVerification = {},
  timezone = "Asia/Shanghai",
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return { sync: false, reason: "invalid_date" };
  const accepted = syncByDate?.[date] || {};
  const acceptedRevision = Math.max(0, Number(accepted.acceptedRevision) || 0);
  if (!accepted.fingerprint || acceptedRevision < 1) return { sync: false, reason: "not_yet_confirmed" };
  const provisionalPlan = buildReminderPlan({ localDate: date, revision: 1, cards, timezone, deskVerification, generatedAt });
  const { plan, revisionState } = prepareReminderPlanForSync(syncByDate, provisionalPlan);
  if (revisionState.fingerprint === accepted.fingerprint) return { sync: false, reason: "unchanged" };
  return { sync: true, plan, revisionState };
}

// Triggers a real Cyberboss->Daily Review sync for exactly ONE date (today,
// yesterday, or any historical date) — used by the "同步当前日期" button and
// the first-open-of-the-day background request. Reuses the SAME connection
// settings/token/baseUrl storage as sendSnapshot/sendCategoryCatalog (never
// a second connection config), but deliberately does NOT go through the
// shared request()/statusFromResponse() helper above — that helper's
// "accepted"/"duplicate"/"ignored_stale" vocabulary is specific to the
// snapshot/catalog receivers, whereas Cyberboss's /focus-review-sync
// endpoint reports its OWN distinct vocabulary (synced/unchanged/blocked/
// error/disabled) that the caller needs preserved verbatim to show the
// right UI state, not silently squashed into a generic "accepted".
export async function requestFocusReviewSync(date, settings = loadConnectionSettings(), { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const normalized = normalizeConnectionSettings(settings);
  if (!normalized.enabled || !normalized.baseUrl || !normalized.token) return { status: "not_configured", ok: false, date };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalized.baseUrl}/focus-review-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${normalized.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
      signal: controller.signal,
    });
    if (response.status === 401) return { status: "unauthorized", ok: false, date };
    if (!response.ok) return { status: "receiver_unavailable", ok: false, date };
    const body = await safeResponseJson(response);
    return { status: body?.status || "unknown", ok: true, date: body?.date || date };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "cors_or_network_error", ok: false, date };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull-based counterpart to requestFocusReviewSync: fetches the settled
 * (already-ended, deduped, categorized) Focus intervals Snow-dust has for
 * one date (GET /focus-review-sync/sessions), for the timeline's Focus
 * track / "我的计划" sidebar to compute overlap against locally — reuses
 * the exact same connection config (baseUrl/token) as every other
 * Snow-dust request in this file, never a second credential.
 */
export async function requestFocusSessions(date, settings = loadConnectionSettings(), { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const normalized = normalizeConnectionSettings(settings);
  if (!normalized.enabled || !normalized.baseUrl || !normalized.token) return { status: "not_configured", ok: false, date, sessions: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalized.baseUrl}/focus-review-sync/sessions?date=${encodeURIComponent(date)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${normalized.token}` },
      signal: controller.signal,
    });
    if (response.status === 401) return { status: "unauthorized", ok: false, date, sessions: [] };
    // A 404 here means this Cyberboss instance doesn't have the route at
    // all yet — an older build, not a real "the server is down" outage.
    // Reported distinctly so the UI can say "upgrade Cyberboss", not
    // "Cyberboss isn't running" (which would send the user chasing the
    // wrong problem).
    if (response.status === 404) return { status: "endpoint_not_found", ok: false, date, sessions: [] };
    if (!response.ok) return { status: "receiver_unavailable", ok: false, date, sessions: [] };
    const body = await safeResponseJson(response);
    return {
      status: body?.status || "unavailable",
      ok: true,
      date: body?.date || date,
      syncedAt: body?.syncedAt || null,
      reason: body?.reason || null,
      sessions: Array.isArray(body?.sessions) ? body.sessions : [],
    };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "cors_or_network_error", ok: false, date, sessions: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Maps every real state requestFocusSessions can be in to the exact Chinese
 * copy the Focus track/status note should show — the single place that
 * decides this, so no call site can independently reinvent "just show
 * unavailable" for a state it doesn't recognize. `sessionCount` and
 * `anyCardWaitingSettlement` only matter when status is "fresh": a fresh
 * empty day is NOT the same as the source being unavailable, and a fresh
 * day where a plan card's Focus session hasn't settled yet must not read as
 * a confident zero.
 */
export function describeFocusSessionsStatus({ status, sessionCount = 0, anyCardWaitingSettlement = false } = {}) {
  switch (status) {
    case "not_configured": return "未配置本机连接";
    // receiver_unavailable is a real HTTP response (non-2xx, non-401/404) —
    // the server answered, just not successfully. cors_or_network_error is
    // the fetch() call itself failing before any HTTP status exists (Cyberboss
    // truly unreachable, OR the browser blocked the request — CORS/mixed-
    // content/Private-Network-Access — which looks identical to the caller).
    // Collapsing both into "Snow-dust未启动" sent the user chasing a restart
    // for what was actually a browser-side block.
    case "receiver_unavailable": return "Snow-dust未启动或端口不可达";
    case "cors_or_network_error": return "浏览器无法访问本机Snow-dust（可能是本机连接被浏览器/CORS拦截）";
    case "unauthorized": return "token无效";
    case "endpoint_not_found": return "Snow-dust版本过旧，缺少Focus接口";
    case "timeout":
    case "source_unreachable":
    case "internal_error": return "Focus数据源不可达";
    case "fresh":
      if (anyCardWaitingSettlement) return "等待当前Focus结算";
      return sessionCount > 0 ? "数据已同步" : "暂无已结算Focus记录";
    default: return "Focus数据源不可达";
  }
}

// Maps requestFocusReviewSync's raw status vocabulary onto the exact 5 UI
// states the "同步当前日期" button and the first-open background request
// must show: 同步中 (the caller's own local "in flight" state, not
// produced here) / 已同步 / 数据无变化 / Cyberboss未连接 / 同步失败.
export function describeFocusReviewSyncStatus(status) {
  if (status === "synced") return "已同步";
  if (status === "unchanged") return "数据无变化";
  if (["not_configured", "cors_or_network_error", "timeout", "receiver_unavailable"].includes(status)) return "Cyberboss未连接";
  return "同步失败";
}

const AUTO_YESTERDAY_SYNC_STORAGE_KEY = "daily_catkeeper_focus_sync_auto_request_v1";

// A genuine answer from Cyberboss (even "nothing changed") means the
// background request did its job — never worth repeating today. Anything
// else (offline, blocked, a real error) must NOT be recorded as done, so
// the next page open retries instead of silently giving up for the rest
// of the day.
const AUTO_REQUEST_SETTLED_STATUSES = new Set(["synced", "unchanged"]);

export function yesterdayLocalDate(timezone = "Asia/Shanghai", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export function todayLocalDate(timezone = "Asia/Shanghai", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// true when today's local date has NOT already had a settled (synced or
// unchanged) auto-request for yesterday recorded — i.e. it's safe/needed to
// fire one now.
export function shouldAutoRequestYesterdaySync(storage, todayLocalDateString) {
  if (!storage) return true;
  return storage.getItem(AUTO_YESTERDAY_SYNC_STORAGE_KEY) !== todayLocalDateString;
}

export function recordAutoRequestOutcome(storage, todayLocalDateString, status) {
  if (!storage || !AUTO_REQUEST_SETTLED_STATUSES.has(status)) return;
  storage.setItem(AUTO_YESTERDAY_SYNC_STORAGE_KEY, todayLocalDateString);
}

// Fires the once-per-calendar-day background request for yesterday's date.
// Deliberately fire-and-forget from the CALLER's perspective (never
// awaited by page-open code) — the real page update comes from the
// existing Firestore dailyReviewDrafts subscription once Cyberboss's write
// lands, not from this call's return value.
export async function autoRequestYesterdaySyncIfDue({
  timezone = "Asia/Shanghai",
  now = new Date(),
  storage = browserStorage(),
  settings = loadConnectionSettings(storage),
  request = requestFocusReviewSync,
} = {}) {
  const today = todayLocalDate(timezone, now);
  if (!shouldAutoRequestYesterdaySync(storage, today)) return { skipped: "already_requested_today" };
  const date = yesterdayLocalDate(timezone, now);
  const result = await request(date, settings, {});
  recordAutoRequestOutcome(storage, today, result.status);
  return result;
}

// Requests a real 雪尘-voiced commentary for one date's review facts.
// Reuses the exact same connection settings/token/baseUrl as every other
// Cyberboss call here — no second connection config. The server (never the
// browser) builds the actual generation prompt; this only ever sends the
// already-whitelisted `review` object from buildSnowDustCommentaryPayload.js
// plus `date`/`inputRevision` — never a `prompt`/`systemPrompt` field.
export async function requestSnowDustCommentary(date, inputRevision, review, settings = loadConnectionSettings(), { fetchImpl = fetch, timeoutMs = 45_000 } = {}) {
  const normalized = normalizeConnectionSettings(settings);
  if (!normalized.enabled || !normalized.baseUrl || !normalized.token) return { status: "not_configured", ok: false, date };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalized.baseUrl}/snowdust-review-commentary`, {
      method: "POST",
      headers: { Authorization: `Bearer ${normalized.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ date, inputRevision, review }),
      signal: controller.signal,
    });
    if (response.status === 401) return { status: "unauthorized", ok: false, date };
    if (!response.ok) return { status: "receiver_unavailable", ok: false, date };
    const body = await safeResponseJson(response);
    if (body?.status === "generated" && body?.commentary) {
      return { status: "generated", ok: true, date: body.date || date, commentary: body.commentary, generatedAt: body.generatedAt, inputRevision: body.inputRevision || inputRevision };
    }
    // The server distinguishes timeout from other generation failures, and
    // (for the "error" status) attaches a safe reason code — never raw
    // exception text — so the UI can show the right one of the 3 required
    // distinct messages instead of folding every failure into one.
    if (body?.status === "timeout") return { status: "timeout", ok: false, date };
    return { status: "generation_failed", ok: false, date, reason: body?.reason };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "cors_or_network_error", ok: false, date };
  } finally {
    clearTimeout(timer);
  }
}

// Maps requestSnowDustCommentary's raw status (+ safe reason code, when the
// status is "generation_failed") onto the required distinct UI error
// states — must never fold runtime_unavailable/runtime_failed/timeout into
// one generic message.
export function describeSnowDustCommentaryStatus(status, reason) {
  if (status === "generated") return "已发送";
  if (["not_configured", "cors_or_network_error", "receiver_unavailable"].includes(status)) return "Cyberboss未连接";
  if (status === "unauthorized") return "连接验证失败";
  if (status === "timeout") return "雪尘看得有些久，请稍后再试";
  if (reason === "runtime_unavailable") return "雪尘的生成服务尚未就绪";
  return "雪尘暂时没能写下批注";
}
