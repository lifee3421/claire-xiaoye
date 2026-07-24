// state.today.moodTag / state.today.bodyCondition stay plain comma-joined
// strings in the schema/draft — these helpers only handle multi-select
// parsing/serializing for the chip UI, plus the user's customizable option
// lists (a UI preference, not review data).
export const DEFAULT_MOOD_TAGS = ["开心", "平静", "放松", "期待", "焦虑", "烦躁", "低落", "麻木", "复杂"];
export const DEFAULT_BODY_CONDITIONS = ["很好", "正常", "疲惫", "乏力", "不舒服", "疼痛", "生病"];

export const MOOD_TAG_MAX_SELECTION = 3;
export const BODY_CONDITION_MAX_SELECTION = 2;

export function parseMultiSelectText(rawValue) {
  return String(rawValue || "")
    .split(/[,，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// Toggles `option` in the comma-joined `rawValue`, enforcing `maxSelection`.
// Selecting past the max drops the oldest selection (FIFO), so the user
// never gets silently blocked — the newest pick always wins a slot.
export function toggleMultiSelectValue(rawValue, option, maxSelection) {
  const current = parseMultiSelectText(rawValue);
  if (current.includes(option)) {
    return current.filter((item) => item !== option).join(", ");
  }
  const next = [...current, option];
  const trimmed = next.length > maxSelection ? next.slice(next.length - maxSelection) : next;
  return trimmed.join(", ");
}

export function getQuickChoiceOptions(kind, quickChoicesConfig) {
  const defaults = kind === "moodTags" ? DEFAULT_MOOD_TAGS : DEFAULT_BODY_CONDITIONS;
  const configured = quickChoicesConfig?.[kind];
  if (!Array.isArray(configured) || configured.length === 0) return defaults;
  const cleaned = configured.map((item) => String(item || "").trim()).filter(Boolean);
  const deduped = cleaned.filter((item, index) => cleaned.indexOf(item) === index);
  return deduped.length ? deduped : defaults;
}

// Any value already selected in the draft but no longer in the configured
// option list is still surfaced (as "history"), so removing an option from
// the settings panel never silently drops what a past day recorded.
export function withHistoryOptions(options, rawValue) {
  const selected = parseMultiSelectText(rawValue);
  const extra = selected.filter((value) => !options.includes(value));
  return { options, historyOptions: extra };
}

// Cleans a user-edited option list: trims, drops empties, dedupes.
export function validateQuickChoiceOptions(options) {
  const cleaned = (Array.isArray(options) ? options : [])
    .map((option) => String(option || "").trim())
    .filter(Boolean);
  return cleaned.filter((option, index) => cleaned.indexOf(option) === index);
}
