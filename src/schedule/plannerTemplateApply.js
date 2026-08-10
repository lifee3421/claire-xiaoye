import { instantiateTemplateTaskCollections } from "../utils/plannerTemplateSnapshot.js";
import { LIFE_CATEGORY_IDS, ensureMorningRoutineCard, findDayStartAnchor } from "../utils/unifiedPlannerCards.js";
import { plannerCategoryId } from "./plannerLiveTimeline.js";

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeScopes(scopes = {}) {
  return {
    boundaries: scopes.boundaries !== false,
    defaultTasks: scopes.defaultTasks !== false,
    timeline: scopes.timeline !== false,
  };
}

function contentDayFields(content = {}) {
  const {
    fixedEvents,
    fixedEventOverrides,
    defaultTaskGroups,
    timelineSegments,
    morningRoutine,
    ...fields
  } = content || {};
  return clone(fields);
}

export function findSavedDayTemplate(settings = {}, templateId = "") {
  const templates = Array.isArray(settings.dayTemplates) ? settings.dayTemplates : [];
  return templates.find((item) => item?.id === templateId || item?.systemKey === templateId) || null;
}

/**
 * Apply one persisted day template without the browser being open. This uses
 * the same instantiateTemplateTaskCollections primitive as App.jsx. It only
 * materializes the chosen template; later PlannerPatch operations remain the
 * normal mechanism for day-specific edits.
 */
export function applySavedDayTemplate({ draft = {}, settings = {}, templateId = "", scopes = {}, now = new Date(), idFactory } = {}) {
  const template = findSavedDayTemplate(settings, templateId);
  if (!template) return { ok: false, reason: "template_not_found", templateId };
  const content = template.content && typeof template.content === "object" ? clone(template.content) : {};
  const selected = normalizeScopes(scopes);
  let next = ensureMorningRoutineCard(clone(draft));

  if (selected.boundaries) Object.assign(next, contentDayFields(content));

  // Re-applying the same template is a reset of that template's generated
  // tasks, not a duplicate append. User-created/non-template cards survive.
  next.todayCustomBlocks = (next.todayCustomBlocks || []).filter((task) => task?.originTemplateId !== template.id);

  if (selected.timeline) {
    const lockedOverrides = Object.fromEntries(Object.entries(next.fixedEventOverrides || {}).filter(([, item]) => item?.locked));
    next.fixedEventOverrides = { ...clone(content.fixedEventOverrides || {}), ...lockedOverrides };
    const lockedCustomEvents = (next.fixedEvents || []).filter((event) => event?.locked);
    const stamp = (now instanceof Date ? now : new Date(now)).getTime();
    next.fixedEvents = [
      ...lockedCustomEvents,
      ...(Array.isArray(content.fixedEvents) ? content.fixedEvents : []).map((event, index) => ({
        ...clone(event),
        id: `event-template-${stamp}-${index}`,
        locked: Boolean(event?.locked),
        originTemplateId: template.id,
      })),
    ];
  }

  const existingTaskIdBySourceId = Object.fromEntries((next.todayCustomBlocks || [])
    .filter((task) => task?.categoryId === LIFE_CATEGORY_IDS.morningRoutine)
    .map((task) => [task.id, task.id]));
  const stamp = (now instanceof Date ? now : new Date(now)).getTime();
  const makeId = (prefix, index) => idFactory ? idFactory(prefix, index) : `${prefix}-${stamp}-${index}`;
  const { defaultTasks, timelineTasks, timelineOverrides } = instantiateTemplateTaskCollections({
    defaultTaskGroups: Array.isArray(content.defaultTaskGroups) ? content.defaultTaskGroups : [],
    timelineSegments: Array.isArray(content.timelineSegments) ? content.timelineSegments : [],
    includeDefaultTasks: selected.defaultTasks,
    includeTimeline: selected.timeline,
    existingTaskIdBySourceId,
    makeId,
  });
  const generatedTasks = [...defaultTasks, ...timelineTasks].map((task) => ({
    ...task,
    categoryId: plannerCategoryId(task),
    originTemplateId: template.id,
    note: task.note || `来自模板「${template.name || template.id}」`,
  }));
  if (generatedTasks.length) next.todayCustomBlocks = [...(next.todayCustomBlocks || []), ...generatedTasks];
  if (selected.timeline) next.todaySegmentOverrides = { ...(next.todaySegmentOverrides || {}), ...timelineOverrides };

  if (selected.timeline && content.morningRoutine?.categoryId === LIFE_CATEGORY_IDS.morningRoutine) {
    const morning = findDayStartAnchor(next.todayCustomBlocks || []);
    if (morning) {
      const startMinute = Number(content.morningRoutine.startMinute);
      const workMinutes = Number(content.morningRoutine.workMinutes);
      next.todaySegmentOverrides = {
        ...(next.todaySegmentOverrides || {}),
        [`${morning.id}-1`]: {
          ...(next.todaySegmentOverrides?.[`${morning.id}-1`] || {}),
          placement: "timeline",
          ...(Number.isFinite(startMinute) ? { manualStart: startMinute } : {}),
          ...(Number.isFinite(workMinutes) && workMinutes > 0 ? { workMinutes } : {}),
          locked: true,
          status: "pending",
        },
      };
    }
  }

  next.sourceTemplateId = template.id;
  return {
    ok: true,
    nextDraft: next,
    templateId: template.id,
    templateName: template.name || template.id,
    createdTaskIds: generatedTasks.map((task) => task.id),
  };
}
