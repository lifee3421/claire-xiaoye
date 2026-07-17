import { DAILY_FREE_ENTERTAINMENT_LIMIT_MIN, round1 } from "./calculations.js";
import { REVIEW_SCHEMA } from "./reviewSchema.js";

export const subjectKeys = [
  ["math", "数学"],
  ["economy", "经济类"],
  ["english", "英语基础"],
  ["ielts", "雅思专项"],
  ["thesis", "论文"],
  ["japanese", "日语"],
  ["reading", "阅读"],
  ["work", "工作"],
  ["family", "家庭"],
  ["misc", "杂项"],
];

export const activityKeys = [
  ["study", "学习"],
  ["work_affairs", "工作事务"],
  ["life_maintenance", "生活维护"],
  ["exercise", "运动"],
  ["sleep", "睡眠"],
  ["entertainment_rest", "娱乐休息"],
  ["misc", "杂项"],
];

const studySubjectKeys = ["math", "economy", "english", "ielts", "thesis", "japanese", "reading"];
const primaryActivityDefinitions = activityKeys.map(([key, label]) => [key, label]);
const workMiscKeywords = ["党团", "红会", "会议", "材料", "外联"];
const lifeMiscKeywords = ["个人管理体系", "个人管理系统", "管理系统", "收拾", "复盘", "通勤", "洗漱", "家务", "计划", "整理"];
const workMiscLabels = [
  ["党团", ["党团"]],
  ["红会", ["红会"]],
  ["会议", ["会议"]],
  ["材料", ["材料"]],
  ["外联", ["外联"]],
];
const lifeMiscLabels = [
  ["个人管理体系", ["个人管理体系", "个人管理系统", "管理系统"]],
  ["收拾", ["收拾"]],
  ["复盘", ["复盘"]],
  ["通勤", ["通勤"]],
  ["洗漱", ["洗漱"]],
  ["家务", ["家务"]],
  ["计划", ["计划"]],
  ["整理", ["整理"]],
];

function getDateValue(item) {
  const value = item.reviewDate ? new Date(`${item.reviewDate}T00:00:00`) : item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt || Date.now());
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

function toLocalIsoDate(date) {
  const value = date?.toDate ? date.toDate() : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIsoDate() {
  return toLocalIsoDate(new Date());
}

function getIsoDate(item) {
  return item.reviewDate || toLocalIsoDate(getDateValue(item));
}

function dateRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toLocalIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function topItems(items, limit = 6) {
  return items.filter(Boolean).slice(0, limit);
}

function subjectMinutes(item, key) {
  return Number(item.subjects?.[key]?.minutes || 0);
}

function parseMinutesFromLine(line) {
  const text = String(line || "");
  const hourMinute = text.match(/(\d+(?:\.\d+)?)\s*h\s*(\d+(?:\.\d+)?)?\s*(?:min|分钟|分)?/i);
  if (hourMinute) return Math.round(Number(hourMinute[1]) * 60 + Number(hourMinute[2] || 0));
  const chineseHourMinute = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|时)\s*(\d+(?:\.\d+)?)?\s*(?:分钟|分)?/);
  if (chineseHourMinute) return Math.round(Number(chineseHourMinute[1]) * 60 + Number(chineseHourMinute[2] || 0));
  const minute = text.match(/(\d+(?:\.\d+)?)\s*(?:min|分钟|分)/i);
  return minute ? Math.round(Number(minute[1])) : 0;
}

function sleepMinutes(item) {
  return parseMinutesFromLine(item.sleepDuration);
}

function entertainmentBreakdownItems(item) {
  return Object.values(item.entertainmentBreakdown || {})
    .filter((entry) => Number(entry.minutes || 0) > 0)
    .map((entry) => ({
      id: entry.id || entry.name,
      label: entry.name || "娱乐",
      minutes: Number(entry.minutes || 0),
      items: entry.items || [],
    }));
}

