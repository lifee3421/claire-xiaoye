export const mathTracks = [
  { id: "advanced", name: "高等数学" },
  { id: "linear", name: "线性代数" },
  { id: "probability", name: "概率论与数理统计" },
];

export const mathCurriculum = [
  section("advanced", "高等数学", "adv-1", "第一章 - 函数、极限、连续", [
    item("adv-1-1", "1.1", "函数概念与性质"),
    item("adv-1-2", "1.2", "数列极限"),
    item("adv-1-3", "1.3", "函数极限"),
    item("adv-1-4", "1.4", "无穷小及其阶数"),
    item("adv-1-5", "1.5", "无穷大与无界"),
    item("adv-1-6", "1.6", "函数极限计算"),
    item("adv-1-7", "1.7", "连续与间断点"),
    item("adv-1-8", "1.8", "闭区间连续函数的性质"),
  ]),
  section("advanced", "高等数学", "adv-2", "第二章 - 导数与微分", [
    item("adv-2-1", "2.1", "导数与微分的概念"),
    item("adv-2-2", "2.2", "微分定义及应用"),
    item("adv-2-3", "2.3", "导数与微分计算"),
    item("adv-2-4", "2.4", "微分中值定理"),
    item("adv-2-5", "2.5", "泰勒公式"),
    item("adv-2-6", "2.6", "高阶导数"),
    item("adv-2-7", "2.7", "极值与最值"),
    item("adv-2-8", "2.8", "凹凸性与拐点"),
    item("adv-2-9", "2.9", "求渐近线、曲率"),
    item("adv-2-10", "2.10", "方程根问题、不等式证明"),
  ]),
  section("advanced", "高等数学", "adv-3", "第三章 - 一元积分学", [
    item("adv-3-1", "3.1", "不定积分的概念与性质"),
    item("adv-3-2a", "3.2", "不定积分计算(1)"),
    item("adv-3-2b", "3.2", "不定积分计算(2)"),
    item("adv-3-2c", "3.2", "不定积分计算(3)"),
    item("adv-3-3", "3.3", "定积分的概念与性质"),
    item("adv-3-4a", "3.4", "定积分计算(1)"),
    item("adv-3-4b", "3.4", "定积分计算(2)"),
    item("adv-3-5a", "3.5", "定积分的几何应用(1)"),
    item("adv-3-5b", "3.5", "定积分的几何应用(2)"),
    item("adv-3-6a", "3.6", "变限积分(1)"),
    item("adv-3-6b", "3.6", "变限积分(2)"),
    item("adv-3-7", "3.7", "反常积分"),
  ]),
  section("advanced", "高等数学", "adv-4", "第四章 - 多元微分学", [
    item("adv-4-1a", "4.1", "多元微分学基本概念(1)"),
    item("adv-4-1b", "4.1", "多元微分学基本概念(2)"),
    item("adv-4-2", "4.2", "具体多元函数求偏导数与全微分"),
    item("adv-4-3a", "4.3", "多元复合函数求偏导数与全微分(1)"),
    item("adv-4-3b", "4.3", "多元复合函数求偏导数与全微分(2)"),
    item("adv-4-4", "4.4", "隐函数求偏导数与全微分"),
    item("adv-4-5", "4.5", "多元函数的极值与最值"),
  ]),
  section("advanced", "高等数学", "adv-5", "第五章 - 二重积分", [
    item("adv-5-1", "5.1", "二重积分绘图"),
    item("adv-5-2", "5.2", "二重积分的定义与性质"),
    item("adv-5-3", "5.3", "直角坐标系下二重积分的计算"),
    item("adv-5-4a", "5.4", "极坐标系下二重积分的计算(1)"),
    item("adv-5-4b", "5.4", "极坐标系下二重积分的计算(2)"),
    item("adv-5-5", "5.5", "二重积分的对称性"),
    item("adv-5-6", "5.6", "二重积分综合题型"),
  ]),
  section("advanced", "高等数学", "adv-6", "第六章 - 微分方程", [
    item("adv-6-1", "6.1", "微分方程基本概念"),
    item("adv-6-2", "6.2", "一阶微分方程"),
    item("adv-6-3", "6.3", "高阶线性微分方程"),
    item("adv-6-4", "6.4", "微分方程综合题型"),
  ]),
  section("advanced", "高等数学", "adv-7", "第七章 - 级数", [
    item("adv-7-1", "7.1", "常数项级数"),
    item("adv-7-2", "7.2", "正项级数的敛散性判别"),
    item("adv-7-3", "7.3", "任意项级数的敛散性判别"),
    item("adv-7-4", "7.4", "幂级数及其收敛域"),
    item("adv-7-5", "7.5", "幂级数求和"),
    item("adv-7-6", "7.6", "函数展开成幂级数"),
  ]),
  section("advanced", "高等数学", "adv-8", "第八章 - 初等数学知识", [
    item("adv-8-1", "初等数学知识(1)", "初等数学知识(1)"),
    item("adv-8-2", "初等数学知识(2)", "初等数学知识(2)"),
    item("adv-8-3", "初等数学知识(3)", "初等数学知识(3)"),
  ]),
  section("linear", "线性代数", "lin-1", "第一章 - 行列式", [
    item("lin-1-1", "1.1", "行列式的定义"),
    item("lin-1-2", "1.2", "行列式的性质"),
    item("lin-1-3", "1.3", "行列式的计算"),
    item("lin-1-4", "1.4", "特殊行列式的计算"),
    item("lin-1-5", "1.5", "克拉默法则"),
  ]),
  section("linear", "线性代数", "lin-2", "第二章 - 矩阵", [
    item("lin-2-1", "2.1", "矩阵的定义"),
    item("lin-2-2", "2.2", "常见的特殊矩阵"),
    item("lin-2-3", "2.3", "矩阵基本运算"),
    item("lin-2-4", "2.4", "方阵的幂和方阵的多项式"),
    item("lin-2-5", "2.5", "转置矩阵"),
    item("lin-2-6", "2.6", "伴随矩阵"),
    item("lin-2-7", "2.7", "逆矩阵"),
    item("lin-2-8", "2.8", "矩阵的分块"),
    item("lin-2-9", "2.9", "初等变换与初等矩阵"),
    item("lin-2-10", "2.10", "矩阵的秩"),
  ]),
  section("linear", "线性代数", "lin-3", "第三章 - 线性方程组", [
    item("lin-3-1", "3.1", "线性方程组的定义及基本概念"),
    item("lin-3-2", "3.2", "解方程原理及高斯消元法"),
    item("lin-3-3", "3.3", "方程组解的判定"),
  ]),
  section("linear", "线性代数", "lin-4", "第四章 - 向量与方程组", [
    item("lin-4-1", "4.1", "向量的基本概念"),
    item("lin-4-2", "4.2", "向量组的基本概念"),
    item("lin-4-3", "4.3", "线性相关、线性无关与线性表示"),
    item("lin-4-4", "4.4", "向量组的极大线性无关组、秩"),
    item("lin-4-5", "4.5", "向量组等价"),
    item("lin-4-6", "4.6", "基础解系与解的结构"),
  ]),
  section("linear", "线性代数", "lin-5", "第五章 - 矩阵相似理论", [
    item("lin-5-1", "5.1", "特征值与特征向量"),
    item("lin-5-2", "5.2", "秩为1矩阵专题"),
    item("lin-5-3", "5.3", "矩阵相似"),
    item("lin-5-4", "5.4", "矩阵相似对角化"),
    item("lin-5-5", "5.5", "实对称矩阵相似对角化"),
  ]),
  section("linear", "线性代数", "lin-6", "第六章 - 二次型", [
    item("lin-6-1", "6.1", "二次型的定义及其表示"),
    item("lin-6-2", "6.2", "可逆线性变换与矩阵合同"),
    item("lin-6-3", "6.3", "二次型的标准形和规范形"),
    item("lin-6-4", "6.4", "正定二次型"),
    item("lin-6-5", "6.5", "矩阵等价、相似、合同"),
  ]),
  section("probability", "概率论与数理统计", "prob-1", "概率论与数理统计目录", [
    item("prob-custom", "待补充", "贴入目录后可扩展"),
  ]),
];

