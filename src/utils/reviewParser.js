import { calculateSleepAdjustmentFromTime, toNumber } from "./calculations.js";

function normalize(text) {
  return String(text || "").replace(/\r\n/g, "\n");
}

function parseReviewDate(text, today = new Date()) {
  const full = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (full) return toIsoDate(Number(full[1]), Number(full[2]), Number(full[3]));

  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (monthDay) return toIsoDate(today.getFullYear(), Number(monthDay[1]), Number(monthDay[2]));

  return toIsoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function toIsoDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDurationToMinutes(value) {
  const text = String(value || "").trim();
  if (!text) return 0;

  const hourMinute = text.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(\d+(?:\.\d+)?)?\s*(?:min|分钟|分)?/i);
  if (hourMinute) {
    return Math.round(Number(hourMinute[1]) * 60 + toNumber(hourMinute[2]));
  }

  const chineseHourMinute = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|时)\s*(\d+(?:\.\d+)?)?\s*(?:分钟|分)?/);
  if (chineseHourMinute) {
    return Math.round(Number(chineseHourMinute[1]) * 60 + toNumber(chineseHourMinute[2]));
  }

  const minute = text.match(/(\d+(?:\.\d+)?)\s*(?:min|分钟|分)/i);
  if (minute) return Math.round(Number(minute[1]));

  const plainNumber = text.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (plainNumber) return Math.round(Number(plainNumber[1]));

  return 0;
}

