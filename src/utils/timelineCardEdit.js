function own(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Creates the form model for one rendered timeline segment.  The raw override
 * is deliberately separate from the resolved block: this is what lets the UI
 * distinguish “inherit” from an explicit on/off choice after reopening.
 */
export function buildTimelineCardEditForm({ task = {}, block = {}, segmentOverride = {}, defaultAdvanceMinutes = 5 } = {}) {
  const explicitReminder = segmentOverride?.snowdustReminder;
  const inheritedReminder = task.snowdustReminder;
  const explicitDeskVerification = segmentOverride?.deskVerification;
  const inheritedAdvanceMinutes = Number(inheritedReminder?.advanceMinutes ?? defaultAdvanceMinutes);
  return {
    title: typeof segmentOverride.title === "string" && segmentOverride.title.trim() ? segmentOverride.title : task.title || "",
    workMinutes: Number(segmentOverride.workMinutes ?? block.studyMinutes ?? task.segments?.[0] ?? 50),
    breakMinutes: Number(segmentOverride.restMinutes ?? block.breakMinutes ?? task.breakMinutes ?? 0),
    locked: Boolean(segmentOverride.locked ?? block.locked ?? task.locked),
    priority: Number(segmentOverride.priority ?? block.priority ?? task.priority ?? 2),
    preferredPeriod: segmentOverride.preferredPeriods?.[0] || block.preferredPeriods?.[0] || task.preferredPeriods?.[0] || "afternoon",
    categoryId: segmentOverride.categoryId || task.categoryId || "personal",
    snowdustReminderMode: explicitReminder?.mode === "on" || explicitReminder?.mode === "off" ? explicitReminder.mode : "inherit",
    snowdustAdvanceMinutes: Number(explicitReminder?.advanceMinutes ?? inheritedAdvanceMinutes),
    inheritedSnowdustAdvanceMinutes: inheritedAdvanceMinutes,
    deskVerificationMode: explicitDeskVerification?.mode === "on" || explicitDeskVerification?.mode === "off" ? explicitDeskVerification.mode : "inherit",
  };
}

/** Produces a minimal segment mutation, retaining unrelated explicit fields. */
export function buildTimelineSegmentEditPatch({ initialForm = {}, form = {}, segmentOverride = {}, categoryPatch = {} } = {}) {
  const patch = {};
  const assignIfChanged = (key, value) => {
    if (!equal(value, initialForm[key])) patch[key] = value;
  };
  assignIfChanged("title", String(form.title || "").trim());
  assignIfChanged("workMinutes", Number(form.workMinutes || 0));
  if (Number(form.breakMinutes || 0) !== Number(initialForm.breakMinutes || 0)) {
    patch.restMinutes = Number(form.breakMinutes || 0);
  }
  assignIfChanged("locked", Boolean(form.locked));
  assignIfChanged("priority", Number(form.priority || 0));
  assignIfChanged("preferredPeriod", form.preferredPeriod);
  if (patch.preferredPeriod !== undefined) {
    patch.preferredPeriods = [patch.preferredPeriod];
    delete patch.preferredPeriod;
  }
  if (!equal(form.categoryId, initialForm.categoryId)) Object.assign(patch, categoryPatch);

  const clearOverrideFields = [];
  if (form.snowdustReminderMode === "inherit") {
    if (initialForm.snowdustReminderMode !== "inherit" || own(segmentOverride, "snowdustReminder")) clearOverrideFields.push("snowdustReminder");
  } else if (form.snowdustReminderMode !== initialForm.snowdustReminderMode || Number(form.snowdustAdvanceMinutes) !== Number(initialForm.snowdustAdvanceMinutes)) {
    patch.snowdustReminder = { mode: form.snowdustReminderMode, advanceMinutes: Math.max(0, Number(form.snowdustAdvanceMinutes) || 0) };
  }
  if (form.deskVerificationMode === "inherit") {
    if (initialForm.deskVerificationMode !== "inherit" || own(segmentOverride, "deskVerification")) clearOverrideFields.push("deskVerification");
  } else if (form.deskVerificationMode !== initialForm.deskVerificationMode) {
    patch.deskVerification = { mode: form.deskVerificationMode };
  }
  return { patch, clearOverrideFields };
}

/** Applies an edit exactly as the planner persistence layer does. */
export function applyTimelineSegmentEdit(draft = {}, blockId, { patch = {}, clearOverrideFields = [] } = {}) {
  const existing = draft.todaySegmentOverrides?.[blockId] || {};
  const next = { ...existing, ...patch };
  clearOverrideFields.forEach((key) => delete next[key]);
  return {
    ...draft,
    todaySegmentOverrides: { ...(draft.todaySegmentOverrides || {}), [blockId]: next },
  };
}
