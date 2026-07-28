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
  const explicitStartVerification = segmentOverride?.startVerification || segmentOverride?.deskVerification;
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
    startVerificationMode: explicitStartVerification?.mode === "on" || explicitStartVerification?.mode === "off" ? explicitStartVerification.mode : "inherit",
    startVerificationMethod: ["smart", "photo", "text"].includes(explicitStartVerification?.method) ? explicitStartVerification.method : "smart",
    startVerificationKind: explicitStartVerification?.method === "smart" ? "" : (["study_ready", "exercise_ready", "text_ack"].includes(explicitStartVerification?.kind) ? explicitStartVerification.kind : "study_ready"),
    deskVerificationMode: explicitStartVerification?.mode === "on" || explicitStartVerification?.mode === "off" ? explicitStartVerification.mode : "inherit",
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
  const verificationMode = form.deskVerificationMode !== undefined && form.deskVerificationMode !== initialForm.deskVerificationMode && form.startVerificationMode === initialForm.startVerificationMode
    ? form.deskVerificationMode
    : (form.startVerificationMode ?? form.deskVerificationMode ?? "inherit");
  if (verificationMode === "inherit") {
    if (initialForm.startVerificationMode !== "inherit" || own(segmentOverride, "startVerification") || own(segmentOverride, "deskVerification")) clearOverrideFields.push("startVerification", "deskVerification");
  } else if (verificationMode !== initialForm.startVerificationMode || form.startVerificationMethod !== initialForm.startVerificationMethod || form.startVerificationKind !== initialForm.startVerificationKind) {
    if (form.deskVerificationMode !== undefined && form.deskVerificationMode !== initialForm.deskVerificationMode && form.startVerificationMode === initialForm.startVerificationMode) patch.deskVerification = { mode: verificationMode };
    else {
      const method = form.startVerificationMethod || "smart";
      patch.startVerification = { mode: verificationMode, method, ...(method === "smart" ? {} : { kind: form.startVerificationKind || "study_ready" }) };
    }
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
