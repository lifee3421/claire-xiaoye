export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round1(value) {
  return Math.round(toNumber(value) * 10) / 10;
}

// Points can legitimately contain decimals (for example work credit). Keep the
// stored/displayed value stable without changing any rule-specific rounding.
export function roundPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

export function formatPoints(value) {
  return String(roundPoints(value));
}

export const DAILY_FREE_ENTERTAINMENT_LIMIT_MIN = 90;

export function calculateStudyCredit(studyMinutes) {
  const minutes = Math.max(0, toNumber(studyMinutes));
  const first = Math.min(minutes, 120) * 0.1;
  const second = Math.min(Math.max(minutes - 120, 0), 240) * 0.2;
  const third = Math.min(Math.max(minutes - 360, 0), 120) * 0.25;
  const fourth = Math.max(minutes - 480, 0) * 0.3;
  return round1(first + second + third + fourth);
}

export function calculateExerciseCredit(exerciseMinutes, intensity) {
  const minutes = Math.max(0, toNumber(exerciseMinutes));
  if (intensity === "medium_high") return round1(minutes * 0.2);
  if (intensity === "low") return round1(minutes * 0.1);
  return 0;
}

export function calculateWorkPoints(workMinutes) {
  return roundPoints(Math.min(4, Math.max(0, toNumber(workMinutes)) / 50 * 0.6));
}

export function parseClockToMinutes(value) {
  const text = String(value || "").trim();
  const match = text.match(/(\d{1,2})\s*[:：点]\s*(\d{1,2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const normalizedHour = hour < 12 ? hour + 24 : hour;
  return normalizedHour * 60 + minute;
}

export function calculateSleepAdjustmentFromTime(bedtime) {
  const minutes = parseClockToMinutes(bedtime);
  if (minutes === null) {
    return { value: 0, label: "未识别入睡时间，暂按 0分" };
  }

  if (minutes <= 22 * 60 + 30) return { value: 3, label: "22:30 前入睡：+3分" };
  if (minutes <= 23 * 60) return { value: 2, label: "22:30-23:00 入睡：+2分" };
  if (minutes <= 23 * 60 + 20) return { value: 1.5, label: "23:00-23:20 入睡：+1.5分" };
  if (minutes <= 23 * 60 + 40) return { value: 0.5, label: "23:20-23:40 入睡：+0.5分" };
  if (minutes <= 24 * 60 + 10) return { value: -1, label: "23:40-00:10 入睡：-1分" };
  if (minutes <= 24 * 60 + 40) return { value: -1.5, label: "00:10-00:40 入睡：-1.5分" };
  return { value: -2, label: "00:40 后入睡：-2分" };
}

export function calculateBeneficialEntertainmentAdjustment(beneficialMinutes) {
  const minutes = Math.max(0, toNumber(beneficialMinutes));

  if (minutes <= 60) {
    return { adjustmentMinutes: 0, status: "protected" };
  }

  if (minutes <= 120) {
    return {
      adjustmentMinutes: round1((minutes - 60) * 0.5),
      status: "soft_adjustment",
    };
  }

  return {
    adjustmentMinutes: 30,
    status: "expanded",
  };
}

export function beneficialStatusText(status) {
  const map = {
    protected: "保护额度内",
    soft_adjustment: "温柔修正",
    expanded: "兴趣扩张",
  };
  return map[status] || "保护额度内";
}

export function calculateGameOverrun(actualGameMinutes, allocatedGameMinutes) {
  return round1(Math.max(0, toNumber(actualGameMinutes) - toNumber(allocatedGameMinutes)));
}

export function calculateGameOverrunAdjustment(actualGameMinutes, allocatedGameMinutes) {
  return round1(calculateGameOverrun(actualGameMinutes, allocatedGameMinutes) * 1.2);
}

export function calculateEntertainmentOverLimitPenalty(actualEntertainmentMinutes, allowedEntertainmentMinutes) {
  const overLimitMinutes = round1(Math.max(0, toNumber(actualEntertainmentMinutes) - toNumber(allowedEntertainmentMinutes)));
  if (overLimitMinutes <= 5) return { overLimitMinutes, penaltyPoints: 0, label: "0-5min：宽限，不扣分" };
  if (overLimitMinutes <= 15) return { overLimitMinutes, penaltyPoints: 1, label: "6-15min：扣 1 分" };
  if (overLimitMinutes <= 30) return { overLimitMinutes, penaltyPoints: 2, label: "16-30min：扣 2 分" };
  if (overLimitMinutes <= 45) return { overLimitMinutes, penaltyPoints: 3, label: "31-45min：扣 3 分" };
  if (overLimitMinutes <= 60) return { overLimitMinutes, penaltyPoints: 4, label: "46-60min：扣 4 分" };
  if (overLimitMinutes <= 90) return { overLimitMinutes, penaltyPoints: 6, label: "61-90min：扣 6 分" };
  return { overLimitMinutes, penaltyPoints: 8, label: "90min 以上：扣 8 分" };
}

export function calculateFreeEntertainmentScore(freeEntertainmentMinutes, limitMinutes = DAILY_FREE_ENTERTAINMENT_LIMIT_MIN) {
  const usedMinutes = round1(Math.max(0, toNumber(freeEntertainmentMinutes)));
  const overtimeMinutes = round1(Math.max(0, usedMinutes - toNumber(limitMinutes)));

  if (overtimeMinutes > 0) {
    if (overtimeMinutes <= 5) {
      return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: 0, label: "超时 0-5min：宽限，不扣分" };
    }
    if (overtimeMinutes <= 15) {
      return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: -1, label: "超时 6-15min：-1 分" };
    }
    if (overtimeMinutes <= 30) {
      return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: -2, label: "超时 16-30min：-2 分" };
    }
    if (overtimeMinutes <= 45) {
      return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: -3, label: "超时 31-45min：-3 分" };
    }
    if (overtimeMinutes <= 60) {
      return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: -4, label: "超时 46-60min：-4 分" };
    }
    if (overtimeMinutes <= 90) {
      return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: -6, label: "超时 61-90min：-6 分" };
    }
    return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: -8, label: "超时 90min 以上：-8 分" };
  }

  if (usedMinutes <= 30) {
    return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: 1, label: "0-30min：+1 分" };
  }
  if (usedMinutes <= 60) {
    return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: 2, label: "31-60min：+2 分" };
  }
  if (usedMinutes <= 75) {
    return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: 1, label: "61-75min：+1 分" };
  }
  return { usedMinutes, limitMinutes, overtimeMinutes, scoreDelta: 0, label: "76-90min：0 分" };
}

