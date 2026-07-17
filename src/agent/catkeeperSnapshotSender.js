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
