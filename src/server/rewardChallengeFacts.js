import { resolveEffectiveReviewValue } from "../review/effectiveReviewValue.js";
import { normalizeBedtimeMinutes } from "./rewardChallengeCore.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fieldValue(settlement, fieldId) {
  const state = settlement?.reviewData?.fields?.[fieldId];
  if (!state) return null;
  const resolved = resolveEffectiveReviewValue(state);
  return resolved === "" || resolved === null || resolved === undefined ? null : resolved;
}

function reviewDateOf(settlement) {
  return text(settlement?.reviewDate || settlement?.date || settlement?.reviewData?.date);
}

function mapByDate(rows = [], dateOf) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = dateOf(row);
    if (!date) continue;
    const previous = map.get(date);
    // listDocs order is not a correctness dependency. When duplicate dated
    // settlements somehow exist, prefer the higher explicit revision.
    const revision = Number(row?.settlementRevision || 0);
    const previousRevision = Number(previous?.settlementRevision || 0);
    if (!previous || revision >= previousRevision) map.set(date, row);
  }
  return map;
}

function within(date, startDate, endDate) {
  return Boolean(date) && date >= startDate && date <= endDate;
}

export function buildStudyMinuteFacts(settlements = [], { startDate, endDate } = {}) {
  const byDate = mapByDate(settlements, reviewDateOf);
  const facts = {};
  for (const [date, settlement] of byDate) {
    if (!within(date, startDate, endDate)) continue;
    const value = finite(settlement?.studyMinutes);
    if (value === null) continue;
    facts[date] = { known: true, value, source: "settlement.studyMinutes" };
  }
  return facts;
}

export function buildReadingMinuteFacts(settlements = [], { startDate, endDate } = {}) {
  const byDate = mapByDate(settlements, reviewDateOf);
  const facts = {};
  for (const [date, settlement] of byDate) {
    if (!within(date, startDate, endDate)) continue;
    const direct = finite(settlement?.readingMinutes);
    const fromReview = finite(fieldValue(settlement, "study.reading.totalMinutes"));
    const value = direct ?? fromReview;
    if (value === null) continue;
    facts[date] = { known: true, value, source: direct !== null ? "settlement.readingMinutes" : "settlement.reviewData" };
  }
  return facts;
}

export function buildBedtimeFacts(settlements = [], { startDate, endDate } = {}) {
  const byDate = mapByDate(settlements, reviewDateOf);
  const facts = {};
  for (const [date, settlement] of byDate) {
    if (!within(date, startDate, endDate)) continue;
    const raw = settlement?.bedtime ?? fieldValue(settlement, "sleep.yesterday.bedtime");
    const value = normalizeBedtimeMinutes(raw);
    if (value === null) continue;
    facts[date] = { known: true, value, source: "settlement.sleep.yesterday.bedtime" };
  }
  return facts;
}

function exerciseDateOf(record) {
  return text(record?.date || record?.localDate || record?.occurredOn);
}

function exerciseMinutesOf(record) {
  const candidates = [
    record?.totalMinutes,
    record?.minutes,
    record?.durationMinutes,
    record?.summary?.totalMinutes,
  ];
  for (const candidate of candidates) {
    const value = finite(candidate);
    if (value !== null) return Math.max(0, value);
  }
  return null;
}

export function buildExerciseFacts(records = [], { startDate, endDate, sessionOnly = false } = {}) {
  const facts = {};
  for (const record of Array.isArray(records) ? records : []) {
    const date = exerciseDateOf(record);
    if (!within(date, startDate, endDate)) continue;
    const minutes = exerciseMinutesOf(record);
    if (sessionOnly) {
      // A server-synced record is authoritative evidence that the day is
      // known. Positive minutes (or an explicit activity) means a session.
      const hasSession = (minutes !== null && minutes > 0) || Boolean(text(record?.activity || record?.sport || record?.type));
      facts[date] = { known: true, value: hasSession ? 1 : 0, source: "exerciseRecords" };
    } else if (minutes !== null) {
      facts[date] = { known: true, value: minutes, source: "exerciseRecords" };
    }
  }
  return facts;
}

export function buildTrackerCompletionFacts(events = [], { trackerId, startDate, endDate } = {}) {
  const wanted = text(trackerId);
  const facts = {};
  for (const event of Array.isArray(events) ? events : []) {
    if (text(event?.trackerId) !== wanted || event?.state === "retracted") continue;
    const date = text(event?.occurredOn);
    if (!within(date, startDate, endDate)) continue;
    facts[date] = { known: true, value: 1, source: "completionEvents" };
  }
  return facts;
}

export function buildFactsForRewardChallenge(rule, sources = {}, period = {}) {
  const options = { startDate: period.startDate, endDate: period.endDate };
  switch (rule?.metric) {
    case "study_minutes":
      return buildStudyMinuteFacts(sources.settlements, options);
    case "reading_minutes":
      return buildReadingMinuteFacts(sources.settlements, options);
    case "bedtime_minutes":
      return buildBedtimeFacts(sources.settlements, options);
    case "exercise_minutes":
      return buildExerciseFacts(sources.exerciseRecords, options);
    case "exercise_session":
      return buildExerciseFacts(sources.exerciseRecords, { ...options, sessionOnly: true });
    case "tracker_completion":
      return buildTrackerCompletionFacts(sources.completionEvents, { ...options, trackerId: rule.trackerId });
    default:
      return {};
  }
}
