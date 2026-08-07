export const REWARD_CHALLENGE_SCHEMA_VERSION = 1;

export const REWARD_CHALLENGE_MODES = Object.freeze([
  "streak",
  "count_in_period",
  "cumulative",
]);

export const REWARD_CHALLENGE_METRICS = Object.freeze([
  "study_minutes",
  "reading_minutes",
  "bedtime_minutes",
  "exercise_minutes",
  "exercise_session",
  "tracker_completion",
]);

export const REWARD_CHALLENGE_OPERATORS = Object.freeze([">=", "<=", "=="]);
export const REWARD_CHALLENGE_PERIOD_TYPES = Object.freeze(["rolling_days", "calendar_week", "date_range"]);

const MODE_SET = new Set(REWARD_CHALLENGE_MODES);
const METRIC_SET = new Set(REWARD_CHALLENGE_METRICS);
const OPERATOR_SET = new Set(REWARD_CHALLENGE_OPERATORS);
const PERIOD_SET = new Set(REWARD_CHALLENGE_PERIOD_TYPES);
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback = 0) {
  const number = Math.floor(finiteNumber(value, fallback));
  return number > 0 ? number : fallback;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLocalDate(value) {
  const text = normalizeText(value);
  if (!LOCAL_DATE_RE.test(text)) return "";
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? "" : text;
}

function addDays(localDate, amount) {
  const normalized = normalizeLocalDate(localDate);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return date.toISOString().slice(0, 10);
}

function compareLocalDates(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

export function normalizeBedtimeMinutes(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const raw = finiteNumber(value);
    if (raw === null) return null;
    const minute = Math.round(raw);
    if (minute < 0 || minute >= 48 * 60) return null;
    // Numeric values below 06:00 are treated as after-midnight bedtimes on
    // the same logical night, so 00:20 becomes 1460 and compares correctly
    // against a 24:00 (1440) threshold.
    return minute < 6 * 60 ? minute + 24 * 60 : minute;
  }

  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
  const total = hours * 60 + minutes;
  return total < 6 * 60 ? total + 24 * 60 : total;
}

export function normalizeRewardChallengeRule(input = {}) {
  const mode = normalizeText(input.mode);
  const metric = normalizeText(input.metric);
  const operator = normalizeText(input.operator || defaultOperatorForMetric(metric));
  const periodType = normalizeText(input?.period?.type || input.periodType || "date_range");

  if (!MODE_SET.has(mode)) throw new Error(`Unsupported reward challenge mode: ${mode || "(empty)"}`);
  if (!METRIC_SET.has(metric)) throw new Error(`Unsupported reward challenge metric: ${metric || "(empty)"}`);
  if (!OPERATOR_SET.has(operator)) throw new Error(`Unsupported reward challenge operator: ${operator || "(empty)"}`);
  if (!PERIOD_SET.has(periodType)) throw new Error(`Unsupported reward challenge period: ${periodType || "(empty)"}`);

  const threshold = finiteNumber(input.threshold, metric === "exercise_session" || metric === "tracker_completion" ? 1 : null);
  if (threshold === null) throw new Error("Reward challenge threshold must be a finite number");

  const period = { type: periodType };
  if (periodType === "rolling_days") {
    period.days = positiveInteger(input?.period?.days ?? input.days, 0);
    if (!period.days) throw new Error("rolling_days challenge requires period.days > 0");
  } else if (periodType === "date_range") {
    period.startDate = normalizeLocalDate(input?.period?.startDate || input.startDate);
    period.endDate = normalizeLocalDate(input?.period?.endDate || input.endDate);
    if (!period.startDate || !period.endDate || compareLocalDates(period.startDate, period.endDate) > 0) {
      throw new Error("date_range challenge requires a valid startDate <= endDate");
    }
  }

  const normalized = {
    schemaVersion: REWARD_CHALLENGE_SCHEMA_VERSION,
    mode,
    metric,
    operator,
    threshold,
    targetCount: 0,
    targetTotal: 0,
    period,
    trackerId: metric === "tracker_completion" ? normalizeText(input.trackerId) : "",
    timezone: normalizeText(input.timezone) || "Asia/Shanghai",
  };

  if (mode === "streak" || mode === "count_in_period") {
    normalized.targetCount = positiveInteger(input.targetCount, 0);
    if (!normalized.targetCount) throw new Error(`${mode} challenge requires targetCount > 0`);
  } else {
    normalized.targetTotal = finiteNumber(input.targetTotal, null);
    if (normalized.targetTotal === null || normalized.targetTotal <= 0) {
      throw new Error("cumulative challenge requires targetTotal > 0");
    }
  }

  if (metric === "tracker_completion" && !normalized.trackerId) {
    throw new Error("tracker_completion challenge requires trackerId");
  }

  return normalized;
}

function defaultOperatorForMetric(metric) {
  return metric === "bedtime_minutes" ? "<=" : ">=";
}

export function resolveRewardChallengePeriod(ruleInput, { today = "" } = {}) {
  const rule = ruleInput?.schemaVersion === REWARD_CHALLENGE_SCHEMA_VERSION
    ? ruleInput
    : normalizeRewardChallengeRule(ruleInput);
  const anchor = normalizeLocalDate(today);

  if (rule.period.type === "date_range") {
    return { startDate: rule.period.startDate, endDate: rule.period.endDate };
  }

  if (!anchor) throw new Error(`${rule.period.type} challenge requires a valid today date`);

  if (rule.period.type === "rolling_days") {
    return {
      startDate: addDays(anchor, -(rule.period.days - 1)),
      endDate: anchor,
    };
  }

  // Calendar week is Monday-Sunday, independent of process locale.
  const day = new Date(`${anchor}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const startDate = addDays(anchor, -daysSinceMonday);
  return { startDate, endDate: addDays(startDate, 6) };
}

export function listLocalDates(startDate, endDate) {
  const start = normalizeLocalDate(startDate);
  const end = normalizeLocalDate(endDate);
  if (!start || !end || compareLocalDates(start, end) > 0) return [];
  const result = [];
  for (let cursor = start; compareLocalDates(cursor, end) <= 0; cursor = addDays(cursor, 1)) {
    result.push(cursor);
  }
  return result;
}

function normalizeFact(raw, metric) {
  if (raw === null || raw === undefined) return { known: false, value: null };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.known === false || raw.status === "unknown") return { known: false, value: null };
    if (Object.prototype.hasOwnProperty.call(raw, "value")) return normalizeFact(raw.value, metric);
  }
  if (metric === "bedtime_minutes") {
    const value = normalizeBedtimeMinutes(raw);
    return { known: value !== null, value };
  }
  if (metric === "exercise_session" || metric === "tracker_completion") {
    if (typeof raw === "boolean") return { known: true, value: raw ? 1 : 0 };
  }
  const value = finiteNumber(raw, null);
  return { known: value !== null, value };
}

function qualifies(value, operator, threshold) {
  if (operator === ">=") return value >= threshold;
  if (operator === "<=") return value <= threshold;
  return value === threshold;
}

/**
 * Evaluate a normalized challenge against server-provided daily facts.
 *
 * `factsByDate` is intentionally a narrow pure contract. The Firestore layer
 * owns translating settlements / reading / Keep / tracker records into this
 * map; this evaluator never guesses from chat history or planned timeline.
 */
export function evaluateRewardChallenge(ruleInput, factsByDate = {}, { today = "" } = {}) {
  const rule = ruleInput?.schemaVersion === REWARD_CHALLENGE_SCHEMA_VERSION
    ? ruleInput
    : normalizeRewardChallengeRule(ruleInput);
  const period = resolveRewardChallengePeriod(rule, { today });
  const dates = listLocalDates(period.startDate, period.endDate);
  const days = dates.map((date) => {
    const fact = normalizeFact(factsByDate?.[date], rule.metric);
    return {
      date,
      known: fact.known,
      value: fact.value,
      qualifies: fact.known ? qualifies(fact.value, rule.operator, rule.threshold) : false,
    };
  });

  const unknownDates = days.filter((day) => !day.known).map((day) => day.date);
  const qualifyingDates = days.filter((day) => day.qualifies).map((day) => day.date);

  if (rule.mode === "cumulative") {
    const current = days.reduce((sum, day) => sum + (day.known && Number.isFinite(day.value) ? day.value : 0), 0);
    const completed = current >= rule.targetTotal;
    return buildProgress({
      rule,
      period,
      days,
      unknownDates,
      qualifyingDates,
      current,
      target: rule.targetTotal,
      completed,
      detail: { total: current },
    });
  }

  if (rule.mode === "count_in_period") {
    const current = qualifyingDates.length;
    const completed = current >= rule.targetCount;
    return buildProgress({
      rule,
      period,
      days,
      unknownDates,
      qualifyingDates,
      current,
      target: rule.targetCount,
      completed,
      detail: { qualifyingCount: current },
    });
  }

  let longestStreak = 0;
  let running = 0;
  let currentStreak = 0;
  for (const day of days) {
    if (day.known && day.qualifies) {
      running += 1;
      longestStreak = Math.max(longestStreak, running);
    } else {
      // Unknown cannot satisfy a confirmed consecutive chain. Re-evaluation
      // after the source is filled may restore the chain automatically.
      running = 0;
    }
  }
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (!day.known || !day.qualifies) break;
    currentStreak += 1;
  }
  const completed = longestStreak >= rule.targetCount;
  return buildProgress({
    rule,
    period,
    days,
    unknownDates,
    qualifyingDates,
    current: Math.min(longestStreak, rule.targetCount),
    target: rule.targetCount,
    completed,
    detail: { longestStreak, currentStreak },
  });
}

function buildProgress({ rule, period, days, unknownDates, qualifyingDates, current, target, completed, detail }) {
  const hasKnownEvidence = days.some((day) => day.known);
  return {
    schemaVersion: REWARD_CHALLENGE_SCHEMA_VERSION,
    mode: rule.mode,
    metric: rule.metric,
    period,
    status: completed ? "claimable" : hasKnownEvidence ? "in_progress" : "locked",
    completed,
    current,
    target,
    ratio: target > 0 ? Math.max(0, Math.min(1, current / target)) : 0,
    qualifyingDates,
    unknownDates,
    days,
    detail,
  };
}
