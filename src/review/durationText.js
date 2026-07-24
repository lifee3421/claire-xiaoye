export function parseDurationText(rawValue) {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!value) return "";

  // 单独数字按分钟处理：80 => 80min
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  // 1:20 => 80min
  const colonMatch = value.match(/^(\d+):([0-5]?\d)$/);

  if (colonMatch) {
    return Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
  }

  // 1h20min / 1h / 20min
  const match = value.match(
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)min)?$/
  );

  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return Math.round(hours * 60 + minutes);
}

export function formatDurationInput(rawMinutes) {
  const minutes = Math.max(
    0,
    Math.round(Number(rawMinutes) || 0)
  );

  if (!minutes) return "";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!hours) return `${rest}min`;
  if (!rest) return `${hours}h`;

  return `${hours}h${rest}min`;
}
