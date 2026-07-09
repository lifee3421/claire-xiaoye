import { DAILY_FREE_ENTERTAINMENT_LIMIT_MIN } from "./calculations.js";
import { parseDurationToMinutes } from "./reviewParser.js";

export const dayTypeLabels = {
  high_quality_day: "高质量推进日",
  normal_progress_day: "普通推进日",
  baseline_progress_day: "保底推进日",
  work_affairs_day: "工作事务日",
  travel_day: "出游日",
  loss_of_control_recovery_day: "失控修复日",
  light_day: "普通日 / 轻量日",
};

export const extensionCostMap = {
  10: 1,
  20: 2,
  30: 4,
  40: 6,
  50: 9,
  60: 12,
};

const realStudyKeywords = [
  "公司理财", "投资学", "货币银行", "国际金融", "431",
  "财务报表", "财务分析", "DCF", "年金", "CAPM",
  "债券", "股票估值", "利率", "货币政策",
  "精读", "快读", "笔记", "公式", "框架", "题目", "例题",
];

const systemKeywords = ["部署", "网站", "系统", "开发", "录入", "设置", "更新个人管理系统"];

function includesAny(text, keywords) {
  const value = String(text || "");
  return keywords.some((keyword) => value.includes(keyword));
}

function meaningfulText(text) {
  const value = String(text || "")
    .replace(/[：:\s\-；;。,.，]/g, "")
    .trim();
  return value.length >= 2;
}

function scoreValue(value) {
  return Number(String(value || "").match(/(\d+(?:\.\d+)?)/)?.[1] || 0);
}

function impactLevel(value) {
  const text = String(value || "").trim();
  if (/大|高|重/.test(text)) return "高";
  if (/中/.test(text)) return "中";
  if (/小|低|无/.test(text)) return "低";
  return "未提供";
}

function subjectText(subject) {
  return [
    subject?.progress?.join("；"),
    subject?.blockers?.join("；"),
    subject?.summary,
  ].filter(Boolean).join("；");
}

export function getExtensionCost(minutes) {
  return extensionCostMap[Number(minutes)] ?? null;
}

export function entertainmentTypeText(type) {
  const map = {
    game: "游戏",
    singing: "唱歌",
    guitar: "吉他",
    drawing: "画画",
    novel: "小说",
    video: "视频",
    scrolling: "刷手机",
    other: "其他",
  };
  return map[type] || "其他";
}

export function normalizeReviewForDayType(parsed = {}) {
  const subjects = parsed.subjects || {};
  const englishText = subjectText(subjects.english);
  const wordMatch = englishText.match(/新词\s*(\d+)/);
  const reviewMatch = englishText.match(/复习\s*(\d+)/);
  const sleepDurationMinutes = parseDurationToMinutes(parsed.sleepDuration);
  const beneficialEntertainmentMinutes = Number(parsed.beneficialMinutes || 0);
  const gameEntertainmentMinutes = Number(parsed.actualGameMinutesToday || 0);
  const totalEntertainmentMinutes = Number(parsed.totalEntertainmentMinutes ?? (beneficialEntertainmentMinutes + gameEntertainmentMinutes));

  return {
    date: parsed.reviewDate || "",
    totalStudyMinutes: Number(parsed.studyMinutes || 0),
    mathMinutes: Number(subjects.math?.minutes || 0),
    mathProgressText: subjectText(subjects.math),
    mathBlockers: subjects.math?.blockers?.join("；") || "",
    econMinutes: Number(subjects.economy?.minutes || 0),
    econProgressText: subjectText(subjects.economy),
    econBlockers: subjects.economy?.blockers?.join("；") || "",
    englishMinutes: Number(subjects.english?.minutes || 0),
    newWords: wordMatch ? Number(wordMatch[1]) : 0,
    reviewWords: reviewMatch ? Number(reviewMatch[1]) : 0,
    ieltsMinutes: Number(subjects.ielts?.minutes || 0),
    ieltsContentText: subjectText(subjects.ielts),
    ieltsAdjustmentText: subjects.ielts?.blockers?.join("；") || "",
    thesisMinutes: Number(subjects.thesis?.minutes || 0),
    thesisOutputText: subjectText(subjects.thesis),
    japaneseMinutes: Number(subjects.japanese?.minutes || 0),
    exerciseMinutes: Number(parsed.exerciseMinutes || 0),
    workMinutes: Number(subjects.work?.minutes || 0),
    familyMinutes: Number(subjects.family?.minutes || 0),
    workProjectText: subjectText(subjects.work),
    miscMinutes: Number(subjects.misc?.minutes || 0),
    miscText: subjectText(subjects.misc),
    sleepStart: parsed.bedtime || "",
    wakeTime: parsed.wakeTime || "",
    sleepDurationMinutes,
    lateSleepReason: parsed.lateSleepReason || "",
    beneficialEntertainmentMinutes,
    gameEntertainmentMinutes,
    totalEntertainmentMinutes,
    biggestBlockerText: parsed.state?.biggestBlocker || "",
    tomorrowAdjustmentText: parsed.state?.tomorrowAdjustment || "",
    energy: scoreValue(parsed.state?.energy),
    mood: scoreValue(parsed.state?.mood),
    sleepImpact: impactLevel(parsed.state?.sleepImpact),
    phoneInterference: impactLevel(parsed.state?.phoneDistraction),
    studyQuality: scoreValue(parsed.state?.studyQuality),
    executionStability: scoreValue(parsed.state?.executionStability),
    oneSentenceSummary: parsed.state?.oneLineSummary || "",
  };
}

