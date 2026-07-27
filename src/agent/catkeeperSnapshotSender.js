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
 * A page-local debounce coordinator. It deliberately has no persistence and
 * only invokes the supplied snapshot factory after a successful local save.
 */
export function createSnapshotAutoSync({ settings = loadConnectionSettings(), send = sendSnapshot, onResult = () => {}, timers = globalThis } = {}) {
  let timer = null;
  return {
    schedule({ reason = "plan_updated", delayMs = 2500, buildSnapshot }) {
      if (!settings?.enabled || !settings?.baseUrl || !settings?.token || typeof buildSnapshot !== "function") return false;
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(async () => {
        timer = null;
        const snapshot = buildSnapshot(reason);
        const result = await send(snapshot, settings);
        // Success is intentionally quiet; callers only surface failures.
        if (!["accepted", "duplicate", "ignored_stale"].includes(result.status)) onResult(result);
      }, delayMs);
      return true;
    },
    cancel() { if (timer) timers.clearTimeout(timer); timer = null; },
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
      canceled: Number(body?.canceled) || 0,
      unchanged: Number(body?.unchanged) || 0,
    };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "cors_or_network_error", ok: false };
  } finally {
    clearTimeout(timer);
  }
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
    if (body?.status !== "generated" || !body?.commentary) return { status: "generation_failed", ok: false, date };
    return { status: "generated", ok: true, date: body.date || date, commentary: body.commentary, generatedAt: body.generatedAt, inputRevision: body.inputRevision || inputRevision };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "cors_or_network_error", ok: false, date };
  } finally {
    clearTimeout(timer);
  }
}

// Maps requestSnowDustCommentary's raw status onto the required distinct UI
// error states.
export function describeSnowDustCommentaryStatus(status) {
  if (status === "generated") return "已发送";
  if (["not_configured", "cors_or_network_error", "receiver_unavailable"].includes(status)) return "Cyberboss未连接";
  if (status === "unauthorized") return "连接验证失败";
  if (status === "timeout") return "请求超时";
  return "雪尘暂时没能写下批注";
}