function entertainmentMinutes(item) {
  const explicit = Number(item.totalEntertainmentMinutes || 0);
  if (explicit > 0) return explicit;
  const breakdown = entertainmentBreakdownItems(item).reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  if (breakdown > 0) return breakdown;
  return Number(item.beneficialMinutes || 0) + Number(item.actualGameMinutesToday || 0);
}

function lineMatches(line, keywords) {
  return keywords.some((keyword) => String(line || "").includes(keyword));
}

function miscLinesWithMinutes(item) {
  return (item.subjects?.misc?.progress || [])
    .map((line) => ({
      line,
      minutes: parseMinutesFromLine(line),
    }))
    .filter((entry) => entry.minutes > 0);
}

function miscBucket(item) {
  const lines = miscLinesWithMinutes(item);
  const work = lines.filter((entry) => lineMatches(entry.line, workMiscKeywords)).map((entry) => ({ ...entry, label: matchedMiscLabel(entry.line, workMiscLabels) || "工作事务" }));
  const life = lines.filter((entry) => lineMatches(entry.line, lifeMiscKeywords)).map((entry) => ({ ...entry, label: matchedMiscLabel(entry.line, lifeMiscLabels) || "生活维护" }));
  const matched = new Set([...work, ...life].map((entry) => entry.line));
  const unmatched = lines.filter((entry) => !matched.has(entry.line));
  const lineTotal = lines.reduce((sum, entry) => sum + entry.minutes, 0);
  const explicitMisc = subjectMinutes(item, "misc");
  return {
    work,
    workMinutes: work.reduce((sum, entry) => sum + entry.minutes, 0),
    life,
    lifeMinutes: life.reduce((sum, entry) => sum + entry.minutes, 0),
    unmatched,
    unmatchedMinutes: lineTotal > 0 ? unmatched.reduce((sum, entry) => sum + entry.minutes, 0) : explicitMisc,
    hasLineBreakdown: lineTotal > 0,
  };
}

function matchedMiscLabel(line, labelGroups) {
  return labelGroups.find(([, keywords]) => lineMatches(line, keywords))?.[0] || "";
}

function safeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

const reviewDataPaths = {
  "study.math.totalMinutes": ["study", "math", "totalMinutes"],
  "study.math.calculus.duration": ["study", "math", "breakdown", "calculus"],
  "study.math.linearAlgebra.duration": ["study", "math", "breakdown", "linearAlgebra"],
  "study.professional.totalMinutes": ["study", "professional", "totalMinutes"],
  "study.professional.corporateFinance.duration": ["study", "professional", "breakdown", "corporateFinance"],
  "study.professional.investments.duration": ["study", "professional", "breakdown", "investments"],
  "study.english.totalMinutes": ["study", "english", "totalMinutes"],
  "study.english.vocabulary.duration": ["study", "english", "breakdown", "vocabulary"],
  "study.english.ieltsWriting.duration": ["study", "english", "breakdown", "ieltsWriting"],
  "study.english.ieltsReading.duration": ["study", "english", "breakdown", "ieltsReading"],
  "study.english.ieltsListening.duration": ["study", "english", "breakdown", "ieltsListening"],
  "study.english.ieltsSpeaking.duration": ["study", "english", "breakdown", "ieltsSpeaking"],
  "study.japanese.totalMinutes": ["study", "japanese", "totalMinutes"],
  "study.reading.totalMinutes": ["study", "reading", "totalMinutes"],
  "project.personalManagement.totalMinutes": ["projects"],
  "exercise.today.totalMinutes": ["exercise", "totalMinutes"],
};

function nestedValue(source, path) { return path.reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, source); }