export function calculateGeneratedMinutes(input) {
  const studyCredit = calculateStudyCredit(input.studyMinutes);
  const exerciseCredit = calculateExerciseCredit(input.exerciseMinutes, input.exerciseIntensity);
  const sleepAdjustment = toNumber(input.sleepAdjustment);
  const exerciseBonusPoints = toNumber(input.exerciseMinutes) > 0 ? 1 : 0;
  const hasExplicitEntertainmentTotal =
    input.totalEntertainmentMinutes !== undefined &&
    input.totalEntertainmentMinutes !== null &&
    input.totalEntertainmentMinutes !== "";
  const totalEntertainmentMinutes = round1(
    hasExplicitEntertainmentTotal
      ? toNumber(input.totalEntertainmentMinutes)
      : toNumber(input.actualGameMinutesToday) + toNumber(input.beneficialMinutes)
  );
  const gameOverrun = calculateGameOverrun(input.actualGameMinutesToday, input.allocatedGameMinutesForToday);
  const gameOverrunAdjustment = 0;
  const beneficial = calculateBeneficialEntertainmentAdjustment(input.beneficialMinutes);
  const entertainmentAdjustment = 0;
  const generatedMinutes = round1(studyCredit + exerciseCredit);
  const availableMinutes = round1(Math.max(0, generatedMinutes));

  return {
    studyCredit,
    exerciseCredit,
    sleepAdjustment,
    exerciseBonusPoints,
    gameOverrun,
    gameOverrunAdjustment,
    beneficialAdjustment: beneficial.adjustmentMinutes,
    beneficialStatus: beneficial.status,
    entertainmentAdjustment,
    totalEntertainmentMinutes,
    generatedMinutes,
    availableMinutes,
  };
}

