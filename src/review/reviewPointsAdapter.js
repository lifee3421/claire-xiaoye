import {
  calculateBankPointsAdded,
  calculateFreeEntertainmentScore,
  calculateGeneratedMinutes,
  calculateSleepAdjustmentFromTime,
  calculateWorkPoints,
  roundPoints,
} from "../utils/calculations.js";
import { classifyDay } from "../utils/dayType.js";
import { buildLegacyReviewValues } from "./reviewDraftSerializer.js";

// This module deliberately only adapts the workbench's final field values to
// the existing point functions.  The point rules continue to live in their
// original modules.
export function buildSettlementInputFromReview(draft, profile = {}, today = draft.date) {
  const legacy = buildLegacyReviewValues(draft);
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
  const day = classifyDay({ ...legacy, isTravelDay: false });
  const entertainment = calculateFreeEntertainmentScore(legacy.totalEntertainmentMinutes);
  const bankPointsAdded = calculateBankPointsAdded(detail.availableMinutes);
  const workPoints = calculateWorkPoints(legacy.workMinutes);
  const reviewTimelinessBonus = draft.date === today ? 1 : 0.5;
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
    isTravelDay: false,
    travelDayBonusPoints: Number(profile.travelDayBonusPoints || 1),
  };
}
