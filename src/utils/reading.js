export function cleanBookTitle(title = "") {
  return String(title || "")
    .trim()
    .replace(/^《(.+)》$/, "$1")
    .replace(/[“”"]/g, "")
    .trim();
}

export function normalizeBookTitle(title = "") {
  return cleanBookTitle(title)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function readingBookId(title = "") {
  const normalized = normalizeBookTitle(title);
  return encodeURIComponent(normalized || "untitled")
    .replace(/[.%]/g, "-")
    .slice(0, 120);
}

export function readingSessionId(date = "", title = "") {
  return `${date || "unknown"}_${readingBookId(title)}`;
}

export function readingStatusText(status = "reading") {
  const map = {
    "want-to-read": "想读",
    reading: "正在读",
    finished: "已读完",
    paused: "暂停",
    abandoned: "弃读",
  };
  return map[status] || "正在读";
}

export function inferBookLanguage(title = "") {
  const text = String(title || "");
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[A-Za-z]/.test(text) && !/[\u4e00-\u9fa5]/.test(text)) return "en";
  if (/[\u4e00-\u9fa5]/.test(text)) return "zh";
  return "other";
}
