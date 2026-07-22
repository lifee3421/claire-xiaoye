const copy = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export const defaultTemplateSaveScopes = Object.freeze({
  boundaries: true,
  fixedEvents: true,
  defaultTasks: true,
  timeline: true,
});

export function buildTemplateSnapshotContent({ draft = {}, autoSchedule = {}, scopes = defaultTemplateSaveScopes } = {}) {
  const content = { fixedEvents: [], fixedEventOverrides: {}, defaultTaskGroups: [], timelineSegments: [], morningRoutine: null };
  if (scopes.boundaries) Object.assign(content, {
    wakeUpTime: draft.wakeUpTime,
    targetBedTime: draft.targetBedTime,
    scene: draft.scene,
    commuteStatus: draft.commuteStatus,
    morningPrepMinutes: draft.morningPrepMinutes,
    lunchStartTime: draft.lunchStartTime,
    lunchBlockMinutes: draft.lunchBlockMinutes,
    dinnerMinutes: draft.dinnerMinutes,
    startupBufferMinutes: draft.startupBufferMinutes,
    formalRestMinutes: draft.formalRestMinutes,
    formalRestBlocks: draft.formalRestBlocks,
    exerciseMinutes: draft.exerciseMinutes,
    exerciseType: draft.exerciseType,
    showerMinutes: draft.showerMinutes,
    maskMinutes: draft.maskMinutes,
  });
  if (scopes.fixedEvents) {
    content.fixedEvents = copy(draft.fixedEvents || []);
    content.fixedEventOverrides = copy(draft.fixedEventOverrides || {});
  }
  if (scopes.defaultTasks) {
    content.defaultTaskGroups = (autoSchedule.taskGroups || [])
      .filter((task) => task.transient !== true && task.categoryId !== "life.morning-routine")
      .map((task, index) => ({
        templateItemId: `template-task-${index + 1}`,
        sourceTaskId: task.id,
        title: task.title,
        category: task.category,
        categoryId: task.categoryId,
        ...(task.systemRole ? { systemRole: task.systemRole } : {}),
        segments: copy(task.segments || []),
        breakMinutes: Number(task.breakMinutes || 0),
        priority: Number(task.priority || 2),
        manualOrder: index,
        preferredPeriods: copy(task.preferredPeriods || []),
        splittable: task.splittable !== false,
      }));
  }
  if (scopes.timeline) {
    const morning = (autoSchedule.blocks || []).find((block) => block.kind === "task" && block.categoryId === "life.morning-routine" && block.transient !== true);
    if (morning) content.morningRoutine = {
      startMinute: Number(morning.start || 0),
      workMinutes: Number(morning.studyMinutes || 0),
      locked: true,
      categoryId: "life.morning-routine",
      systemRole: "day-start-anchor",
    };
    content.timelineSegments = (autoSchedule.blocks || [])
      .filter((block) => block.kind === "task" && block.transient !== true && block.categoryId !== "life.morning-routine")
      .map((block, index) => ({
        templateItemId: `template-line-${index + 1}`,
        sourceTaskId: block.taskId,
        sourceSegmentIndex: Number(block.segmentIndex || 1),
        title: block.title,
        category: block.category,
        categoryId: block.categoryId,
        ...(block.systemRole ? { systemRole: block.systemRole } : {}),
        startMinute: Number(block.start || 0),
        endMinute: Number(block.end || 0),
        workMinutes: Number(block.studyMinutes || 0),
        restMinutes: Number(block.breakMinutes || 0),
        priority: Number(block.priority || 2),
        preferredPeriods: copy(block.preferredPeriods || []),
        locked: Boolean(block.locked),
      }));
  }
  return content;
}

export function mergeTemplateSnapshotContent(previousContent = {}, nextContent = {}, scopes = defaultTemplateSaveScopes) {
  const previous = copy(previousContent);
  const next = copy(nextContent);
  const { fixedEvents, fixedEventOverrides, defaultTaskGroups, timelineSegments, morningRoutine, ...nextDayFields } = next;
  return {
    ...previous,
    ...(scopes.boundaries ? nextDayFields : {}),
    fixedEvents: scopes.fixedEvents ? fixedEvents : previous.fixedEvents,
    fixedEventOverrides: scopes.fixedEvents ? fixedEventOverrides : previous.fixedEventOverrides,
    defaultTaskGroups: scopes.defaultTasks ? defaultTaskGroups : previous.defaultTaskGroups,
    timelineSegments: scopes.timeline ? timelineSegments : previous.timelineSegments,
    morningRoutine: scopes.timeline ? morningRoutine : previous.morningRoutine,
  };
}

export function instantiateTemplateTaskCollections({ defaultTaskGroups = [], timelineSegments = [], includeDefaultTasks, includeTimeline, existingTaskIdBySourceId = {}, makeId }) {
  const taskIdBySourceId = new Map(Object.entries(existingTaskIdBySourceId || {}));
  const defaultTasks = includeDefaultTasks
    ? defaultTaskGroups.map((task, index) => {
      const existingId = task.sourceTaskId ? taskIdBySourceId.get(task.sourceTaskId) : null;
      const id = existingId || makeId("template-task", index);
      if (task.sourceTaskId && !existingId) taskIdBySourceId.set(task.sourceTaskId, id);
      if (existingId) return null;
      return {
        id,
        title: task.title,
        category: task.category,
        categoryId: task.categoryId,
        ...(task.systemRole ? { systemRole: task.systemRole } : {}),
        segments: copy(task.segments || [Number(task.workMinutes || 0)]).filter((minutes) => Number(minutes || 0) > 0),
        breakMinutes: Number(task.breakMinutes || 0),
        splittable: task.splittable !== false,
        priority: Number(task.priority || 2),
        preferredPeriods: copy(task.preferredPeriods || ["afternoon"]),
        source: "template",
        status: "pending",
      };
    }).filter(Boolean)
    : [];
  const timelineTasks = [];
  const timelineOverrides = {};
  if (includeTimeline) {
    timelineSegments.forEach((segment, index) => {
      let id = taskIdBySourceId.get(segment.sourceTaskId);
      let segmentIndex = Number(segment.sourceSegmentIndex || 1);
      if (!id) {
        id = makeId("template-line", index);
        segmentIndex = 1;
        timelineTasks.push({
          id,
          title: segment.title,
          category: segment.category,
          categoryId: segment.categoryId,
          ...(segment.systemRole ? { systemRole: segment.systemRole } : {}),
          segments: [Number(segment.workMinutes || 0)],
          breakMinutes: Number(segment.restMinutes || 0),
          splittable: false,
          priority: Number(segment.priority || 2),
          preferredPeriods: copy(segment.preferredPeriods || []),
          source: "template",
          status: "pending",
        });
      }
      timelineOverrides[`${id}-${segmentIndex}`] = {
        placement: "timeline",
        manualStart: Number(segment.startMinute || 0),
        workMinutes: Number(segment.workMinutes || 0),
        restMinutes: Number(segment.restMinutes || 0),
        locked: Boolean(segment.locked),
        status: "pending",
      };
    });
  }
  return { defaultTasks, timelineTasks, timelineOverrides };
}
