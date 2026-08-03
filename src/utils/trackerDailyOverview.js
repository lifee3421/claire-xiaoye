import { diffDays, validDate } from "./plannerOverview.js";

function dateLabel(date) {
  if (!validDate(date)) return "";
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export function relativeDateLabel(date, today) {
  if (!validDate(date) || !validDate(today)) return "";
  const distance = diffDays(date, today);
  if (distance === 0) return "今天";
  if (distance === -1) return "昨天";
  if (distance === 1) return "明天";
  return distance < 0 ? `${Math.abs(distance)}天前` : `${distance}天后`;
}

export function dateWithRelativeLabel(date, today) {
  const label = dateLabel(date);
  const relative = relativeDateLabel(date, today);
  return label && relative ? `${label} · ${relative}` : label || "";
}

function unitLabel(unit) {
  const labels = { days: "天", day: "天", minutes: "分钟", minute: "分钟", times: "次", occurrence: "次" };
  return labels[unit] || unit || "";
}

function periodLabel(period) {
  return { week: "本周", month: "本月", year: "本年" }[period] || "当前周期";
}

function statusLabel(status) {
  return {
    upcoming: "即将到期",
    due_today: "今天到期",
    overdue: "已逾期",
    on_track: "进行中",
    behind: "落后",
    completed_period: "已完成",
    link_broken: "配置异常",
  }[status] || "进行中";
}

/**
 * Presentation-only projection for the schedule sidebar. Its input Facts are
 * already derived solely from active CompletionEvents; this module never
 * reads settlements, timeline blocks, Focus sessions, or stickers.
 *
 * `hasMigratableHistory` is a PER-TRACKER flag (see computeMigratableHistoryByTracker):
 * true only when THIS tracker still has mechanically identifiable old evidence
 * in the saved settlements that has not yet been migrated. It replaces the old
 * account-wide "any settlement exists" flag, so a tracker with no historical
 * evidence of its own is no longer lumped into "历史尚未迁移".
 */
export function projectTrackerDailyOverview({ tracker = {}, facts = {}, today, hasMigratableHistory = false } = {}) {
  const requiresSetup = tracker.requiresSetup === true || facts.requiresSetup === true;
  if (requiresSetup) return { kind: "requires_setup", status: "待设置", lines: [] };
  if (tracker.enabled === false) return { kind: "disabled", status: "已停用", lines: [] };

  const hasCompletion = validDate(facts.lastCompletedDate);
  if (hasCompletion) {
    const schedule = tracker.schedule || {};
    const goal = tracker.goal || {};
    const progress = facts.progress || { current: 0, target: Number(goal.target) || 0, remaining: Number(goal.target) || 0, unit: goal.unit };
    const unit = unitLabel(progress.unit || goal.unit);

    if (schedule.kind === "period") {
      const current = Number(progress.current) || 0;
      const target = Number(progress.target) || 0;
      const remaining = Math.max(0, Number(progress.remaining) || 0);
      return {
        kind: goal.aggregation === "sum" ? "sum" : "active_days",
        status: statusLabel(facts.scheduleStatus),
        noCurrentPeriodRecords: current === 0,
        lines: [`${periodLabel(schedule.period)}：${current} / ${target} ${unit}`.trim(), remaining > 0 ? `还差：${remaining}${unit}` : "目标已完成"],
      };
    }

    return {
      kind: "interval",
      status: statusLabel(facts.scheduleStatus),
      lines: [
        `上次：${dateWithRelativeLabel(facts.lastCompletedDate, today)}`,
        facts.nextDueDate ? `下次：${dateWithRelativeLabel(facts.nextDueDate, today)}` : "",
      ].filter(Boolean),
    };
  }

  if (hasMigratableHistory) return { kind: "history_not_migrated", status: "历史尚未迁移", lines: ["上次：历史尚未迁移"] };
  return { kind: "no_history", status: "暂无已确认记录", lines: ["上次：暂无已确认记录"] };
}
