function normalize(text) {
  return String(text || "").replace(/\r\n/g, "\n");
}

export function normalizeDiaryTags(tags = []) {
  const source = Array.isArray(tags) ? tags : String(tags || "").split(/[,，、;；\n]/);
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

export function parseDiaryFromMarkdown(markdown, date = "") {
  const text = normalize(markdown);
  const startMatch = text.match(/(?:^|\n)\s*(?:#{1,4}\s*)?🧩\s*(?:\*\*)?\s*日记\s*(?:\*\*)?\s*\n?/);
  if (!startMatch) return null;

  const start = startMatch.index + startMatch[0].length;
  const rest = text.slice(start);
  const endMatch = rest.search(/\n\s*(?:🔧|🌙|⭐|---|#{2,4}\s|###\s|💪|💼|📌|😴|🎮|🧩\s*(?:\*\*)?今日最大卡点)/u);
  const section = (endMatch >= 0 ? rest.slice(0, endMatch) : rest).trim();
  if (!section) return null;

  const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
  const tagLineIndex = lines.findIndex((line) => /^(标签|tags)\s*[：:]/i.test(line.replace(/^[\-*]\s*/, "")));
  const rawTagText = tagLineIndex >= 0
    ? lines[tagLineIndex].replace(/^[\-*]\s*/, "").replace(/^(标签|tags)\s*[：:]\s*/i, "")
    : "";
  const contentLines = tagLineIndex >= 0 ? lines.filter((_, index) => index !== tagLineIndex) : lines;
  const content = contentLines.join("\n").trim();
  if (!content) return null;

  const rawTags = normalizeDiaryTags(rawTagText);
  return {
    date,
    title: generateDiaryTitle(content, date),
    content,
    rawTags,
    normalizedTags: normalizeDiaryTags(rawTags),
    wordCount: countDiaryWords(content),
  };
}

export function generateDiaryTitle(content, date = "") {
  const firstLine = String(content || "").split("\n").find(Boolean) || "";
  const clean = firstLine.replace(/[#>*`]/g, "").trim();
  return clean.slice(0, 18) || `${date || "今日"}日记`;
}

export function countDiaryWords(content) {
  const text = String(content || "").trim();
  if (!text) return 0;
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5]/g, " ").match(/[A-Za-z0-9_-]+/g) || []).length;
  return chinese + words;
}
