import { DAILY_FREE_ENTERTAINMENT_LIMIT_MIN, round1 } from "./calculations.js";

export const subjectKeys = [
  ["math", "数学"],
  ["economy", "经济类"],
  ["english", "英语基础"],
  ["ielts", "雅思专项"],
  ["thesis", "论文"],
  ["japanese", "日语"],
  ["reading", "阅读"],
  ["work", "工作"],
  ["misc", "杂项"],
];

export const activityKeys = [
  ["studyMinutes", "总学习"],
  ["math", "数学"],
  ["economy", "经济类"],
  ["english", "英语基础"],
  ["ielts", "雅思"],
  ["thesis", "论文"],
  ["japanese", "日语"],
  ["reading", "阅读"],
  ["exerciseMinutes", "运动"],
  ["work", "工作"],
  ["misc", "杂项"],
  ["totalEntertainmentMinutes", "娱乐总池"],
];

function normalizeMiscTags(tags = []) {
  return tags
    .map((tag, index) => ({
      id: tag.id || `misc-tag-${index}`,
      name: String(tag.name || "").trim(),
    }))
    .filter((tag) => tag.name);
}

function buildActivityDefinitions(miscTags = []) {
  return [
    ...activityKeys,
    ...normalizeMiscTags(miscTags).map((tag) => [`miscTag:${tag.id}`, `杂项·${tag.name}`]),
  ];
}

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

function activityMinutes(item, key) {
  if (key.startsWith("miscTag:")) {
    const tagId = key.replace("miscTag:", "");
    return Number(item.subjects?.misc?.tagBreakdown?.[tagId]?.minutes || 0);
  }
  if (key === "totalEntertainmentMinutes") {
    return Number(item.totalEntertainmentMinutes ?? (Number(item.beneficialMinutes || 0) + Number(item.actualGameMinutesToday || 0)));
  }
  if (subjectKeys.some(([subjectKey]) => subjectKey === key)) return subjectMinutes(item, key);
  return Number(item[key] || 0);
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
  const miscTags = Array.isArray(options) ? options : options.miscTags || [];
  const activityDefinitions = buildActivityDefinitions(miscTags);
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

  const totals = week.reduce(
    (sum, item) => ({
      studyMinutes: sum.studyMinutes + Number(item.studyMinutes || 0),
      pointsAdded: sum.pointsAdded + Number(item.pointsAdded || 0),
      generatedMinutes: sum.generatedMinutes + Number(item.generatedMinutes || 0),
      exerciseMinutes: sum.exerciseMinutes + Number(item.exerciseMinutes || 0),
      entertainmentMinutes: sum.entertainmentMinutes + activityMinutes(item, "totalEntertainmentMinutes"),
      gameOverrun: sum.gameOverrun + Number(item.gameOverrun || 0),
    }),
    {
      studyMinutes: 0,
      pointsAdded: 0,
      generatedMinutes: 0,
      exerciseMinutes: 0,
      entertainmentMinutes: 0,
      gameOverrun: 0,
    }
  );

  const subjects = subjectKeys.map(([key, label]) => {
    const minutes = week.reduce((sum, item) => sum + subjectMinutes(item, key), 0);
    const progress = week.flatMap((item) => item.subjects?.[key]?.progress || []);
    const blockers = week.flatMap((item) => item.subjects?.[key]?.blockers || []);
    return { key, label, minutes, progress: topItems(progress), blockers: topItems(blockers, 4) };
  });

  const activityTotals = activityDefinitions.map(([key, label]) => ({
    key,
    label,
    minutes: week.reduce((sum, item) => sum + activityMinutes(item, key), 0),
  }));

  const dailyRows = rowsSource.map((item) => ({
    id: item.id,
    date: getIsoDate(item),
    hasRecord: item.hasRecord !== false,
    raw: item,
    activities: activityDefinitions.map(([key, label]) => ({
      key,
      label,
      minutes: activityMinutes(item, key),
      progress: key.startsWith("miscTag:")
        ? item.subjects?.misc?.tagBreakdown?.[key.replace("miscTag:", "")]?.items || []
        : subjectKeys.some(([subjectKey]) => subjectKey === key) ? item.subjects?.[key]?.progress || [] : [],
      blockers: subjectKeys.some(([subjectKey]) => subjectKey === key) ? item.subjects?.[key]?.blockers || [] : [],
    })),
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

  return {
    days: rowCount,
    recordedDays: week.length,
    range: rangeDates.length ? `${rangeDates[0]} - ${rangeDates[rangeDates.length - 1]}` : week.length ? `${getIsoDate(week[0])} - ${getIsoDate(week[week.length - 1])}` : "暂无记录",
    totals: {
      ...totals,
      avgStudyMinutes: rowCount ? round1(totals.studyMinutes / rowCount) : 0,
      avgGeneratedMinutes: rowCount ? round1(totals.generatedMinutes / rowCount) : 0,
    },
    subjects,
    activityTotals,
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
    entertainmentStatus: week.map((item) => ({
      date: getIsoDate(item),
      dayType: item.dayTypeDisplayName || "",
      baseLimit: item.freeEntertainmentLimitMinutes || DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      entertainmentMinutes: activityMinutes(item, "totalEntertainmentMinutes"),
    })),
  };
}

function countText(values) {
  return values.reduce((map, value) => {
    const key = String(value || "").trim();
    if (!key) return map;
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
}

function averageScore(values) {
  const numbers = values
    .map((value) => String(value || "").match(/(\d+(?:\.\d+)?)/)?.[1])
    .map(Number)
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  return round1(numbers.reduce((sum, item) => sum + item, 0) / numbers.length);
}
