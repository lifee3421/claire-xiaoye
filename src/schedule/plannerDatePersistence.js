function plannerDate(value = {}) {
  return typeof value?.targetDate === "string" && value.targetDate
    ? value.targetDate
    : (typeof value?.savedOn === "string" ? value.savedOn : "");
}

export function resolvePlannerDraftForDate(profile = {}, targetDate = "") {
  const live = profile?.scheduleAssistantDraft && typeof profile.scheduleAssistantDraft === "object"
    ? profile.scheduleAssistantDraft
    : {};
  if (plannerDate(live) === targetDate) return { draft: live, source: "live" };
  const archive = Array.isArray(profile?.scheduleAssistantDraftArchive) ? profile.scheduleAssistantDraftArchive : [];
  const archived = archive.find((item) => plannerDate(item) === targetDate);
  if (archived) return { draft: archived, source: "archive" };
  return { draft: { targetDate, savedOn: targetDate }, source: "new" };
}

export function upsertPlannerArchive(archive = [], draft = {}) {
  const date = plannerDate(draft);
  if (!date) return Array.isArray(archive) ? [...archive] : [];
  const rows = Array.isArray(archive) ? [...archive] : [];
  const index = rows.findIndex((item) => plannerDate(item) === date);
  if (index >= 0) rows[index] = draft;
  else rows.push(draft);
  return rows.sort((a, b) => plannerDate(a).localeCompare(plannerDate(b)));
}

/**
 * Build the user-document patch for a Snow-dust write. If the target date is
 * already the live draft, update it in place. Otherwise write only that date
 * into the archive so planning tomorrow never hijacks today's open page.
 */
export function buildPlannerDateWritePatch(profile = {}, targetDate = "", nextDraft = {}) {
  const live = profile?.scheduleAssistantDraft && typeof profile.scheduleAssistantDraft === "object"
    ? profile.scheduleAssistantDraft
    : {};
  if (plannerDate(live) === targetDate || !plannerDate(live)) {
    return { scheduleAssistantDraft: nextDraft };
  }
  return {
    scheduleAssistantDraftArchive: upsertPlannerArchive(profile.scheduleAssistantDraftArchive, nextDraft),
  };
}

/**
 * Browser startup must never seed TODAY from a draft belonging to another
 * date. Reusing yesterday's live draft here causes its task collections to be
 * carried into makeScheduleDraft(), after which today's template is
 * materialized on top and the card count effectively doubles.
 *
 * Prefer a matching live draft, then a Snow-prepared archived Today draft.
 * If neither exists, return a clean date shell so a fresh day is materialized
 * from settings/templates without inheriting any prior-day cards.
 */
export function resolveInitialPlannerDraft(profile = {}, today = "") {
  const live = profile?.scheduleAssistantDraft && typeof profile.scheduleAssistantDraft === "object"
    ? profile.scheduleAssistantDraft
    : {};
  if (plannerDate(live) === today) return live;
  const archived = (Array.isArray(profile?.scheduleAssistantDraftArchive) ? profile.scheduleAssistantDraftArchive : [])
    .find((item) => plannerDate(item) === today);
  if (archived) return archived;
  return today ? { targetDate: today, savedOn: today } : {};
}

export { plannerDate };