function escapeRegex(label) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickLineValue(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegex(label)}\\s*[：:]\\s*([^\\n]*)`));
    if (match) return match[1].trim();
  }
  return "";
}

function sectionBetween(text, startPattern, endPatterns) {
  const start = text.search(startPattern);
  if (start < 0) return "";
  const rest = text.slice(start);
  const endIndexes = endPatterns
    .map((pattern) => {
      const index = rest.slice(1).search(pattern);
      return index >= 0 ? index + 1 : -1;
    })
    .filter((index) => index > 0);
  const end = endIndexes.length ? Math.min(...endIndexes) : rest.length;
  return rest.slice(0, end);
}

function firstDurationAfter(section, labels) {
  return parseDurationToMinutes(pickLineValue(section, labels));
}

function parseExerciseIntensity(value) {
  if (/轻松/.test(value)) return "low";
  if (/适中|偏累|太累|累/.test(value)) return "medium_high";
  return "none";
}

function listItems(section, labels = []) {
  const lines = section
    .split("\n")
    .map((line) => line.replace(/^[\s>*#\-]+/, "").trim())
    .filter(Boolean);

  if (!labels.length) return lines.filter((line) => !isStructuralLine(line)).map(stripListMarker).filter(Boolean);

  const startIndex = lines.findIndex((line) => labels.some((label) => line.includes(label)));
  if (startIndex < 0) return [];

  const result = [];
  const inlineValue = lines[startIndex].match(/[：:]\s*(.+)$/)?.[1]?.trim();
  if (inlineValue && inlineValue !== "-") result.push(inlineValue);

  for (const line of lines.slice(startIndex + 1)) {
    if (isStructuralLine(line)) break;
  if (/^(总时长|总总时长|时长|网课|习题|今日有效推进|数学卡点|经济类卡点|完成内容|需要调整|今日产出|项目|内容|精力|情绪|睡眠影响|手机干扰|学习质量|执行稳定度|今日一句话总结)[：:]/.test(line)) break;
    result.push(line);
  }
  return result.map(stripListMarker).filter((line) => line && line !== "-");
}

function isStructuralLine(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  if (/^(\d+[\.、])?\s*$/.test(text)) return true;
  if (/^(📐|💰|📖|🌍|📝|💪|💼|📌|😴|🎮|🧩|🔧|🌙|⭐)/u.test(text)) return true;
  if (/^(完成情况|总结收尾|今日最大卡点|明日最重要的一个调整|状态记录|评分)/.test(text.replace(/\*/g, ""))) return true;
  if (/^(数学|经济类学习|英语基础|雅思专项|论文|日语|其他学习|杂项|运动|工作|昨日睡眠|娱乐)$/.test(text)) return true;
  return false;
}

function stripListMarker(line) {
  return String(line || "").replace(/^\d+[\.、]\s+/, "").trim();
}

function compactLines(section) {
  return section
    .split("\n")
    .map((line) => line.replace(/^[\s>*#\-]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("；");
}

function subjectDetail(name, section, durationLabels, progressLabels, blockerLabels = []) {
  return {
    name,
    minutes: firstDurationAfter(section, durationLabels),
    progress: listItems(section, progressLabels),
    blockers: blockerLabels.length ? listItems(section, blockerLabels) : [],
    summary: compactLines(section),
  };
}

function normalizeMiscTags(tags = []) {
  return tags
    .map((tag, index) => ({
      id: tag.id || `misc-tag-${index}`,
      name: String(tag.name || "").trim(),
      keywords: String(tag.keywords || tag.name || "")
        .split(/[,，、;；\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    }))
    .filter((tag) => tag.name && tag.keywords.length);
}

function miscTagBreakdown(miscSection, tags = []) {
  const normalizedTags = normalizeMiscTags(tags);
  if (!normalizedTags.length || !miscSection) return {};
  const contentLines = listItems(miscSection, ["内容"]);
  return contentLines.reduce((result, line) => {
    normalizedTags.forEach((tag) => {
      if (!tag.keywords.some((keyword) => line.includes(keyword))) return;
      const minutes = parseDurationToMinutes(line);
      const current = result[tag.id] || { id: tag.id, name: tag.name, minutes: 0, items: [] };
      result[tag.id] = {
        ...current,
        minutes: current.minutes + minutes,
        items: [...current.items, line],
      };
    });
    return result;
  }, {});
}

export function parseReviewMarkdown(markdown, options = {}) {
  const text = normalize(markdown);
  const miscTags = Array.isArray(options) ? options : options.miscTags || [];
  const reviewDate = parseReviewDate(text);
  const mathSection = sectionBetween(text, /###\s*📐?\s*数学|###\s*数学/, [/###\s*💰?/, /###\s*📖?/, /---/, /💪/]);
  const econSection = sectionBetween(text, /###\s*💰?\s*经济类学习|###\s*经济类学习/, [/###\s*📖?/, /###\s*🌍?/, /---/, /💪/]);
  const englishSection = sectionBetween(text, /(?:###\s*)?📖?\s*英语基础|英语基础/, [/(?:###\s*)?🌍\s*雅思专项|(?:###\s*)?雅思专项/, /(?:###\s*)?📝\s*论文|(?:###\s*)?论文/, /---/, /💪/]);
  const ieltsSection = sectionBetween(text, /(?:###\s*)?🌍?\s*雅思专项|雅思专项/, [/(?:###\s*)?📝\s*论文|(?:###\s*)?论文/, /(?:###\s*)?🌸\s*日语|(?:###\s*)?日语/, /---/, /💪/]);
  const thesisSection = sectionBetween(text, /###\s*📝?\s*论文|###\s*论文/, [/(?:###\s*)?🌸\s*日语|(?:###\s*)?日语/, /---/, /💪/]);
  const japaneseSection = sectionBetween(text, /(?:###\s*)?🌸\s*日语|(?:###\s*)?日语/, [/---/, /💪/]);
  const exerciseSection = sectionBetween(text, /💪\s*\*\*运动\*\*|💪\s*运动|运动/, [/---/, /💼/, /###\s*📌?/, /😴/]);
  const workSection = sectionBetween(text, /💼\s*工作|工作/, [/---/, /###\s*📌?/, /😴/, /🎮/]);
  const miscSection = sectionBetween(text, /(?:###\s*)?📌?\s*(其他学习\s*\/\s*杂项|杂项)|其他学习\s*\/\s*杂项/, [/😴/, /🎮/, /##\s*✅#/]);
  const sleepSection = sectionBetween(text, /😴\s*昨日睡眠|昨日睡眠/, [/🎮/, /##\s*✅#/, /🧩/]);
  const entertainmentSection = sectionBetween(text, /🎮\s*娱乐|娱乐/, [/##\s*✅#/, /🧩/, /🔧/]);
  const closingSection = sectionBetween(text, /##\s*✅#\s*总结收尾|总结收尾/, [/$^/]);

  const miscDetail = subjectDetail("杂项", miscSection, ["总时长", "时长"], ["内容"]);
  miscDetail.tagBreakdown = miscTagBreakdown(miscSection, miscTags);

  const subjects = {
    math: subjectDetail("数学", mathSection, ["总时长"], ["今日有效推进"], ["数学卡点"]),
    economy: subjectDetail("经济类学习", econSection, ["总总时长", "总时长"], ["今日有效推进"], ["经济类卡点"]),
    english: subjectDetail("英语基础", englishSection, ["时长", "总时长"], ["单词"]),
    ielts: subjectDetail("雅思专项", ieltsSection, ["总时长"], ["完成内容"], ["需要调整"]),
    thesis: subjectDetail("论文", thesisSection, ["总时长"], ["今日产出"]),
    japanese: subjectDetail("日语", japaneseSection, ["总时长", "时长"], ["今日有效推进", "完成内容", "内容"]),
    work: subjectDetail("工作", workSection, ["时长", "总时长"], ["项目", "内容"]),
    misc: miscDetail,
  };

  const explicitStudyTotal = firstDurationAfter(text, ["学习总时长", "学习时长"]);
  const studySubjectKeys = ["math", "economy", "english", "ielts", "thesis", "japanese"];
  const subjectStudyTotal = studySubjectKeys.reduce((sum, key) => sum + (subjects[key]?.minutes || 0), 0);
  const bedtime = pickLineValue(sleepSection, ["入睡时间"]);
  const wakeTime = pickLineValue(sleepSection, ["起床时间"]);
  const sleepDuration = pickLineValue(sleepSection, ["睡眠时长"]);
  const lateSleepReason = pickLineValue(sleepSection, ["晚睡原因", "晚睡原因（如有）"]);
  const sleepAdjustment = calculateSleepAdjustmentFromTime(bedtime);
  const exerciseIntensityText = pickLineValue(exerciseSection, ["强度感受"]);
  const exerciseMinutes = firstDurationAfter(exerciseSection, ["时长", "总时长"]);
  const beneficialMinutes = firstDurationAfter(entertainmentSection, ["有益娱乐时长"]);
  const actualGameMinutesToday = firstDurationAfter(entertainmentSection, ["游戏娱乐时长", "游戏类娱乐时长"]);
  const explicitEntertainmentFenceMinutes = firstDurationAfter(entertainmentSection, ["娱乐围栏", "围栏时长", "今日围栏", "实际娱乐时长", "娱乐总池"]);
  const totalEntertainmentMinutes = explicitEntertainmentFenceMinutes || beneficialMinutes + actualGameMinutesToday;

  const state = {
    energy: pickLineValue(closingSection, ["精力"]),
    mood: pickLineValue(closingSection, ["情绪"]),
    sleepImpact: pickLineValue(closingSection, ["睡眠影响"]),
    phoneDistraction: pickLineValue(closingSection, ["手机干扰"]),
    studyQuality: pickLineValue(closingSection, ["学习质量"]),
    executionStability: pickLineValue(closingSection, ["执行稳定度"]),
    oneLineSummary: pickLineValue(closingSection, ["今日一句话总结"]),
    biggestBlocker: listItems(sectionBetween(text, /🧩\s*\*\*今日最大卡点\*\*|今日最大卡点/, [/🔧/, /🌙/, /⭐/])).join("；"),
    tomorrowAdjustment: listItems(sectionBetween(text, /🔧\s*\*\*明日最重要的一个调整\*\*|明日最重要的一个调整/, [/🌙/, /⭐/])).join("；"),
  };

  return {
    studyMinutes: explicitStudyTotal || subjectStudyTotal,
    exerciseMinutes,
    exerciseIntensity: exerciseMinutes > 0 ? parseExerciseIntensity(exerciseIntensityText) : "none",
    sleepAdjustment: sleepAdjustment.value,
    sleepAdjustmentLabel: sleepAdjustment.label,
    bedtime,
    wakeTime,
    sleepDuration,
    lateSleepReason,
    beneficialMinutes,
    actualGameMinutesToday,
    explicitEntertainmentFenceMinutes,
    totalEntertainmentMinutes,
    reviewDate,
    subjects,
    state,
    note: state.oneLineSummary || "",
    rawReview: markdown,
  };
}
