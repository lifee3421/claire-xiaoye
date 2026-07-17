function scalarText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

export function reviewValueLines(value) {
  if (Array.isArray(value)) return value.flatMap((item) => reviewValueLines(item)).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.entries(value)
      .flatMap(([key, item]) => {
        const detail = reviewValueLines(item).join("；");
        return detail ? [`${key}：${detail}`] : [];
      });
  }
  const text = scalarText(value);
  return text ? [text] : [];
}

export function reviewValueText(value, separator = "；") {
  return reviewValueLines(value).join(separator);
}