export function isRealProfessionalProgress(text, minutes) {
  const hasRealStudy = includesAny(text, realStudyKeywords);
  const mostlySystem = includesAny(text, systemKeywords);
  return Number(minutes || 0) >= 50 && hasRealStudy && !mostlySystem;
}

export function hasAnyProfessionalOrPlanningText(text) {
  return includesAny(text, ["教材", "方向", "目录", "431", "公司理财", "投资学", "货币银行", "国际金融", "金融"]);
}

export function buildMainlineStamps(parsed = {}) {
  const p = normalizeReviewForDayType(parsed);
  return {
    math: p.mathMinutes >= 50 || meaningfulText(p.mathProgressText),
    thesis: p.thesisMinutes >= 90 && meaningfulText(p.thesisOutputText),
    thesisSoft: p.thesisMinutes >= 30 && meaningfulText(p.thesisOutputText),
    english:
      p.englishMinutes + p.ieltsMinutes >= 30 ||
      p.newWords > 0 ||
      p.reviewWords > 0 ||
      meaningfulText(p.ieltsContentText),
    professional: isRealProfessionalProgress(p.econProgressText, p.econMinutes),
    professionalSoft: hasAnyProfessionalOrPlanningText(p.econProgressText) && p.econMinutes >= 20,
  };
}

export function classifyDay(parsed = {}) {
  const p = normalizeReviewForDayType(parsed);
  const stamps = buildMainlineStamps(parsed);
  const mainOutputCount =
    Number(stamps.math) +
    Number(stamps.thesis || stamps.thesisSoft) +
    Number(stamps.english) +
    Number(stamps.professional || stamps.professionalSoft);

  const entertainmentExpansion =
    p.totalEntertainmentMinutes > 180 ||
    p.gameEntertainmentMinutes > 90 ||
    p.phoneInterference === "高";

  if (parsed.isTravelDay) {
    return {
      dayType: "travel_day",
      displayName: dayTypeLabels.travel_day,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      bonusPoints: Number(parsed.travelDayBonusPoints ?? 1),
      reason: "用户手动标记为出游日；自由娱乐额度仍固定90min。",
      stamps,
    };
  }

  if (p.workMinutes > 240) {
    return {
      dayType: "work_affairs_day",
      displayName: dayTypeLabels.work_affairs_day,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      bonusPoints: 0,
      reason: "工作时长超过4小时，今日标记为工作事务日；工作积分按分钟单独计算。",
      stamps,
    };
  }

  if (entertainmentExpansion && p.totalStudyMinutes <= 240 && p.workMinutes <= 240) {
    return {
      dayType: "loss_of_control_recovery_day",
      displayName: dayTypeLabels.loss_of_control_recovery_day,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      bonusPoints: 0,
      reason: "娱乐扩张或手机干扰较高，且当天学习/工作产出不足，今日标记为失控修复日；不额外扣分。",
      stamps,
    };
  }

  const highQuality =
    p.totalStudyMinutes > 480 &&
    mainOutputCount >= 2 &&
    p.phoneInterference !== "高";

  if (highQuality) {
    return {
      dayType: "high_quality_day",
      displayName: dayTypeLabels.high_quality_day,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      bonusPoints: 2,
      reason: "学习超过8小时、主线产出不少于2项，且手机干扰不高；额外奖励+2分。",
      stamps,
    };
  }

  if (p.totalStudyMinutes > 360) {
    return {
      dayType: "normal_progress_day",
      displayName: dayTypeLabels.normal_progress_day,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      bonusPoints: 0,
      reason: "学习超过6小时，今日标记为普通推进日。",
      stamps,
    };
  }

  if (p.totalStudyMinutes > 240) {
    return {
      dayType: "baseline_progress_day",
      displayName: dayTypeLabels.baseline_progress_day,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      bonusPoints: 0,
      reason: "学习超过4小时，今日标记为保底推进日。",
      stamps,
    };
  }

  return {
    dayType: "light_day",
    displayName: dayTypeLabels.light_day,
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    bonusPoints: 0,
    reason: "未满足其他类型，今日标记为普通日 / 轻量日。",
    stamps,
  };
}
