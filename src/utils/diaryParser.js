function normalize(text) {
  return String(text || "").replace(/\r\n/g, "\n");
}

export function splitDiaryListValue(value = "") {
  return String(value || "")
    .split(/[,，、;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeDiaryTags(tags = []) {
  const source = Array.isArray(tags) ? tags : splitDiaryListValue(tags);
  const seen = new Set();
  return source
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => (/^[\x00-\x7F]+$/.test(tag) ? tag.toLowerCase() : tag))
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

export function groupDiaryTags(tags = []) {
  const groups = {
    domain: [],
    emotion: [],
    growth: [],
    people: [],
    event: [],
    custom: [],
  };
  const rules = [
    ["domain", /学习|数学|英语|雅思|经济|金融|专业课|论文|红会|工作|日语|考研|清华|复盘|管理系统/],
    ["emotion", /开心|快乐|难过|委屈|焦虑|紧张|平静|松弛|疲惫|崩溃|骄傲|沮丧|烦|失落|感动/],
    ["growth", /成长|自控|掌控|稳定|执行|边界|复原|调整|自洽|责任|勇气|自我接纳|习惯/],
    ["people", /老师|同学|朋友|家人|专家|小米|Claire|自己|妈妈|爸爸|导师/],
    ["event", /会议|分享|考试|运动|熬夜|失控|汇报|面试|ddl|聚会|打卡|高质量日/],
  ];

  normalizeDiaryTags(tags).forEach((tag) => {
    const matched = rules.find(([, pattern]) => pattern.test(tag));
    groups[matched?.[0] || "custom"].push(tag);
  });
  return groups;
}

export function parseDiaryFromMarkdown(markdown, date = "") {
  const text = normalize(markdown);
  const startMatch = text.match(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:🧩\s*)?(?:\*\*)?\s*日记\s*(?:\*\*)?\s*\n?/u);
  if (!startMatch) return null;

  const start = startMatch.index + startMatch[0].length;
  const rest = text.slice(start);
  const endMatch = rest.search(/\n\s*(?:🔧|🌙|⭐|---|#{2,4}\s|###\s|💪|💼|📌|😴|🎮|🧩\s*(?:\*\*)?今日最大卡点)/u);
  const section = (endMatch >= 0 ? rest.slice(0, endMatch) : rest).trim();
  if (!section) return null;

  const meta = {
    title: "",
    tags: [],
    people: [],
    places: [],
    isPrivate: true,
    favorite: false,
  };
  const contentLines = [];

  section
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const clean = line.replace(/^[\-*]\s*/, "").trim();
      const pair = clean.match(/^(标题|题目|正文|标签|tags|人物|地点|位置|情绪|可见性|隐私|收藏|favorite)\s*[:：]\s*(.*)$/i);
      if (!pair) {
        contentLines.push(line);
        return;
      }
      const key = pair[1].toLowerCase();
      const value = pair[2].trim();
      if (/标题|题目/.test(key)) meta.title = value;
      else if (/正文/.test(key) && value) contentLines.push(value);
      else if (/标签|tags/.test(key)) meta.tags = splitDiaryListValue(value);
      else if (/人物/.test(key)) meta.people = splitDiaryListValue(value);
      else if (/地点|位置/.test(key)) meta.places = splitDiaryListValue(value);
      else if (/情绪/.test(key)) meta.tags.push(...splitDiaryListValue(value));
      else if (/可见性|隐私/.test(key)) meta.isPrivate = !/公开|public/i.test(value);
      else if (/收藏|favorite/.test(key)) meta.favorite = /是|true|yes|y|收藏|⭐|star/i.test(value);
    });

  const content = contentLines.join("\n").trim();
  if (!content) return null;

  const rawTags = normalizeDiaryTags(meta.tags);
  const normalizedTags = normalizeDiaryTags(rawTags);
  return {
    date,
    title: meta.title || generateDiaryTitle(content, date),
    summary: generateDiarySummary(content),
    content,
    rawTags,
    normalizedTags,
    tagGroups: groupDiaryTags(normalizedTags),
    people: splitDiaryListValue(meta.people),
    places: splitDiaryListValue(meta.places),
    isPrivate: meta.isPrivate,
    favorite: meta.favorite,
    wordCount: countDiaryWords(content),
  };
}

export function generateDiaryTitle(content, date = "") {
  const firstLine = String(content || "").split("\n").find(Boolean) || "";
  const clean = firstLine.replace(/[#>*`]/g, "").trim();
  return clean.slice(0, 18) || "未命名日记";
}

export function generateDiarySummary(content) {
  const clean = String(content || "")
    .replace(/\s+/g, " ")
    .replace(/^[#>*`\- ]+/, "")
    .trim();
  const firstSentence = clean.match(/^(.{1,70}?[。！？!?]|.{1,52})/)?.[1] || "";
  return firstSentence.trim();
}

export function countDiaryWords(content) {
  const text = String(content || "").trim();
  if (!text) return 0;
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5]/g, " ").match(/[A-Za-z0-9_-]+/g) || []).length;
  return chinese + words;
}
