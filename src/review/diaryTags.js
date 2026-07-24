// diary.tags stays a plain comma-joined string in the schema/draft — these
// helpers only convert to/from that string for the chip UI, no new data shape.
export function parseTagsText(rawValue) {
  return String(rawValue || "")
    .split(/[,，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function addTag(rawValue, newTag) {
  const tags = parseTagsText(rawValue);
  const trimmed = String(newTag || "").trim();
  if (!trimmed || tags.includes(trimmed)) return tags.join(", ");
  return [...tags, trimmed].join(", ");
}

export function removeTagAt(rawValue, index) {
  const tags = parseTagsText(rawValue);
  return tags.filter((_, i) => i !== index).join(", ");
}
