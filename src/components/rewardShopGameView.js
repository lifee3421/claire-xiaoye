const METRIC_LABELS = Object.freeze({
  study_minutes: "学习",
  reading_minutes: "阅读",
  bedtime_minutes: "上床时间",
  exercise_minutes: "运动",
  exercise_session: "运动打卡",
  tracker_completion: "习惯打卡",
});

export function challengeStatus(challenge = {}) {
  if (challenge.state === "claimed" || challenge.progress?.status === "claimed") {
    return { key: "claimed", label: "✅ 已领取", claimable: false };
  }
  if (challenge.progress?.completed || challenge.progress?.status === "claimable") {
    return { key: "claimable", label: "🎁 可领取", claimable: true };
  }
  if (challenge.progress?.status === "expired") {
    return { key: "expired", label: "已结束", claimable: false };
  }
  if (challenge.progress?.status === "in_progress") {
    return { key: "in_progress", label: "🟡 进行中", claimable: false };
  }
  return { key: "locked", label: "🔒 等待进度", claimable: false };
}

export function challengeProgressText(challenge = {}) {
  const progress = challenge.progress || {};
  const current = finite(progress.current, 0);
  const target = finite(progress.target, 0);
  if (!target) return "等待可验证数据";
  return `${formatMetricValue(challenge.rule?.metric, current)} / ${formatMetricValue(challenge.rule?.metric, target)}`;
}

export function challengeRuleText(challenge = {}) {
  const rule = challenge.rule || {};
  const metric = METRIC_LABELS[rule.metric] || "目标";
  const threshold = thresholdText(rule.metric, rule.threshold);
  const period = periodText(rule.period);
  if (rule.mode === "streak") {
    return `连续 ${finite(rule.targetCount, 0)} 天${metric}${operatorText(rule.operator)}${threshold}${period}`;
  }
  if (rule.mode === "count_in_period") {
    return `${period || "本周期"}任意 ${finite(rule.targetCount, 0)} 天${metric}${operatorText(rule.operator)}${threshold}`;
  }
  if (rule.mode === "cumulative") {
    return `${period || "本周期"}${metric}累计达到 ${formatMetricValue(rule.metric, rule.targetTotal)}`;
  }
  return challenge.description || "完成雪尘设置的小目标";
}

export function challengeRewardText(challenge = {}) {
  const rewardName = challenge.reward?.name || "挑战奖励";
  const pointPrice = Math.max(0, finite(challenge.pointPrice, 0));
  return pointPrice > 0 ? `${rewardName} · 解锁后 ${pointPrice} 分领取` : `${rewardName} · 完成后免费领取`;
}

export function surpriseMetaText(item = {}) {
  const bits = [];
  if (item.stock !== null && item.stock !== undefined) bits.push(`库存 ${Math.max(0, Number(item.stock) || 0)}`);
  const expiresAt = item.surprise?.expiresAt;
  if (expiresAt && !Number.isNaN(Date.parse(expiresAt))) {
    bits.push(`截止 ${formatLocalDateTime(expiresAt)}`);
  }
  return bits.join(" · ") || "限时出现";
}

export function surpriseDescription(item = {}) {
  if (item.surprise?.revealMode === "after_claim") return "神秘奖励：兑换后揭晓 ✨";
  return item.description || item.publicDescription || "雪尘偷偷放进商城的小惊喜。";
}

export function progressPercent(challenge = {}) {
  const ratio = Number(challenge.progress?.ratio);
  if (Number.isFinite(ratio)) return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const current = finite(challenge.progress?.current, 0);
  const target = finite(challenge.progress?.target, 0);
  return target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function operatorText(operator) {
  if (operator === "<=") return "不晚于";
  if (operator === "==") return "等于";
  return "达到";
}

function thresholdText(metric, value) {
  if (metric === "bedtime_minutes") return minutesOfDayText(value);
  if (metric === "study_minutes" || metric === "reading_minutes" || metric === "exercise_minutes") {
    return durationText(value);
  }
  return String(finite(value, 0));
}

function formatMetricValue(metric, value) {
  if (metric === "study_minutes" || metric === "reading_minutes" || metric === "exercise_minutes") return durationText(value);
  if (metric === "bedtime_minutes") return minutesOfDayText(value);
  return String(finite(value, 0));
}

function durationText(value) {
  const minutes = Math.max(0, Math.round(finite(value, 0)));
  if (minutes < 60) return `${minutes}min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function minutesOfDayText(value) {
  let minutes = Math.round(finite(value, 0));
  if (minutes >= 24 * 60) minutes -= 24 * 60;
  const hours = Math.floor(Math.max(0, minutes) / 60) % 24;
  const rest = Math.max(0, minutes) % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function periodText(period = {}) {
  if (period.type === "calendar_week") return "本周";
  if (period.type === "rolling_days" && finite(period.days, 0) > 0) return `最近 ${finite(period.days, 0)} 天`;
  if (period.type === "date_range" && period.startDate && period.endDate) return `${period.startDate}～${period.endDate} `;
  return "";
}

function formatLocalDateTime(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return "";
  }
}