export function buildReviewSchemaWeekly(settlements = [], options = {}) {
  const source = Array.isArray(settlements) ? settlements : [];
  const staticRows = REVIEW_SCHEMA.filter((field) => field.weeklyAggregate).map((field) => {
    const path = reviewDataPaths[field.id];
    const values = source.map((settlement) => {
      if (field.id === "project.personalManagement.totalMinutes") {
        return (settlement.reviewData?.projects || [])
          .filter((project) => project.name === "\u4e2a\u4eba\u7ba1\u7406\u7cfb\u7edf")
          .reduce((sum, project) => sum + Number(project.totalMinutes || 0), 0);
      }
      return Number(nestedValue(settlement.reviewData || {}, path || []) || 0);
    });
    const minutes = values.reduce((sum, value) => sum + value, 0);
    const days = values.filter((value) => value > 0).length;
    return { ...field, minutes, days, averageMinutes: days ? round1(minutes / days) : 0 };
  });
  const dynamicRows = (Array.isArray(options.dynamicProjects) ? options.dynamicProjects : [])
    .filter((project) => project && project.paused !== true && project.archived !== true)
    .map((project) => {
      const name = String(project.name || "").trim();
      const minutes = source.reduce((sum, settlement) => sum + (settlement.reviewData?.projects || [])
        .filter((item) => item.name === name)
        .reduce((total, item) => total + Number(item.totalMinutes || 0), 0), 0);
      const days = source.filter((settlement) => (settlement.reviewData?.projects || []).some((item) => item.name === name && Number(item.totalMinutes || 0) > 0)).length;
      return {
        id: "project.dynamic." + (project.id || safeKey(name)) + ".totalMinutes",
        label: name,
        type: "duration",
        categoryPathIds: ["project", "project.dynamic." + (project.id || safeKey(name))],
        minutes,
        days,
        averageMinutes: days ? round1(minutes / days) : 0,
        weeklyAggregate: true,
      };
    });
  return [...staticRows, ...dynamicRows].filter((row) => row.minutes > 0 || options.includeEmpty);
}

function primaryCategoryMinutes(item, key) {
  const misc = miscBucket(item);
  if (key === "study") {
    const subjectTotal = studySubjectKeys.reduce((sum, subjectKey) => sum + subjectMinutes(item, subjectKey), 0);
    return subjectTotal || Number(item.studyMinutes || 0);
  }
  if (key === "work_affairs") return subjectMinutes(item, "work") + misc.workMinutes;
  if (key === "life_maintenance") return subjectMinutes(item, "family") + misc.lifeMinutes;
  if (key === "exercise") return Number(item.exerciseMinutes || 0);
  if (key === "sleep") return sleepMinutes(item);
  if (key === "entertainment_rest") return entertainmentMinutes(item);
  if (key === "misc") return misc.unmatchedMinutes;
  return 0;
}

function subjectDetailItem(item, key, label) {
  const detail = item.subjects?.[key] || {};
  return {
    key,
    label,
    minutes: subjectMinutes(item, key),
    progress: detail.progress || [],
    blockers: detail.blockers || [],
  };
}

