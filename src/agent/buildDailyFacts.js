/**
 * Builds the Planned / Actual / Unknown fact layer for a day's AgentDaySnapshot.
 *
 * This is the single place that decides whether a number describes what was
 * SCHEDULED (`plan`) or what actually HAPPENED (`actual`), and how confident
 * that "actually happened" claim is (`actualStatus`). Nothing downstream
 * (chat tools, reminders, review commentary) should re-derive these numbers
 * from raw timeline blocks — they should consume this object.
 *
 * `actualStatus` ordering, most to least trustworthy:
 *   - "authoritative": the day's final review (settlement) has been submitted.
 *     settlement.studyMinutes is what the user themselves confirmed as the
 *     day's real total — it wins over timeline checkboxes or any other guess.
 *   - "provisional": no submitted settlement yet, but at least one timeline
 *     block has been manually marked completed. This is weak evidence (a
 *     checkbox, not a verified session) and must be phrased as "recorded so
 *     far", never as the day's final total.
 *   - "unknown": neither exists. There is nothing to report as actual.
 *
 * claire-xiaoye has no visibility into Focus/Pomodoro session data (that
 * lives in the separate Cyberboss service) — `actual.focusMinutes` is
 * intentionally left null here with a sourceMap note; Cyberboss is expected
 * to merge its own Focus data in without downgrading an "authoritative"
 * status set here.
 */

const STUDY_STAT_GROUPS = new Set(["study", "reading"]);

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * @param {object} params
 * @param {string} params.localDate - snapshot date (YYYY-MM-DD)
 * @param {Array} params.taskBlocks - normalized, non-fixed timeline blocks
 *   (each with `plannedMinutes`, `status`, `statGroup`)
 * @param {object|null} params.settlement - the submitted settlement/review
 *   doc for this date, if any (e.g. `{ studyMinutes, createdAt, ... }`)
 * @param {Date} params.now
 */
export function buildDailyFacts({ localDate, taskBlocks = [], settlement = null, now = new Date() } = {}) {
  const completed = taskBlocks.filter((block) => block.status === "completed");
  const completedStudyBlocks = completed.filter((block) => STUDY_STAT_GROUPS.has(block.statGroup));

  const scheduledStudyMinutes = taskBlocks
    .filter((block) => STUDY_STAT_GROUPS.has(block.statGroup))
    .reduce((sum, block) => sum + block.plannedMinutes, 0);

  const completedTimelineMinutes = completed.reduce((sum, block) => sum + block.plannedMinutes, 0);
  const completedStudyTimelineMinutes = completedStudyBlocks.reduce((sum, block) => sum + block.plannedMinutes, 0);

  const settlementStudyMinutes = settlement ? num(settlement.studyMinutes) : null;
  const hasAuthoritativeSettlement = settlement != null && settlementStudyMinutes !== null;
  const hasProvisionalEvidence = completed.length > 0;

  const actualStatus = hasAuthoritativeSettlement
    ? "authoritative"
    : hasProvisionalEvidence
      ? "provisional"
      : "unknown";

  const reviewReportedMinutes = hasAuthoritativeSettlement ? settlementStudyMinutes : null;
  const pureStudyMinutes = hasAuthoritativeSettlement
    ? settlementStudyMinutes
    : hasProvisionalEvidence
      ? completedStudyTimelineMinutes
      : null;

  const sources = [];
  if (hasAuthoritativeSettlement) sources.push("settlement");
  if (hasProvisionalEvidence) sources.push("completedTimelineCards");

  return {
    localDate,
    asOf: (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()).toISOString(),
    reviewRevision: settlement?.existingSettlementId || settlement?.reviewDate || null,
    plan: {
      scheduledStudyMinutes,
      scheduledBlockCount: taskBlocks.filter((block) => STUDY_STAT_GROUPS.has(block.statGroup)).length,
    },
    actual: {
      // Focus session data lives outside this service; left null for the
      // downstream (Cyberboss) merge step to fill in — never fabricate it here.
      focusMinutes: null,
      completedTimelineMinutes,
      reviewReportedMinutes,
      pureStudyMinutes,
      completedBlockCount: completed.length,
    },
    actualStatus,
    evidenceStatus: {
      actualStudyKnown: actualStatus !== "unknown",
      sources,
      // claire-xiaoye only ever sees one internal source of "actual" data
      // (settlement vs timeline checkboxes are not independent — settlement
      // supersedes timeline, it never conflicts with it at this layer).
      // Cross-source conflicts (e.g. vs. Focus) are detected by Cyberboss
      // once it merges its own Focus data in, and appended here downstream.
      conflicts: [],
    },
    sourceMap: {
      "plan.scheduledStudyMinutes": "timeline: sum of plannedMinutes for all non-fixed study/reading blocks, regardless of completion status",
      "plan.scheduledBlockCount": "timeline: count of non-fixed study/reading blocks",
      "actual.focusMinutes": "unavailable in claire-xiaoye — merged in by Cyberboss from Focus/Pomodoro sync",
      "actual.completedTimelineMinutes": "timeline: sum of plannedMinutes for blocks with status==='completed' (any category)",
      "actual.reviewReportedMinutes": hasAuthoritativeSettlement
        ? `settlements/${localDate}.studyMinutes (submitted final review)`
        : "unavailable — no submitted settlement for this date",
      "actual.pureStudyMinutes": hasAuthoritativeSettlement
        ? `settlements/${localDate}.studyMinutes (submitted final review)`
        : hasProvisionalEvidence
          ? "timeline: sum of plannedMinutes for study/reading blocks with status==='completed' (provisional, not focus-verified)"
          : "unavailable — no submitted settlement and no completed study blocks",
      "actual.completedBlockCount": "timeline: count of blocks with status==='completed' (any category)",
    },
  };
}
