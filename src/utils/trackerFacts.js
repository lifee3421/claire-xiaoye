// The unified tracker fact layer. Consumes only already-extracted, already
// -reconciled CompletionEvent records (see src/services/completionEvents.js
// for how those are derived from a saved settlement) — this module never
// reads a settlement, timeline block, Focus record, or draft directly. That
// separation is deliberate: extraction/matching lives in completionEvents.js,
// pure aggregation-into-facts lives here, so each half is independently
// testable.
import { addInterval, calendarBounds, diffDays, shiftDate, validDate } from "./plannerOverview.js";

function unitDaysFor(unit) {
  if (unit === "week") return 7;
  return 1; // month/year handled by addInterval's calendar-aware math, not a fixed day count
}

function isActive(event) {
  return event && event.state === "active" && validDate(event.occurredOn);
}

function lastCompletedDateOf(events) {
  return events.map((event) => event.occurredOn).sort().at(-1) || null;
}

function nextDueDateForInterval(schedule, lastCompletedDate) {
  if (!lastCompletedDate) return null;
  const { every = 1, unit = "day" } = schedule;
  if (unit === "month" || unit === "year") return addInterval(lastCompletedDate, every, unit);
  return shiftDate(lastCompletedDate, every * unitDaysFor(unit));
}

function scheduleStatusForInterval(schedule, lastCompletedDate, today) {
  const nextDueDate = nextDueDateForInterval(schedule, lastCompletedDate);
  if (!nextDueDate) return { scheduleStatus: "overdue", nextDueDate: null }; // never completed: always due
  const diff = diffDays(nextDueDate, today);
  if (diff > 0) return { scheduleStatus: "upcoming", nextDueDate };
  if (diff === 0) return { scheduleStatus: "due_today", nextDueDate };
  return { scheduleStatus: "overdue", nextDueDate };
}

function scheduleStatusForDeadline(schedule, lastCompletedDate, today) {
  const dueDate = validDate(schedule.dueDate) ? schedule.dueDate : null;
  if (!dueDate) return { scheduleStatus: "link_broken", nextDueDate: null };
  if (lastCompletedDate && diffDays(lastCompletedDate, dueDate) >= 0) return { scheduleStatus: "completed_period", nextDueDate: dueDate };
  const diff = diffDays(dueDate, today);
  if (diff > 0) return { scheduleStatus: "upcoming", nextDueDate: dueDate };
  if (diff === 0) return { scheduleStatus: "due_today", nextDueDate: dueDate };
  return { scheduleStatus: "overdue", nextDueDate: dueDate };
}

function aggregate(events, aggregation) {
  if (aggregation === "sum") return events.reduce((sum, event) => sum + (Number(event.value) || 0), 0);
  // occurrence / active_days both count distinct days — a tracker is either
  // "done that day" or not, duplicate same-day evidence never double-counts.
  return new Set(events.map((event) => event.occurredOn)).size;
}

function scheduleStatusForPeriod(schedule, goal, events, today) {
  const period = calendarBounds(today, schedule.period || "week");
  if (!period) return { scheduleStatus: "link_broken", nextDueDate: null, period: null, progress: null };
  const windowEvents = events.filter((event) => event.occurredOn >= period.start && event.occurredOn <= period.end);
  const current = aggregate(windowEvents, goal.aggregation);
  const target = Math.max(1, Number(goal.target) || 1);
  const remaining = Math.max(0, target - current);
  const progress = { current, target, unit: goal.unit, remaining };

  if (remaining <= 0) return { scheduleStatus: "completed_period", nextDueDate: period.end, period, progress };
  if (today > period.end) return { scheduleStatus: "overdue", nextDueDate: period.end, period, progress };
  if (today === period.end) return { scheduleStatus: "due_today", nextDueDate: period.end, period, progress };

  // "behind" is only computable precisely for active_days (hard cap of one
  // completion per remaining day). For "sum" there is no per-day ceiling the
  // tracker config specifies, so we deliberately do not fabricate a pacing
  // threshold — sum-based period trackers stay on_track until the final day.
  if (goal.aggregation === "active_days") {
    const daysLeftIncludingToday = diffDays(period.end, today) + 1;
    if (daysLeftIncludingToday < remaining) return { scheduleStatus: "behind", nextDueDate: period.end, period, progress };
  }
  return { scheduleStatus: "on_track", nextDueDate: period.end, period, progress };
}

