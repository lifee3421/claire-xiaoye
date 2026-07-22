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
  const content = { fixedEvents: [], fixedEventOverrides: {}, defaultTaskGroups: [], timelineSegments: [] };
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
      .filter((task) => !task.systemRole)
      .map((task, index) => ({
        templateItemId: `template-task-${index + 1}`,
        sourceTaskId: task.id,
        title: task.title,
        category: task.category,
        categoryId: task.categoryId,
        segments: copy(task.segments || []),
        breakMinutes: Number(task.breakMinutes || 0),
        priority: Number(task.priority || 2),
        manualOrder: index,
        preferredPeriods: copy(task.preferredPeriods || []),
        splittable: task.splittable !== false,
      }));
  }
  if (scopes.timeline) {
    content.timelineSegments = (autoSchedule.blocks || [])
      .filter((block) => block.kind === "task" && !block.systemRole)
      .map((block, index) => ({
        templateItemId: `template-line-${index + 1}`,
        sourceTaskId: block.taskId,
        sourceSegmentIndex: Number(block.segmentIndex || 1),
        title: block.title,
        category: block.category,
        categoryId: block.categoryId,
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
  const { fixedEvents, fixedEventOverrides, defaultTaskGroups, timelineSegments, ...nextDayFields } = next;
  return {
    ...previous,
    ...(scopes.boundaries ? nextDayFields : {}),
    fixedEvents: scopes.fixedEvents ? fixedEvents : previous.fixedEvents,
    fixedEventOverrides: scopes.fixedEvents ? fixedEventOverrides : previous.fixedEventOverrides,
    defaultTaskGroups: scopes.defaultTasks ? defaultTaskGroups : previous.defaultTaskGroups,
    timelineSegments: scopes.timeline ? timelineSegments : previous.timelineSegments,
  };
}

export function instantiateTemplateTaskCollections({ defaultTaskGroups = [], timelineSegments = [], includeDefaultTasks, includeTimeline, makeId }) {
  const taskIdBySourceId = new Map();
  const defaultTasks = includeDefaultTasks
    ? defaultTaskGroups.map((task, index) => {
      const id = makeId("template-task", index);
      if (task.sourceTaskId) taskIdBySourceId.set(task.sourceTaskId, id);
      return {
        id,
        title: task.title,
        category: task.category,
        categoryId: task.categoryId,
        segments: copy(task.segments || [Number(task.workMinutes || 0)]).filter((minutes) => Number(minutes || 0) > 0),
        breakMinutes: Number(task.breakMinutes || 0),
        splittable: task.splittable !== false,
        priority: Number(task.priority || 2),
        preferredPeriods: copy(task.preferredPeriods || ["afternoon"]),
        source: "template",
        status: "pending",
      };
    })
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