function detailItemsForCategory(item, key) {
  const misc = miscBucket(item);
  if (key === "study") {
    const labels = {
      math: "数学",
      economy: "经济类学习",
      english: "英语基础",
      ielts: "雅思专项",
      thesis: "论文",
      japanese: "日语",
      reading: "阅读",
    };
    return studySubjectKeys.map((subjectKey) => subjectDetailItem(item, subjectKey, labels[subjectKey])).filter((entry) => entry.minutes > 0 || entry.progress.length || entry.blockers.length);
  }
  if (key === "work_affairs") {
    return [
      subjectDetailItem(item, "work", "工作"),
      ...misc.work.map((entry) => ({ key: `work-misc-${safeKey(entry.label)}`, label: entry.label, minutes: entry.minutes, progress: [entry.line], blockers: [] })),
    ].filter((entry) => entry.minutes > 0 || entry.progress.length);
  }
  if (key === "life_maintenance") {
    return [
      subjectDetailItem(item, "family", "家庭"),
      ...misc.life.map((entry) => ({ key: `life-misc-${safeKey(entry.label)}`, label: entry.label, minutes: entry.minutes, progress: [entry.line], blockers: [] })),
    ].filter((entry) => entry.minutes > 0 || entry.progress.length);
  }
  if (key === "exercise") {
    return [{
      key: "exercise",
      label: "运动",
      minutes: Number(item.exerciseMinutes || 0),
      progress: [item.exerciseIntensityText || item.exerciseIntensity || ""].filter(Boolean),
      blockers: [],
    }].filter((entry) => entry.minutes > 0 || entry.progress.length);
  }
  if (key === "sleep") {
    return [{
      key: "sleep",
      label: "昨日睡眠",
      minutes: sleepMinutes(item),
      progress: [
        item.bedtime ? `入睡 ${item.bedtime}` : "",
        item.wakeTime ? `起床 ${item.wakeTime}` : "",
        item.lateSleepReason ? `晚睡原因：${item.lateSleepReason}` : "",
      ].filter(Boolean),
      blockers: [],
    }].filter((entry) => entry.minutes > 0 || entry.progress.length);
  }
  if (key === "entertainment_rest") {
    const items = entertainmentBreakdownItems(item);
    if (!items.length && entertainmentMinutes(item) > 0) {
      return [{
        key: "entertainment-unsplit",
        label: "未拆分娱乐",
        minutes: entertainmentMinutes(item),
        progress: [`娱乐总时长：${minutesLabel(entertainmentMinutes(item))}`],
        blockers: [],
      }];
    }
    return items.map((entry) => ({
      key: entry.id,
      label: entry.label,
      minutes: entry.minutes,
      progress: entry.items.length ? entry.items : [`${entry.label}：${minutesLabel(entry.minutes)}`],
      blockers: [],
    }));
  }
  if (key === "misc") {
    if (misc.hasLineBreakdown) {
      return misc.unmatched.map((entry) => ({ key: "misc-unmatched", label: "未归类杂项", minutes: entry.minutes, progress: [entry.line], blockers: [] }));
    }
    return [subjectDetailItem(item, "misc", "未归类杂项")].filter((entry) => entry.minutes > 0 || entry.progress.length);
  }
  return [];
}

function activityForItem(item, key, label) {
  const details = detailItemsForCategory(item, key);
  return {
    key,
    label,
    minutes: primaryCategoryMinutes(item, key),
    progress: details.flatMap((entry) => entry.progress || []),
    blockers: details.flatMap((entry) => entry.blockers || []),
    breakdown: key === "entertainment_rest" ? entertainmentBreakdownItems(item) : details,
  };
}

function collectSecondaryDefinitions(week) {
  const base = [
    ["study:math", "数学", "study", "math"],
    ["study:economy", "经济类学习", "study", "economy"],
    ["study:english", "英语基础", "study", "english"],
    ["study:ielts", "雅思专项", "study", "ielts"],
    ["study:thesis", "论文", "study", "thesis"],
    ["study:japanese", "日语", "study", "japanese"],
    ["study:reading", "阅读", "study", "reading"],
    ["work_affairs:work", "工作", "work_affairs", "work"],
    ...workMiscLabels.map(([label]) => [`work_affairs:${safeKey(label)}`, label, "work_affairs", `work-misc-${safeKey(label)}`]),
    ["life_maintenance:family", "家庭", "life_maintenance", "family"],
    ...lifeMiscLabels.map(([label]) => [`life_maintenance:${safeKey(label)}`, label, "life_maintenance", `life-misc-${safeKey(label)}`]),
    ["exercise:exercise", "运动", "exercise", "exercise"],
    ["sleep:sleep", "睡眠", "sleep", "sleep"],
    ["misc:unmatched", "未归类杂项", "misc", "misc-unmatched"],
  ];
  const entertainmentDefs = new Map();
  week.forEach((item) => {
    entertainmentBreakdownItems(item).forEach((entry) => {
      entertainmentDefs.set(`entertainment_rest:${entry.id || safeKey(entry.label)}`, [entry.label, entry.id || entry.label]);
    });
    if (!entertainmentBreakdownItems(item).length && entertainmentMinutes(item) > 0) {
      entertainmentDefs.set("entertainment_rest:unsplit", ["未拆分娱乐", "entertainment-unsplit"]);
    }
  });
  return [
    ...base.map(([key, label, parentKey, sourceKey]) => ({ key, label, parentKey, sourceKey })),
    ...[...entertainmentDefs.entries()].map(([key, [label, sourceKey]]) => ({ key, label, parentKey: "entertainment_rest", sourceKey })),
  ];
}