export const mathItems = mathCurriculum.flatMap((sectionItem) => sectionItem.items.map((chapterItem) => ({
  ...chapterItem,
  trackId: sectionItem.trackId,
  trackName: sectionItem.trackName,
  sectionId: sectionItem.id,
  sectionTitle: sectionItem.title,
})));

function section(trackId, trackName, id, title, items) {
  return { trackId, trackName, id, title, items };
}

function item(id, code, title) {
  return { id, code, title };
}

export function getProgressMap(progressRecords = []) {
  return progressRecords.reduce((map, record) => {
    map[record.itemId] = record;
    return map;
  }, {});
}

export function isSectionComplete(sectionItem, progressMap) {
  return sectionItem.items.length > 0 && sectionItem.items.every((chapterItem) => isItemFullyComplete(progressMap[chapterItem.id]));
}

export function isItemFullyComplete(record) {
  return Boolean(record?.completed || (record?.courseCompleted && record?.exerciseCompleted));
}

export function extractMathProgressFromReview(parsedReview) {
  const progressText = normalizeReviewProgressText(parsedReview?.subjects?.math?.progress);
  return extractMathProgressFromText(progressText);
}

export function normalizeReviewProgressText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined && String(item).trim())
    .map(([key, item]) => `${key}：${item}`).join("\n");
  return typeof value === "string" ? value : "";
}

export function extractMathProgressFromText(text) {
  const content = String(text || "");
  if (!content.trim()) return [];

  const matched = new Map();
  [...extractCodeMentions(content), ...extractTitleMentions(content)].forEach((mention) => {
    const candidates = findMathCandidates(mention.code, mention.trackHint);
    candidates.forEach((candidate) => {
      const existing = matched.get(candidate.id);
      const next = {
        ...candidate,
        detectedCourse: Boolean(existing?.detectedCourse || mention.mode.course),
        detectedExercise: Boolean(existing?.detectedExercise || mention.mode.exercise),
        modeSpecified: Boolean(existing?.modeSpecified || mention.mode.specified),
      };
      matched.set(candidate.id, next);
    });
  });

  return Array.from(matched.values());
}

