import { calculateSleepAdjustmentFromTime, toNumber } from "./calculations.js";
import { cleanBookTitle, normalizeBookTitle } from "./reading.js";

function normalize(text) {
  return String(text || "").replace(/\r\n/g, "\n");
}

function parseReviewDate(text, today = new Date()) {
  const source = String(text || "");
  const dateLine = source
    .split("\n")
    .slice(0, 12)
    .find((line) => /日期|【日期】|^\s*#/.test(line) && hasDateLikeText(line));
  const searchText = dateLine || source.slice(0, 500);

  const full = searchText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (full) return toIsoDate(Number(full[1]), Number(full[2]), Number(full[3]));

  const dashed = searchText.match(/(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  if (dashed) return toIsoDate(Number(dashed[1]), Number(dashed[2]), Number(dashed[3]));

  const monthDay = searchText.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (monthDay) return toIsoDate(today.getFullYear(), Number(monthDay[1]), Number(monthDay[2]));

  return toIsoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function hasDateLikeText(text) {
  return /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}/.test(text);
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
  if (/^(📐|💰|📖|🌍|📝|📚|💪|💼|🏠|📌|😴|🎮|🧩|🔧|🌙|⭐)/u.test(text)) return true;
  if (/^(完成情况|总结收尾|今日最大卡点|明日最重要的一个调整|状态记录|评分)/.test(text.replace(/\*/g, ""))) return true;
  if (/^(数学|经济类学习|英语基础|雅思专项|论文|日语|阅读|其他学习|杂项|运动|工作|家庭|昨日睡眠|娱乐)$/.test(text)) return true;
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

function readingDetail(section) {
  const minutes = firstDurationAfter(section, ["时长", "总时长", "阅读时长"]);
  const rawTitle = pickLineValue(section, ["书籍", "书名", "读的书", "阅读内容"]);
  const bookTitle = cleanBookTitle(rawTitle);
  const feeling = pickLineValue(section, ["感受", "今日感受", "笔记", "摘要", "想法"]);
  const session = bookTitle
    ? {
        title: bookTitle,
        rawTitle,
        normalizedTitle: normalizeBookTitle(bookTitle),
        minutes,
        feeling,
      }
    : null;
  return {
    name: "阅读",
    minutes,
    bookTitle,
    normalizedBookTitle: normalizeBookTitle(bookTitle),
    feeling,
    sessions: session ? [session] : [],
    progress: [bookTitle ? `《${bookTitle}》${minutes ? ` ${minutes}min` : ""}` : "", feeling].filter(Boolean),
    blockers: [],
    summary: compactLines(section),
  };
}

const defaultEntertainmentTags = [
  { id: "entertainment-wenyou", name: "文游", keywords: "文游" },
  { id: "entertainment-novel", name: "小说", keywords: "小说" },
  { id: "entertainment-game", name: "游戏", keywords: "游戏" },
  { id: "entertainment-video", name: "视频", keywords: "视频" },
  { id: "entertainment-short-video", name: "短视频", keywords: "短视频" },
];

function normalizeTimeTags(tags = [], fallbackPrefix = "tag") {
  return tags
    .map((tag, index) => ({
      id: tag.id || `${fallbackPrefix}-${index}`,
      name: String(tag.name || "").trim(),
      keywords: String(tag.keywords || tag.name || "")
        .split(/[,，、;；\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    }))
    .filter((tag) => tag.name && tag.keywords.length);
}

function bestMatchingTag(line, tags) {
  return tags
    .map((tag) => ({
      tag,
      score: Math.max(0, ...tag.keywords.map((keyword) => (String(line || "").includes(keyword) ? keyword.length : 0))),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.tag;
}

function timeTagBreakdown(section, tags = [], labels = [], options = {}) {
  const normalizedTags = normalizeTimeTags(tags);
  if (!normalizedTags.length || !section) return {};
  const contentLines = listItems(section, labels);
  return contentLines.reduce((result, line) => {
    const minutes = parseDurationToMinutes(line);
    if (minutes <= 0) return result;
    const matchedTags = options.exclusive
      ? [bestMatchingTag(line, normalizedTags)].filter(Boolean)
      : normalizedTags.filter((tag) => tag.keywords.some((keyword) => line.includes(keyword)));
    matchedTags.forEach((tag) => {
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

function sumBreakdownMinutes(breakdown = {}) {
  return Object.values(breakdown).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
}

function uniqueTags(tags = []) {
  const seen = new Set();
  return tags.filter((tag) => {
    const key = tag.id || tag.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitOptionalList(value) {
  return String(value || "")
    .split(/[,，、;；/\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHealthFields(section) {
  if (!section) {
    return {
      mealStatus: "",
      waterStatus: "",
      caffeineStatus: "",
      meals: "",
      water: "",
      caffeine: "",
      bodySignals: [],
      basicSkincareDone: "",
      skincare: "",
      maskStatus: "",
      skinStatus: "",
      skinState: "",
      recoveryActions: [],
      healthNote: "",
    };
  }
  const mealStatus = pickLineValue(section, ["三餐", "mealStatus"]);
  const waterStatus = pickLineValue(section, ["饮水", "waterStatus"]);
  const caffeineStatus = pickLineValue(section, ["咖啡因/奶茶", "咖啡因或奶茶", "咖啡因", "奶茶", "caffeineStatus"]);
  const basicSkincareDone = normalizeTemplateValue(pickLineValue(section, ["基础护肤", "护肤", "basicSkincareDone"]));
  const maskStatus = normalizeTemplateValue(pickLineValue(section, ["面膜", "maskStatus"]));
  const skinStatus = pickLineValue(section, ["皮肤状态", "skinStatus"]);
  return {
    mealStatus,
    waterStatus,
    caffeineStatus,
    meals: mealStatus,
    water: waterStatus,
    caffeine: caffeineStatus,
    bodySignals: splitOptionalList(pickLineValue(section, ["身体信号"])),
    basicSkincareDone,
    skincare: basicSkincareDone,
    maskStatus,
    skinStatus,
    skinState: skinStatus,
    recoveryActions: splitOptionalList(pickLineValue(section, ["恢复行为"])),
    healthNote: pickLineValue(section, ["备注", "healthNote"]),
  };
}

function cleanHeading(value) {
  return String(value || "").replace(/[*_`]/g, "").replace(/[\p{Extended_Pictographic}]/gu, "").replace(/【|】/g, "").trim();
}

function markdownHeadingBlocks(text) {
  const lines = normalize(text).split("\n");
  const headings = lines.map((line, index) => {
    const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    return match ? { index, level: match[1].length, title: cleanHeading(match[2]) } : null;
  }).filter(Boolean);
  return headings.map((heading, index) => ({
    ...heading,
    end: headings.slice(index + 1).find((item) => item.level <= heading.level)?.index ?? lines.length,
    lines: lines.slice(heading.index + 1, headings.slice(index + 1).find((item) => item.level <= heading.level)?.index ?? lines.length),
  }));
}

function fieldLines(lines = []) {
  return lines.map((line) => {
    const match = line.match(/^\s*(?:[-*+]\s*)?(.+?)\s*[：:]\s*(.*)$/);
    return match ? { label: cleanHeading(match[1]), value: normalizeTemplateValue(match[2]), raw: line } : null;
  }).filter(Boolean);
}

function normalizeTemplateValue(value) {
  const text = String(value || "").trim();
  // Empty examples in the master must never become a completed record.
  if (!text || /^\/?10$/.test(text) || /^(是\s*\/\s*否\s*\/\s*未记录|轻松\s*\/\s*适中\s*\/\s*偏累\s*\/\s*太累|大\s*\/\s*中\s*\/\s*小\s*\/\s*无|放松\s*\/\s*一般\s*\/\s*有些失控\s*\/\s*明显失控)$/.test(text)) return "";
  return text;
}

function valuesFor(lines, labels) {
  return fieldLines(lines).filter((item) => labels.includes(item.label)).map((item) => item.value).filter(Boolean);
}

function firstValue(lines, labels) {
  return valuesFor(lines, labels)[0] || "";
}

function freeFieldItems(lines, labels = []) {
  return fieldLines(lines)
    .filter((item) => !labels.includes(item.label) && item.value)
    .map((item) => `${item.label}：${item.value}`);
}

function durationAndText(value) {
  const minutes = parseDurationToMinutes(value);
  const text = String(value || "").replace(/\d+(?:\.\d+)?\s*(?:h(?:ours?)?\s*\d*(?:\.\d+)?\s*(?:min)?|小时\s*\d*(?:\.\d+)?\s*(?:分钟|分)?|时\s*\d*(?:\.\d+)?\s*(?:分钟|分)?|min|分钟|分)/ig, "").replace(/^[\s,，;；、-]+|[\s,，;；、-]+$/g, "").trim();
  return { minutes, text };
}

function h3Within(blocks, parent, title) {
  return blocks.find((block) => block.level === 3 && block.index > parent.index && block.index < parent.end && block.title === title);
}

function moduleDetail(name, block, durationLabels = ["总时长", "时长"]) {
  const lines = block?.lines || [];
  const minutes = parseDurationToMinutes(firstValue(lines, durationLabels));
  const progress = [
    ...valuesFor(lines, ["今日推进", "推进", "阅读内容", "项目"]),
    ...freeFieldItems(lines, [...durationLabels, "调整", "单词"]),
  ].filter(Boolean);
  return { name, minutes, progress, blockers: valuesFor(lines, ["调整"]), summary: lines.map((line) => line.trim()).filter(Boolean).join("；") };
}

function yesNoUnknown(value) {
  const text = String(value || "").trim();
  if (/^(是|有|完成|已做)/.test(text)) return "yes";
  if (/^(否|无|未做)/.test(text)) return "no";
  return "unrecorded";
}

// This nested value is the durable internal representation. Legacy settlement
// fields remain alongside it so historical screens and points calculations keep
// their previous semantics.
function buildStructuredReviewData({ math, economy, english, japanese, reading, projects, work, exercise, family, misc, entertainment, sleep, selfcare, state, diary }) {
  const breakdown = english?.breakdown || {};
  const value = (name) => Number(breakdown[name]?.minutes || 0);
  return {
    study: {
      math: { totalMinutes: Number(math?.minutes || 0), breakdown: { calculus: 0, linearAlgebra: 0 }, progress: {} },
      professional: { totalMinutes: Number(economy?.minutes || 0), breakdown: {}, progress: economy?.courseProgress || {} },
      english: { totalMinutes: Number(english?.minutes || 0), breakdown: { vocabulary: value("单词"), ieltsWriting: value("雅思写作"), ieltsReading: value("雅思阅读"), ieltsListening: value("雅思听力"), ieltsSpeaking: value("雅思口语") }, progress: {} },
      japanese: { totalMinutes: Number(japanese?.minutes || 0), progress: japanese?.progress || [] },
      reading: { totalMinutes: Number(reading?.minutes || 0), progress: reading?.progress || [] },
    },
    projects: (projects || []).map((project) => ({ id: project.id, name: project.name, totalMinutes: Number(project.minutes || 0), progress: project.progress || [], adjustment: (project.blockers || []).join("；") })),
    work: { totalMinutes: Number(work?.minutes || 0), progress: work?.progress || [] },
    exercise: { totalMinutes: Number(exercise?.minutes || 0), progress: exercise?.progress || [] },
    family: { totalMinutes: Number(family?.minutes || 0), progress: family?.progress || [] },
    misc: { totalMinutes: Number(misc?.minutes || 0), progress: misc?.progress || [] },
    entertainment: { totalMinutes: Number(entertainment?.minutes || 0) },
    sleep: { bedtime: firstValue(sleep?.lines || [], ["入睡时间"]), wakeTime: firstValue(sleep?.lines || [], ["起床时间"]), minutes: parseDurationToMinutes(firstValue(sleep?.lines || [], ["睡眠时长"])) },
    selfcare: { basicSkincare: yesNoUnknown(firstValue(selfcare?.lines || [], ["基础护肤"])), mask: yesNoUnknown(firstValue(selfcare?.lines || [], ["面膜"])), period: yesNoUnknown(firstValue(selfcare?.lines || [], ["经期"])) },
    state,
    diary: { title: firstValue(diary?.lines || [], ["标题"]), body: firstValue(diary?.lines || [], ["正文"]), tags: firstValue(diary?.lines || [], ["标签"]) },
  };
}

function parseFinalTemplateMarkdown(text, options = {}) {
  const blocks = markdownHeadingBlocks(text);
  const top = (title) => blocks.find((block) => block.level === 2 && block.title === title);
  const learning = top("学习");
  const project = top("项目");
  const work = top("工作");
  const exercise = top("运动");
  const family = top("家庭");
  const misc = top("杂项");
  const sleep = top("睡眠") || top("昨日睡眠");
  const entertainment = top("娱乐");
  const selfcare = top("个护");
  const stateTop = top("状态");
  const closing = top("评分与总结") || top("总结收尾");
  const diaryTop = top("日记");
  const mathBlock = learning && h3Within(blocks, learning, "数学");
  const professionalBlock = learning && h3Within(blocks, learning, "专业课");
  const englishBlock = learning && (h3Within(blocks, learning, "英语") || h3Within(blocks, learning, "英语基础"));
  const ieltsBlock = learning && h3Within(blocks, learning, "雅思专项");
  const japaneseBlock = learning && h3Within(blocks, learning, "日语");
  const readingBlock = learning && h3Within(blocks, learning, "阅读");
  const mathLines = mathBlock?.lines || [];
  const professionalLines = professionalBlock?.lines || [];
  const ieltsLines = ieltsBlock?.lines || [];
  const math = moduleDetail("数学", mathBlock);
  math.progress = fieldLines(mathLines).filter((item) => ["高等数学", "线性代数"].includes(item.label) && item.value).map((item) => `${item.label}：${item.value}`);
  math.lectureCompleted = firstValue(mathLines, ["网课"]);
  math.exerciseCompleted = firstValue(mathLines, ["习题"]);
  const economy = moduleDetail("专业课", professionalBlock);
  economy.courseProgress = Object.fromEntries(fieldLines(professionalLines).filter((item) => !["总时长", "分项时长", "今日推进", "调整"].includes(item.label) && item.value).map((item) => [item.label, item.value]));
  economy.progress = Object.entries(economy.courseProgress).map(([name, value]) => `${name}：${value}`);
  const english = moduleDetail("英语", englishBlock, ["时长", "总时长"]);
  english.word = firstValue(englishBlock?.lines || [], ["单词"]);
  english.breakdown = Object.fromEntries(["单词", "雅思写作", "雅思阅读", "雅思听力", "雅思口语"].map((label) => [label, durationAndText(firstValue(englishBlock?.lines || [], [label]))]));
  const ielts = moduleDetail("雅思专项", ieltsBlock);
  ielts.skills = Object.fromEntries(["写作", "阅读", "听力", "口语"].map((skill) => {
    const value = firstValue(ieltsLines, [skill]);
    const detail = durationAndText(value);
    return [skill, { ...detail, raw: value }];
  }).filter(([, value]) => value.raw));
  const ieltsSum = Object.values(ielts.skills).reduce((sum, value) => sum + value.minutes, 0);
  if (!ielts.minutes && ieltsSum) ielts.minutes = ieltsSum;
  const japanese = moduleDetail("日语", japaneseBlock, ["时长", "总时长"]);
  const reading = readingDetail((readingBlock?.lines || []).join("\n"));
  const projectBlocks = project ? blocks.filter((block) => block.level === 3 && block.index > project.index && block.index < project.end) : [];
  const projects = projectBlocks.map((block) => ({
    id: `project-${block.title}`,
    name: block.title,
    ...moduleDetail(block.title, block),
  })).filter((item) => item.name && item.name !== "项目名称" && item.name !== "其他项目名称");
  const workDetail = moduleDetail("工作", { lines: work?.lines || [] });
  const familyDetail = moduleDetail("家庭", { lines: family?.lines || [] });
  const miscDetail = moduleDetail("杂项", { lines: misc?.lines || [] });
  miscDetail.tagBreakdown = timeTagBreakdown((misc?.lines || []).join("\n"), Array.isArray(options) ? [] : options.miscTags || [], ["内容"]);
  const entertainmentLines = entertainment?.lines || [];
  const entertainmentTags = uniqueTags([...defaultEntertainmentTags, ...((Array.isArray(options) ? [] : options.entertainmentTags) || [])]);
  const entertainmentBreakdown = timeTagBreakdown(entertainmentLines.join("\n"), entertainmentTags, ["来源"], { exclusive: true });
  const explicitEntertainmentFenceMinutes = parseDurationToMinutes(firstValue(entertainmentLines, ["娱乐总时长"]));
  const totalEntertainmentMinutes = explicitEntertainmentFenceMinutes || sumBreakdownMinutes(entertainmentBreakdown);
  const stateBlock = stateTop && (h3Within(blocks, stateTop, "今日状态") || stateTop);
  const scoreBlock = closing && (h3Within(blocks, closing, "评分") || closing);
  const stateLines = [...(stateBlock?.lines || []), ...(scoreBlock?.lines || [])];
  // New English is one secondary category; do not double-count its IELTS leaf fields.
  const studyMinutes = [math, economy, english, japanese, reading].reduce((sum, item) => sum + Number(item.minutes || 0), 0) + (englishBlock ? 0 : Number(ielts.minutes || 0));
  const unrecognized = blocks.filter((block) => block.level === 3 && !["数学", "专业课", "英语基础", "雅思专项", "日语", "阅读", "日记", "状态记录", "评分"].includes(block.title) && !(project && block.index > project.index && block.index < project.end)).map((block) => ({ title: block.title, raw: block.lines.join("\n") }));
  const bedtime = firstValue(sleep?.lines || [], ["入睡时间"]);
  const sleepAdjustment = calculateSleepAdjustmentFromTime(bedtime);
  const exerciseLines = exercise?.lines || [];
  const exerciseIntensityText = firstValue(exerciseLines, ["强度感受"]);
  return {
    studyMinutes,
    exerciseMinutes: parseDurationToMinutes(firstValue(exerciseLines, ["时长", "总时长"])),
    exerciseIntensity: parseExerciseIntensity(exerciseIntensityText),
    exerciseIntensityText,
    sleepAdjustment: sleepAdjustment.value,
    sleepAdjustmentLabel: sleepAdjustment.label,
    bedtime,
    wakeTime: firstValue(sleep?.lines || [], ["起床时间"]),
    sleepDuration: firstValue(sleep?.lines || [], ["睡眠时长"]),
    lateSleepReason: firstValue(sleep?.lines || [], ["晚睡原因（如有）", "晚睡原因"]),
    readingMinutes: reading.minutes,
    readingBookTitle: reading.bookTitle,
    readingFeeling: reading.feeling,
    readingSessions: reading.sessions,
    beneficialMinutes: 0,
    actualGameMinutesToday: 0,
    explicitEntertainmentFenceMinutes,
    entertainmentBreakdown,
    totalEntertainmentMinutes,
    reviewDate: parseReviewDate(text),
    subjects: { math, economy, english, ielts, japanese, reading, thesis: moduleDetail("论文", null), work: workDetail, family: familyDetail, misc: miscDetail },
    projects,
    unrecognized,
    durationWarnings: ieltsSum && parseDurationToMinutes(firstValue(ieltsLines, ["总时长"])) && ieltsSum !== parseDurationToMinutes(firstValue(ieltsLines, ["总时长"])) ? ["雅思总时长与分项时长不一致"] : [],
    state: {
      energy: firstValue(stateLines, ["精力"]), mood: firstValue(stateLines, ["情绪"]), sleepImpact: firstValue(stateLines, ["睡眠影响"]), phoneDistraction: firstValue(stateLines, ["手机干扰"]), studyQuality: firstValue(stateLines, ["学习质量"]), executionStability: firstValue(stateLines, ["执行稳定度"]), oneLineSummary: firstValue(stateLines, ["今日一句话总结"]), biggestBlocker: firstValue(stateLines, ["要努力的原因"]), tomorrowAdjustment: firstValue(stateLines, ["明日调整"]),
    },
    health: parseHealthFields((selfcare?.lines || []).join("\n")),
    reviewData: buildStructuredReviewData({ math, economy, english, japanese, reading, projects, work, exercise, family, misc, entertainment, sleep, selfcare, state: { energy: firstValue(stateLines, ["精力"]), mood: firstValue(stateLines, ["情绪"]) }, diary: diaryTop }),
    note: firstValue(stateLines, ["今日一句话总结"]),
    rawReview: text,
  };
}

export function parseReviewMarkdown(markdown, options = {}) {
  const text = normalize(markdown);
  if (/^\s*##\s+.*学习\s*$/m.test(text) && /^\s*##\s+.*项目\s*$/m.test(text) && (/^\s*##\s+.*总结收尾\s*$/m.test(text) || /^\s*##\s+.*评分与总结\s*$/m.test(text))) {
    return parseFinalTemplateMarkdown(text, options);
  }
  const miscTags = Array.isArray(options) ? options : options.miscTags || [];
  const entertainmentTags = uniqueTags([
    ...defaultEntertainmentTags,
    ...((Array.isArray(options) ? [] : options.entertainmentTags) || []),
  ]);
  const reviewDate = parseReviewDate(text);
  const mathSection = sectionBetween(text, /###\s*📐?\s*数学|###\s*数学/, [/###\s*💰?/, /###\s*📖?/, /---/, /💪/]);
  const econSection = sectionBetween(text, /###\s*💰?\s*经济类学习|###\s*经济类学习/, [/###\s*📖?/, /###\s*🌍?/, /---/, /💪/]);
  const englishSection = sectionBetween(text, /(?:###\s*)?📖?\s*英语基础|英语基础/, [/(?:###\s*)?🌍\s*雅思专项|(?:###\s*)?雅思专项/, /(?:###\s*)?📝\s*论文|(?:###\s*)?论文/, /---/, /💪/]);
  const ieltsSection = sectionBetween(text, /(?:###\s*)?🌍?\s*雅思专项|雅思专项/, [/(?:###\s*)?📝\s*论文|(?:###\s*)?论文/, /(?:###\s*)?🌸\s*日语|(?:###\s*)?日语/, /---/, /💪/]);
  const thesisSection = sectionBetween(text, /###\s*📝?\s*论文|###\s*论文/, [/(?:###\s*)?🌸\s*日语|(?:###\s*)?日语/, /---/, /💪/]);
  const readingHeadingPattern = /(?:^|\n)\s*(?:#{1,4}\s*)?(?:📚\s*)?阅读\s*(?:\n|$)/;
  const japaneseSection = sectionBetween(text, /(?:###\s*)?🌸\s*日语|(?:###\s*)?日语/, [readingHeadingPattern, /---/, /💪/]);
  const readingSection = sectionBetween(text, readingHeadingPattern, [/---/, /💪/, /💼/, /###\s*📌?/, /😴/, /🎮/, /##\s*✅#/]);
  const exerciseSection = sectionBetween(text, /💪\s*\*\*运动\*\*|💪\s*运动|运动/, [/---/, /💼/, /###\s*📌?/, /😴/]);
  const workSection = sectionBetween(text, /💼\s*工作|工作/, [/---/, /🏠\s*家庭|家庭/, /###\s*📌?/, /😴/, /🎮/]);
  const familySection = sectionBetween(text, /🏠\s*家庭|家庭/, [/---/, /###\s*📌?/, /😴/, /🎮/, /##\s*✅#/]);
  const miscSection = sectionBetween(text, /(?:###\s*)?📌?\s*(其他学习\s*\/\s*杂项|杂项)|其他学习\s*\/\s*杂项/, [/😴/, /🎮/, /##\s*✅#/]);
  const sleepSection = sectionBetween(text, /😴\s*昨日睡眠|昨日睡眠/, [/🎮/, /##\s*✅#/, /🧩/]);
  const entertainmentSection = sectionBetween(text, /🎮\s*娱乐|娱乐/, [/##\s*✅#/, /🧩/, /🔧/]);
  const healthSection = sectionBetween(text, /🫧\s*身体维护\s*\/\s*健康洞悉补充|身体维护\s*\/\s*健康洞悉补充|健康洞悉补充|身体维护/, [/---/, /😴/, /🎮/, /##\s*✅#/, /🧩/, /🔧/, /🌙/, /⭐/]);
  const closingSection = sectionBetween(text, /##\s*✅#\s*总结收尾|总结收尾/, [/$^/]);

  const miscDetail = subjectDetail("杂项", miscSection, ["总时长", "时长"], ["内容"]);
  miscDetail.tagBreakdown = timeTagBreakdown(miscSection, miscTags, ["内容"]);

  const subjects = {
    math: subjectDetail("数学", mathSection, ["总时长"], ["今日有效推进"], ["需要调整", "数学卡点"]),
    economy: subjectDetail("经济类学习", econSection, ["总总时长", "总时长"], ["今日有效推进"], ["需要调整", "经济类卡点"]),
    english: subjectDetail("英语基础", englishSection, ["时长", "总时长"], ["单词"]),
    ielts: subjectDetail("雅思专项", ieltsSection, ["总时长"], ["完成内容"], ["需要调整"]),
    thesis: subjectDetail("论文", thesisSection, ["总时长"], ["今日产出"], ["需要调整"]),
    japanese: subjectDetail("日语", japaneseSection, ["总时长", "时长"], ["今日有效推进", "完成内容", "内容"], ["需要调整"]),
    reading: readingDetail(readingSection),
    work: subjectDetail("工作", workSection, ["时长", "总时长"], ["项目", "内容"]),
    family: subjectDetail("家庭", familySection, ["时长", "总时长"], ["项目", "内容"]),
    misc: miscDetail,
  };

  const explicitStudyTotal = firstDurationAfter(text, ["学习总时长", "学习时长"]);
  const studySubjectKeys = ["math", "economy", "english", "ielts", "thesis", "japanese", "reading"];
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
  const explicitEntertainmentFenceMinutes = firstDurationAfter(entertainmentSection, ["自由娱乐时长", "自由娱乐", "娱乐总时长", "娱乐围栏", "围栏时长", "今日围栏", "实际娱乐时长", "娱乐总池"]);
  const entertainmentBreakdown = timeTagBreakdown(entertainmentSection, entertainmentTags, ["来源", "类型", "内容"], { exclusive: true });
  const entertainmentBreakdownMinutes = sumBreakdownMinutes(entertainmentBreakdown);
  const totalEntertainmentMinutes = explicitEntertainmentFenceMinutes || entertainmentBreakdownMinutes || beneficialMinutes + actualGameMinutesToday;
  const health = parseHealthFields(healthSection);

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
    exerciseIntensityText,
    sleepAdjustment: sleepAdjustment.value,
    sleepAdjustmentLabel: sleepAdjustment.label,
    bedtime,
    wakeTime,
    sleepDuration,
    lateSleepReason,
    readingMinutes: subjects.reading.minutes,
    readingBookTitle: subjects.reading.bookTitle,
    readingFeeling: subjects.reading.feeling,
    readingSessions: subjects.reading.sessions,
    beneficialMinutes,
    actualGameMinutesToday,
    explicitEntertainmentFenceMinutes,
    entertainmentBreakdown,
    totalEntertainmentMinutes,
    reviewDate,
    subjects,
    state,
    health,
    note: state.oneLineSummary || "",
    rawReview: markdown,
  };
}