function computeBindingHealth(tracker, checkBindingHealth) {
  const bindings = Array.isArray(tracker.evidenceBindings) ? tracker.evidenceBindings : [];
  return bindings.map((binding) => {
    const result = typeof checkBindingHealth === "function" ? checkBindingHealth(binding) : { healthy: true };
    return { bindingType: binding.type, categoryId: binding.categoryId, healthy: result?.healthy !== false, reason: result?.reason || null };
  });
}

function isJudgmentDay(scheduleStatus, scheduleKind) {
  if (scheduleKind === "period") return true; // every day within a period can contribute to that period's goal
  return scheduleStatus === "due_today" || scheduleStatus === "overdue" || scheduleStatus === "behind";
}

/**
 * @param {object} tracker - unified Tracker config (schedule/goal/evidenceBindings)
 * @param {object} options
 * @param {Array} options.events - ALL CompletionEvents for this trackerId (active + retracted); filtered internally
 * @param {string} options.today - Asia/Shanghai YYYY-MM-DD
 * @param {boolean} options.todaySettlementExists - whether today's daily-review settlement has been saved
 * @param {function} [options.checkBindingHealth] - (binding) => { healthy: boolean, reason?: string }
 */
export function resolveTrackerEvidence(tracker = {}, { events = [], today = "", todaySettlementExists = false, checkBindingHealth } = {}) {
  const activeEvents = (Array.isArray(events) ? events : []).filter(isActive);
  const lastCompletedDate = lastCompletedDateOf(activeEvents);
  const schedule = tracker.schedule || {};
  const goal = tracker.goal || {};

  const bindingHealth = computeBindingHealth(tracker, checkBindingHealth);
  const hasHealthyBinding = bindingHealth.length === 0 || bindingHealth.some((entry) => entry.healthy);
  const hasBrokenBindings = bindingHealth.some((entry) => !entry.healthy);
  const linkBroken = bindingHealth.length > 0 && !hasHealthyBinding;

  let scheduleResult;
  if (linkBroken) {
    scheduleResult = { scheduleStatus: "link_broken", nextDueDate: null, period: null, progress: null };
  } else if (schedule.kind === "period") {
    scheduleResult = scheduleStatusForPeriod(schedule, goal, activeEvents, today);
  } else if (schedule.kind === "deadline") {
    scheduleResult = { ...scheduleStatusForDeadline(schedule, lastCompletedDate, today), period: null, progress: null };
  } else {
    scheduleResult = { ...scheduleStatusForInterval(schedule, lastCompletedDate, today), period: null, progress: null };
  }

  const hasTodayEvidence = activeEvents.some((event) => event.occurredOn === today);
  const needsJudgmentToday = validDate(today) && isJudgmentDay(scheduleResult.scheduleStatus, schedule.kind);
  let todayReviewStatus;
  if (!todaySettlementExists) {
    todayReviewStatus = needsJudgmentToday ? "not_saved" : "not_applicable";
  } else if (hasTodayEvidence) {
    todayReviewStatus = "confirmed_complete";
  } else {
    todayReviewStatus = needsJudgmentToday ? "confirmed_no_evidence" : "not_applicable";
  }

  return {
    trackerId: tracker.id,
    title: tracker.title,
    scheduleStatus: scheduleResult.scheduleStatus,
    todayReviewStatus,
    period: scheduleResult.period,
    progress: scheduleResult.progress,
    lastCompletedDate,
    nextDueDate: scheduleResult.nextDueDate,
    hasBrokenBindings,
    bindingHealth,
    linkBroken,
    evidence: activeEvents,
    sourceSummary: activeEvents.at(-1)?.evidenceSummary || "",
  };
}