function extractTitleMentions(content) {
  const mentions = [];
  const lines = content.split(/\n+/);

  lines.forEach((line) => {
    if (isMathProgressStatLine(line)) return;
    const normalizedLine = normalizeMathTitle(line);
    if (!normalizedLine) return;
    mathItems.forEach((chapterItem) => {
      const normalizedTitle = normalizeMathTitle(chapterItem.title);
      if (normalizedTitle.length < 4 || !normalizedLine.includes(normalizedTitle)) return;
      const phraseMode = detectProgressMode(line);
      mentions.push({
        code: chapterItem.code,
        trackHint: chapterItem.trackId,
        mode: phraseMode,
      });
    });
  });

  return mentions;
}

function extractCodeMentions(content) {
  const mentions = [];
  const lines = content.split(/\n+/);

  lines.forEach((line) => {
    if (isMathProgressStatLine(line)) return;
    const trackHint = detectTrackHint(line, content);
    const pattern = /\d+\.\d+(?:\s*[-~—到至]\s*\d+\.\d+)?/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const phrase = codePhrase(line, match.index, match.index + match[0].length);
      const phraseMode = detectProgressMode(phrase);
      const mode = phraseMode.specified ? phraseMode : detectProgressMode(line);
      expandCodes([match[0]]).forEach((code) => mentions.push({ code, trackHint, mode }));
    }
  });

  return mentions;
}

function isMathProgressStatLine(line) {
  return /^\s*[-*]?\s*(网课|习题)\s*[：:]\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*$/.test(String(line || ""));
}

function normalizeMathTitle(text) {
  return String(text || "").replace(/[\s：:，,；;。·\-—｜|（）()]/g, "");
}

function codePhrase(line, start, end) {
  const before = line.slice(0, start);
  const after = line.slice(end);
  const left = Math.max(
    before.lastIndexOf("，"),
    before.lastIndexOf(","),
    before.lastIndexOf("；"),
    before.lastIndexOf(";"),
    before.lastIndexOf("。"),
    before.lastIndexOf("！"),
    before.lastIndexOf("？")
  );
  const rightIndexes = ["，", ",", "；", ";", "。", "！", "？"]
    .map((mark) => {
      const index = after.indexOf(mark);
      return index >= 0 ? end + index : -1;
    })
    .filter((index) => index >= 0);
  const right = rightIndexes.length ? Math.min(...rightIndexes) : line.length;
  return line.slice(left + 1, right);
}

function detectTrackHint(line, content) {
  if (/线性代数|线代/.test(line)) return "linear";
  if (/概率|数理统计/.test(line)) return "probability";
  if (/高等数学|高数/.test(line)) return "advanced";
  if (/线性代数|线代/.test(content)) return "linear";
  if (/概率|数理统计/.test(content)) return "probability";
  return "advanced";
}

function detectProgressMode(context) {
  const exercise = /习题|做题|刷题|练习|真题|错题|题目|题型|作业/.test(context);
  const course = /网课|课程|听课|看课|视频|学完|学了|学习|过完|听完|看完/.test(context);
  return {
    course,
    exercise,
    specified: course || exercise,
  };
}

function findMathCandidates(code, trackHint) {
  const sameTrack = mathItems.filter((chapterItem) => chapterItem.trackId === trackHint && chapterItem.code === code);
  const major = Number(code.split(".")[0]);
  const shouldStayInLinear = trackHint === "linear" && major >= 1 && major <= 6;
  return sameTrack.length
    ? sameTrack
    : shouldStayInLinear
      ? []
      : mathItems.filter((chapterItem) => chapterItem.code === code);
}

function expandCodes(matches) {
  const result = [];
  matches.forEach((match) => {
    const range = match.match(/(\d+)\.(\d+)\s*[-~—到至]\s*(\d+)\.(\d+)/);
    if (!range) {
      result.push(match.replace(/\s/g, ""));
      return;
    }
    const startMajor = Number(range[1]);
    const startMinor = Number(range[2]);
    const endMajor = Number(range[3]);
    const endMinor = Number(range[4]);
    if (startMajor === endMajor) {
      for (let minor = startMinor; minor <= endMinor; minor += 1) result.push(`${startMajor}.${minor}`);
      return;
    }
    for (let minor = startMinor; minor <= 20; minor += 1) result.push(`${startMajor}.${minor}`);
    for (let major = startMajor + 1; major < endMajor; major += 1) {
      for (let minor = 1; minor <= 20; minor += 1) result.push(`${major}.${minor}`);
    }
    for (let minor = 1; minor <= endMinor; minor += 1) result.push(`${endMajor}.${minor}`);
  });
  return result;
}
