import { LIFE_CATEGORY_IDS } from "./unifiedPlannerCards.js";

const MEAL_CATEGORY_IDS = new Set([
  LIFE_CATEGORY_IDS.lunch,
  LIFE_CATEGORY_IDS.dinner,
]);

const MEAL_TITLE_PATTERN = /(?:早餐|午餐|晚餐|吃饭|用餐)/;

/**
 * Manual completion toggles are intentionally reserved for meal/life cards.
 * Study/work completion is measured from Focus/review facts and should not
 * have a second, contradictory manual checkbox on the planner timeline.
 */
export function shouldShowTimelineCompletionToggle(block = {}) {
  if (!block || block.status === "rescheduled" || block.status === "cancelled") return false;
  if (block.type === "meal") return true;
  if (MEAL_CATEGORY_IDS.has(block.categoryId)) return true;
  return block.kind === "fixed" && MEAL_TITLE_PATTERN.test(String(block.title || ""));
}