export function calculateBankPointsAdded(generatedMinutes) {
  const available = Math.max(0, toNumber(generatedMinutes));
  return Math.floor(available / 10);
}

export function clampAllocation(value, max) {
  return Math.max(0, Math.min(toNumber(value), Math.max(0, toNumber(max))));
}

export function estimateDailyBankPoints(input) {
  const detail = calculateGeneratedMinutes(input);
  const plannedTomorrowGameMinutes = DAILY_FREE_ENTERTAINMENT_LIMIT_MIN;
  const entertainmentScore = calculateFreeEntertainmentScore(detail.totalEntertainmentMinutes);
  return {
    ...detail,
    plannedTomorrowGameMinutes,
    entertainmentScoreDelta: entertainmentScore.scoreDelta,
    entertainmentScoreLabel: entertainmentScore.label,
    expectedDailyBankPoints: roundPoints(calculateBankPointsAdded(detail.availableMinutes) + detail.sleepAdjustment + detail.exerciseBonusPoints + entertainmentScore.scoreDelta),
  };
}

export function estimateDaysToProduct(input) {
  const currentBankPoints = Math.max(0, toNumber(input.currentBankPoints));
  const productCost = Math.max(0, toNumber(input.productCost));
  const pointsNeeded = Math.max(0, productCost - currentBankPoints);
  const daily = estimateDailyBankPoints(input);
  const daysNeeded = daily.expectedDailyBankPoints > 0
    ? Math.ceil(pointsNeeded / daily.expectedDailyBankPoints)
    : Infinity;

  return {
    pointsNeeded,
    daysNeeded,
    ...daily,
  };
}

export function estimateDaysToCart(input) {
  const targetCost = (input.products || []).reduce((sum, product) => {
    return sum + Math.max(0, toNumber(product.price));
  }, 0);
  return {
    targetCost,
    ...estimateDaysToProduct({ ...input, productCost: targetCost }),
  };
}

export function calculateDaysLeft(deadline, today = new Date()) {
  if (!deadline) return null;
  const end = new Date(`${deadline}T23:59:59`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((end - start) / 86400000);
}

export function compareIntensityPresets(target) {
  return intensityPresets.map((preset) => ({
    ...preset,
    estimate: estimateDaysToProduct({ ...preset, ...target }),
  }));
}

export const intensityPresets = [
  {
    id: "baseline",
    name: "保守保线日",
    studyMinutes: 360,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 0,
    actualGameMinutesToday: 30,
    allocatedGameMinutesForToday: 30,
    plannedTomorrowGameMinutes: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    beneficialMinutes: 30,
    description: "低状态或杂事日，主线不断线。",
  },
  {
    id: "steady",
    name: "稳定推进日",
    studyMinutes: 450,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 1.5,
    actualGameMinutesToday: 30,
    allocatedGameMinutesForToday: 30,
    plannedTomorrowGameMinutes: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    beneficialMinutes: 30,
    description: "普通学习日，能稳定攒积分。",
  },
  {
    id: "quality",
    name: "高质量学习日",
    studyMinutes: 510,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 2,
    actualGameMinutesToday: 30,
    allocatedGameMinutesForToday: 30,
    plannedTomorrowGameMinutes: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    beneficialMinutes: 30,
    description: "睡眠好、推进顺的时候使用。",
  },
  {
    id: "sprint",
    name: "冲刺攒分日",
    studyMinutes: 540,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 3,
    actualGameMinutesToday: 0,
    allocatedGameMinutesForToday: 0,
    plannedTomorrowGameMinutes: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    beneficialMinutes: 30,
    description: "临近目标时短期冲刺，不建议天天用。",
  },
];

export function formatDateTime(value) {
  if (!value) return "未知时间";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateOnly(value) {
  if (!value) return "未知日期";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知日期";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const calculationExamples = [
  "450min 学习入账 = 120*0.1 + 240*0.2 + 90*0.25 = 82.5min",
  "510min 学习入账 = 120*0.1 + 240*0.2 + 120*0.25 + 30*0.3 = 99min",
  "生成时间价值直接按 10min = 1分转入奖励银行，不再扣除明日娱乐额度",
];
