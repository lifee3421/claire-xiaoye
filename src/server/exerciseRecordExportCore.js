import { validateExercisePayload } from "./exerciseRecordSyncCore.js";

export const MAX_EXPORT_DAYS = 120;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

export function validateExerciseExportRange(body = {}) {
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const fromMs = parseDate(from);
  const toMs = parseDate(to);
  if (fromMs == null || toMs == null) {
    return { valid: false, error: "from and to must be real YYYY-MM-DD dates" };
  }
  if (fromMs > toMs) return { valid: false, error: "from must not be after to" };
  const days = Math.floor((toMs - fromMs) / DAY_MS) + 1;
  if (days > MAX_EXPORT_DAYS) {
    return { valid: false, error: `date range must not exceed ${MAX_EXPORT_DAYS} days` };
  }
  const dates = [];
  for (let ms = fromMs; ms <= toMs; ms += DAY_MS) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return { valid: true, from, to, days, dates };
}

export function normalizeStoredExerciseRecord(record) {
  if (!record || typeof record !== "object") return null;
  const validation = validateExercisePayload(record);
  if (!validation.valid) return null;
  const normalized = validation.normalized;
  const extractedAt = typeof record?.source?.extractedAt === "string"
    ? record.source.extractedAt.slice(0, 80)
    : "";
  return {
    date: normalized.date,
    timezone: normalized.timezone,
    summary: normalized.summary,
    sessions: normalized.sessions,
    source: {
      ...normalized.source,
      extractedAt,
    },
  };
}