function secondaryActivityForItem(item, definition) {
  const parent = activityForItem(item, definition.parentKey, activityKeys.find(([key]) => key === definition.parentKey)?.[1] || definition.parentKey);
  const detail = parent.breakdown?.find((entry) => entry.key === definition.sourceKey || entry.id === definition.sourceKey || entry.label === definition.label);
  if (detail) {
    return {
      key: definition.key,
      label: definition.label,
      parentKey: definition.parentKey,
      minutes: Number(detail.minutes || 0),
      progress: detail.progress || detail.items || [],
      blockers: detail.blockers || [],
      breakdown: detail.breakdown || [],
    };
  }
  return {
    key: definition.key,
    label: definition.label,
    parentKey: definition.parentKey,
    minutes: 0,
    progress: [],
    blockers: [],
    breakdown: [],
  };
}

export function minutesLabel(minutes) {
  const value = Number(minutes || 0);
  const hours = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  if (hours <= 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${rest}min`;
}

export function buildWeeklySummary(settlements, options = {}) {
  const rangeDates = dateRange(options.startDate, options.endDate);
  const normalizedSettlements = [...settlements].sort((a, b) => getDateValue(a) - getDateValue(b));
  const week = rangeDates.length
    ? normalizedSettlements.filter((item) => rangeDates.includes(getIsoDate(item)))
    : normalizedSettlements.slice(-7);
  const settlementByDate = week.reduce((map, item) => {
    map[getIsoDate(item)] = item;
    return map;
  }, {});
  const rowsSource = rangeDates.length
    ? rangeDates.map((date) => settlementByDate[date] || { id: `empty-${date}`, reviewDate: date, hasRecord: false, subjects: {}, state: {} })
    : week;
  const rowCount = rangeDates.length || week.length;
  const elapsedDays = rangeDates.length
    ? rangeDates.filter((date) => date <= todayIsoDate()).length
    : rowCount;

  const totals = week.reduce(
    (sum, item) => ({
      studyMinutes: sum.studyMinutes + primaryCategoryMinutes(item, "study"),
      pointsAdded: sum.pointsAdded + Number(item.pointsAdded || 0),
      generatedMinutes: sum.generatedMinutes + Number(item.generatedMinutes || 0),
      exerciseMinutes: sum.exerciseMinutes + primaryCategoryMinutes(item, "exercise"),
      entertainmentMinutes: sum.entertainmentMinutes + primaryCategoryMinutes(item, "entertainment_rest"),
      gameOverrun: sum.gameOverrun + Number(item.gameOverrun || 0),
      sleepMinutes: sum.sleepMinutes + primaryCategoryMinutes(item, "sleep"),
    }),
    {
      studyMinutes: 0,
      pointsAdded: 0,
      generatedMinutes: 0,
      exerciseMinutes: 0,
      entertainmentMinutes: 0,
      gameOverrun: 0,
      sleepMinutes: 0,
    }
  );

  const subjects = subjectKeys.map(([key, label]) => {
    const minutes = week.reduce((sum, item) => sum + subjectMinutes(item, key), 0);
    const progress = week.flatMap((item) => item.subjects?.[key]?.progress || []);
    const blockers = week.flatMap((item) => item.subjects?.[key]?.blockers || []);
    return { key, label, minutes, progress: topItems(progress), blockers: topItems(blockers, 4) };
  });

  const activityTotals = primaryActivityDefinitions.map(([key, label]) => ({
    key,
    label,
    minutes: week.reduce((sum, item) => sum + primaryCategoryMinutes(item, key), 0),
  }));
  const secondaryDefinitions = collectSecondaryDefinitions(week);
  const secondaryActivityTotals = secondaryDefinitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    parentKey: definition.parentKey,
    minutes: week.reduce((sum, item) => sum + secondaryActivityForItem(item, definition).minutes, 0),
  }));
  const schemaTotals = buildReviewSchemaWeekly(week, options);

  const dailyRows = rowsSource.map((item) => ({
    id: item.id,
    date: getIsoDate(item),
    hasRecord: item.hasRecord !== false,
    raw: item,
    activities: primaryActivityDefinitions.map(([key, label]) => activityForItem(item, key, label)),
    secondaryActivities: secondaryDefinitions.map((definition) => secondaryActivityForItem(item, definition)),
  }));

  const highlights = topItems(week.map((item) => item.state?.oneLineSummary), 7);
  const blockers = topItems(week.map((item) => item.state?.biggestBlocker), 5);
  const adjustments = topItems(week.map((item) => item.state?.tomorrowAdjustment), 5);
  const avgStudyQuality = averageScore(week.map((item) => item.state?.studyQuality));
  const avgStability = averageScore(week.map((item) => item.state?.executionStability));
  const avgEnergy = averageScore(week.map((item) => item.state?.energy));
  const avgMood = averageScore(week.map((item) => item.state?.mood));
  const sleepImpactCounts = countText(week.map((item) => item.state?.sleepImpact));
  const phoneDistractionCounts = countText(week.map((item) => item.state?.phoneDistraction));
  const sleepSummary = buildSleepSummary(week);
  const healthSummary = buildHealthSummary(week, sleepSummary, {
    avgEnergy,
    avgMood,
    phoneDistractionCounts,
    avgStudyQuality,
  });

  return {
    days: rowCount,
    recordedDays: week.length,
    elapsedDays,
    range: rangeDates.length ? `${rangeDates[0]} - ${rangeDates[rangeDates.length - 1]}` : week.length ? `${getIsoDate(week[0])} - ${getIsoDate(week[week.length - 1])}` : "暂无记录",
    totals: {
      ...totals,
      avgStudyMinutes: week.length ? round1(totals.studyMinutes / week.length) : 0,
      avgGeneratedMinutes: week.length ? round1(totals.generatedMinutes / week.length) : 0,
    },
    subjects,
    activityTotals,
    secondaryActivityTotals,
    schemaTotals,
    dailyRows,
    highlights,
    blockers,
    adjustments,
    avgStudyQuality,
    avgStability,
    avgEnergy,
    avgMood,
    sleepImpactCounts,
    phoneDistractionCounts,
    sleepSummary,
    healthSummary,
    entertainmentStatus: week.map((item) => ({
      date: getIsoDate(item),
      dayType: item.dayTypeDisplayName || "",
      baseLimit: item.freeEntertainmentLimitMinutes || DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      entertainmentMinutes: entertainmentMinutes(item),
    })),
  };
}

function buildSleepSummary(week) {
  const sleepRecords = week
    .map((item) => ({
      date: getIsoDate(item),
      minutes: sleepMinutes(item),
      bedtime: item.bedtime || "",
      wakeTime: item.wakeTime || "",
      lateReason: item.lateSleepReason || "",
      sleepImpact: item.state?.sleepImpact || "",
    }))
    .filter((item) => item.minutes > 0 || item.bedtime || item.wakeTime || item.sleepImpact || item.lateReason);
  const sleepMinutesRecords = sleepRecords.filter((item) => item.minutes > 0);
  const totalMinutes = sleepMinutesRecords.reduce((sum, item) => sum + item.minutes, 0);
  return {
    totalMinutes,
    recordedDays: sleepMinutesRecords.length,
    averageMinutes: sleepMinutesRecords.length ? round1(totalMinutes / sleepMinutesRecords.length) : 0,
    averageBedtime: averageClock(sleepRecords.map((item) => item.bedtime), "bedtime"),
    averageWakeTime: averageClock(sleepRecords.map((item) => item.wakeTime), "wake"),
    lateReasonTop: countTopText(sleepRecords.map((item) => item.lateReason), 3),
    sleepImpactCounts: countText(sleepRecords.map((item) => item.sleepImpact)),
    bedtimeTrend: sleepRecords.map((item) => ({ date: item.date, value: item.bedtime })).filter((item) => item.value),
    wakeTimeTrend: sleepRecords.map((item) => ({ date: item.date, value: item.wakeTime })).filter((item) => item.value),
  };
}

function buildHealthSummary(week, sleepSummary, statusSummary) {
  const exerciseRecords = week.filter((item) => Number(item.exerciseMinutes || 0) > 0);
  const intensityCounts = countText(week.map((item) => normalizeExerciseIntensity(item.exerciseIntensityText || item.exerciseIntensity)));
  const healthFields = {
    meals: countText(week.map((item) => item.health?.mealStatus || item.health?.meals)),
    water: countText(week.map((item) => item.health?.waterStatus || item.health?.water)),
    caffeine: countText(week.map((item) => item.health?.caffeineStatus || item.health?.caffeine)),
    skincare: countText(week.map((item) => item.health?.basicSkincareDone || item.health?.skincare)),
    maskStatus: countText(week.map((item) => item.health?.maskStatus)),
    skinState: countText(week.map((item) => item.health?.skinStatus || item.health?.skinState)),
    bodySignals: countText(week.flatMap((item) => item.health?.bodySignals || [])),
    recoveryActions: countText(week.flatMap((item) => item.health?.recoveryActions || [])),
  };
  return {
    sleep: sleepSummary,
    exercise: {
      totalMinutes: week.reduce((sum, item) => sum + Number(item.exerciseMinutes || 0), 0),
      days: exerciseRecords.length,
      intensityCounts,
    },
    status: {
      avgEnergy: statusSummary.avgEnergy,
      avgMood: statusSummary.avgMood,
      avgStudyQuality: statusSummary.avgStudyQuality,
      phoneDistractionCounts: statusSummary.phoneDistractionCounts,
      sleepImpactStudyQuality: buildSleepImpactQuality(week),
    },
    healthFields,
  };
}

function normalizeExerciseIntensity(value) {
  const text = String(value || "").trim();
  if (!text || text === "none") return "";
  if (/轻松|low/.test(text)) return "轻松";
  if (/适中/.test(text)) return "适中";
  if (/偏累/.test(text)) return "偏累";
  if (/太累|累|medium_high/.test(text)) return "太累";
  return text;
}

function buildSleepImpactQuality(week) {
  const grouped = week.reduce((map, item) => {
    const impact = String(item.state?.sleepImpact || "").trim();
    const quality = scoreValue(item.state?.studyQuality);
    if (!impact || quality == null) return map;
    map[impact] = map[impact] || [];
    map[impact].push(quality);
    return map;
  }, {});
  return Object.entries(grouped).map(([label, values]) => ({
    label,
    average: round1(values.reduce((sum, item) => sum + item, 0) / values.length),
    count: values.length,
  }));
}

function countText(values) {
  return values.reduce((map, value) => {
    const key = String(value || "").trim();
    if (!key) return map;
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
}

function countTopText(values, limit = 3) {
  return Object.entries(countText(values))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function scoreValue(value) {
  const number = String(value || "").match(/(\d+(?:\.\d+)?)/)?.[1];
  if (!number) return null;
  const parsed = Number(number);
  return Number.isFinite(parsed) ? parsed : null;
}

function averageScore(values) {
  const numbers = values.map(scoreValue).filter(Number.isFinite);
  if (!numbers.length) return null;
  return round1(numbers.reduce((sum, item) => sum + item, 0) / numbers.length);
}

function parseClockMinutes(value, mode) {
  const match = String(value || "").replace("：", ":").match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (mode === "bedtime" && hours < 12) hours += 24;
  return hours * 60 + minutes;
}

function averageClock(values, mode) {
  const minutes = values.map((value) => parseClockMinutes(value, mode)).filter(Number.isFinite);
  if (!minutes.length) return "";
  const average = Math.round(minutes.reduce((sum, item) => sum + item, 0) / minutes.length) % (24 * 60);
  const hours = Math.floor(average / 60);
  const rest = average % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
