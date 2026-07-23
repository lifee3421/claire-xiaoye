export function buildMaskCyclePatch(settlement = {}, previousMaskCycle = {}) {
  const hasExplicitPlan = typeof settlement.maskCycleStatus === "string"
    && settlement.maskCycleStatus.trim() !== ""
    && typeof settlement.maskCycleMessage === "string"
    && settlement.maskCycleMessage.trim() !== ""
    && /^\d{4}-\d{2}-\d{2}$/.test(String(settlement.maskTomorrowDate || ""));
  if (!hasExplicitPlan) return null;
  return {
    ...(previousMaskCycle || {}),
    lastMaskDateAfterReview: settlement.lastMaskDateAfterReview || settlement.lastMaskDateBeforeReview || "",
    shouldScheduleMaskTomorrow: settlement.shouldScheduleMaskTomorrow === true,
    tomorrowDate: settlement.maskTomorrowDate,
    status: settlement.maskCycleStatus,
    message: settlement.maskCycleMessage,
    nextSuggestedDate: settlement.nextMaskSuggestedDate || "",
    updatedFromReviewDate: settlement.reviewDate || "",
  };
}
