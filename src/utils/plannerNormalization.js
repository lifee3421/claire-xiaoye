export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value) {
  return isRecord(value) ? value : {};
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function finiteNumber(value, fallback = 0, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const bounded = Math.min(max, Math.max(min, number));
  return integer ? Math.round(bounded) : bounded;
}

export function isIsoCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeIsoTimestamp(value) {
  const candidate = value?.toDate ? value.toDate() : value;
  const date = candidate instanceof Date ? candidate : new Date(candidate || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeRecordArray(value) {
  return asArray(value).filter(isRecord).map((item) => ({ ...item }));
}

function normalizeStringArray(value) {
  return asArray(value).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

/**
 * Single compatibility boundary for persisted planner drafts. It does not mutate
 * the Firebase/demo source object and leaves unknown fields intact.
 */
export function normalizeScheduleAssistantDraft(raw, { fallbackTargetDate = "", defaults = {} } = {}) {
  const source = asRecord(raw);
  const result = { ...defaults, ...source };
  const targetDate = isIsoCalendarDate(source.targetDate)
    ? source.targetDate
    : isIsoCalendarDate(source.savedOn)
      ? source.savedOn
      : fallbackTargetDate;

  [
    "lunchBlockMinutes",
    "dinnerMinutes",
    "startupBufferMinutes",
    "formalRestMinutes",
    "morningPrepMinutes",
    "thesisMinutes",
    "professionalMinutes",
    "exerciseMinutes",
    "showerMinutes",
    "maskMinutes",
  ].forEach((key) => {
    result[key] = finiteNumber(source[key], finiteNumber(defaults[key], 0), { min: 0, max: 24 * 60 });
  });
  ["formalRestBlocks", "preferredGroupSize", "maxConsecutiveBlocks"].forEach((key) => {
    if (source[key] === undefined && defaults[key] === undefined) return;
    result[key] = finiteNumber(source[key], finiteNumber(defaults[key], 1, { min: 1, max: 24, integer: true }), { min: 1, max: 24, integer: true });
  });

  result.targetDate = targetDate;
  result.savedOn = isIsoCalendarDate(source.savedOn) ? source.savedOn : targetDate;
  result.updatedAt = normalizeIsoTimestamp(source.updatedAt);
  result.fixedEvents = normalizeRecordArray(source.fixedEvents);
  result.todayCustomBlocks = normalizeRecordArray(source.todayCustomBlocks);
  result.fixedEventOverrides = asRecord(source.fixedEventOverrides);
  result.todayTaskOverrides = asRecord(source.todayTaskOverrides);
  result.todaySegmentOverrides = asRecord(source.todaySegmentOverrides);
  result.segmentGoals = asRecord(source.segmentGoals);
  result.deletedTodayTaskIds = normalizeStringArray(source.deletedTodayTaskIds);
  result.taskPoolOrder = normalizeStringArray(source.taskPoolOrder);
  return result;
}

/** Keeps settings collection-shaped fields safe before the App-specific merge. */
export function normalizeScheduleAssistantSettings(raw) {
  const source = asRecord(raw);
  const englishRotationSettings = asRecord(source.englishRotationSettings);
  return {
    ...source,
    mathTemplates: normalizeRecordArray(source.mathTemplates),
    englishTemplates: normalizeRecordArray(source.englishTemplates),
    dayTemplates: normalizeRecordArray(source.dayTemplates),
    commonTasks: normalizeRecordArray(source.commonTasks),
    rhythmPresets: normalizeRecordArray(source.rhythmPresets),
    deletedDayTemplateSystemKeys: normalizeStringArray(source.deletedDayTemplateSystemKeys),
    englishRotationSettings: {
      ...englishRotationSettings,
      enabledSkills: normalizeStringArray(englishRotationSettings.enabledSkills),
    },
  };
}

export function normalizeScheduleDraftArchive(raw) {
  return normalizeRecordArray(raw);
}
