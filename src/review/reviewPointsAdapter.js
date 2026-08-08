import {
  calculateBankPointsAdded,
  calculateFreeEntertainmentScore,
  calculateGeneratedMinutes,
  calculateSleepAdjustmentFromTime,
  calculateWorkPoints,
  reviewTimelinessScore,
  roundPoints,
} from "../utils/calculations.js";
import { classifyDay } from "../utils/dayType.js";
import { buildLegacyReviewValues, value } from "./reviewDraftSerializer.js";

function beijingIsoDate(value) {
  if (!value) return "";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return fields.year && fields.month && fields.day ? `${fields.year}-${fields.month}-${fields.day}` : "";
}

// Timeliness is a first-submission fact, not a live clock-dependent value.
// Once a draft has submittedAt, reopening/revising it tomorrow must preserve
// the score earned at the original submission instead of silently changing
// settlement.pointsAdded just because the calendar date moved on.
export function resolveReviewTimelinessReferenceDate(draft, today = draft?.date || "") {
  return beijingIsoDate(draft?.submittedAt) || today;
}

// This module deliberately only adapts the workbench's final field values to
// the existing point functions.  The point rules continue to live in their
// original modules.
export function buildSettlementInputFromReview(draft, profile = {}, today = draft.date, taxonomy = []) {
  const legacy = buildLegacyReviewValues(draft, { taxonomy });
  const exerciseIntensity = legacy.exerciseIntensity === "中高强度"
    ? "medium_high"
    : legacy.exerciseIntensity === "低强度" ? "low" : "none";
  const sleep = calculateSleepAdjustmentFromTime(legacy.bedtime);
  const detail = calculateGeneratedMinutes({
    ...legacy,
    exerciseIntensity,
    sleepAdjustment: sleep.value,
    beneficialMinutes: 0,
  });
  const isTravelDay = value(draft, "summary.isTravelDay") === "是";
  const day = classifyDay({ ...legacy, isTravelDay, travelDayBonusPoints: Number(profile.travelDayBonusPoints || 1) });
  const entertainment = calculateFreeEntertainmentScore(legacy.totalEntertainmentMinutes);
  const bankPointsAdded = calculateBankPointsAdded(detail.availableMinutes);
  const workPoints = calculateWorkPoints(legacy.workMinutes);
  const reviewTimelinessBonus = reviewTimelinessScore(draft.date, resolveReviewTimelinessReferenceDate(draft, today));
  const pointsAdded = roundPoints(
    bankPointsAdded
      + detail.sleepAdjustment
      + detail.exerciseBonusPoints
      + workPoints
      + Number(day.bonusPoints || 0)
      + reviewTimelinessBonus
      + entertainment.scoreDelta,
  );

  return {
    ...legacy,
    ...detail,
    exerciseIntensity,
    exerciseIntensityText: legacy.exerciseIntensity,
    reviewDate: draft.date,
    bankPointsAdded,
    workPoints,
    reviewTimelinessBonus,
    sleepAdjustmentPoints: detail.sleepAdjustment,
    exerciseBonusPoints: detail.exerciseBonusPoints,
    dayTypeBonusPoints: Number(day.bonusPoints || 0),
    dayTypeDisplayName: day.displayName,
    nextDayEntertainmentSourceDayType: day.dayType,
    nextDayEntertainmentLimitReason: day.reason,
    entertainmentScoreDelta: entertainment.scoreDelta,
    entertainmentScoreLabel: entertainment.label,
    freeEntertainmentLimitMinutes: entertainment.limitMinutes,
    pointsAdded,
    finalDurationConfirmed: true,
    isTravelDay,
    travelDayBonusPoints: Number(profile.travelDayBonusPoints || 1),
  };
}
