import { formatDateOnly, round1 } from "./calculations.js";

export const subjectKeys = [
  ["math", "数学"],
  ["economy", "经济类"],
  ["english", "英语基础"],
  ["ielts", "雅思专项"],
  ["thesis", "论文"],
  ["japanese", "日语"],
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
  const week = [...settlements]
    .sort((a, b) => getDateValue(b) - getDateValue(a))
    .slice(0, 7)
    .sort((a, b) => getDateValue(a) - getDateValue(b));

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

  const dailyRows = week.map((item) => ({
    id: item.id,
    date: item.reviewDate || formatDateOnly(item.createdAt),
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
    days: week.length,
    range: week.length ? `${week[0].reviewDate || formatDateOnly(week[0].createdAt)} - ${week[week.length - 1].reviewDate || formatDateOnly(week[week.length - 1].createdAt)}` : "暂无记录",
    totals: {
      ...totals,
      avgStudyMinutes: week.length ? round1(totals.studyMinutes / week.length) : 0,
      avgGeneratedMinutes: week.length ? round1(totals.generatedMinutes / week.length) : 0,
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
      date: item.reviewDate || formatDateOnly(item.createdAt),
      dayType: item.dayTypeDisplayName || "",
      baseLimit: item.nextDayBaseEntertainmentLimit || 60,
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
