// Pure, JSX-free planner segment/block helpers extracted out of App.jsx so
// they can be imported and integration-tested directly under Node's test
// runner (App.jsx itself contains JSX and cannot be `require`/`import`-ed
// outside a bundler). This is the exact code path that flattens each task
// group's segments (honoring todaySegmentOverrides) and turns a placed
// segment into the timeline block object that ends up on autoSchedule.blocks
// — and therefore on AgentDaySnapshot.timeline and the reminder-plan payload.

export function resolveTaskSegmentPlacement(override = {}, task = {}) {
  if (override.deleted || override.placement === "deleted") return "deleted";
  if (["pool", "timeline", "history"].includes(override.placement)) return override.placement;
  if (override.unscheduled) return "pool";
  // Earlier drafts only persisted a manual start for a task already dragged onto the timeline.
  return Number.isFinite(Number(override.manualStart ?? task.manualStart)) ? "timeline" : "pool";
}

export function comparePlannerSegments(a, b) {
  if (a.locked !== b.locked) return a.locked ? -1 : 1;
  if (Number.isFinite(Number(a.manualStart)) !== Number.isFinite(Number(b.manualStart))) {
    return Number.isFinite(Number(a.manualStart)) ? -1 : 1;
  }
  return a.priority - b.priority || a.manualOrder - b.manualOrder || a.segmentIndex - b.segmentIndex || b.duration - a.duration;
}

export function buildPlannerSegmentTitle(task, duration, index) {
  const rhythm = Number(task.breakMinutes || 0) > 0 ? `${duration}+${task.breakMinutes}` : `${duration}`;
  const suffix = task.segments.length > 1 ? ` ${index + 1}/${task.segments.length}` : "";
  return `${task.title} ${rhythm}${suffix}`;
}

export function resolveTaskPoolOrder(tasks = [], savedOrder = []) {
  const ids = tasks.map((task) => task.id);
  return [...(savedOrder || []).filter((id) => ids.includes(id)), ...ids.filter((id) => !savedOrder?.includes(id))];
}

/**
 * Flattens each task group's segments into individually placeable units.
 * segmentOverride (todaySegmentOverrides[blockId]) always wins over the
 * task/group-level default, which wins over inherit/null — this is the one
 * place snowdustReminder/deskVerification priority is decided, so every
 * downstream consumer (the block builder below, the timeline, the reminder
 * plan) sees the already-resolved value.
 */
export function flattenPlannerTasks(taskGroups = [], taskPoolOrder = []) {
  const orderMap = Object.fromEntries(resolveTaskPoolOrder(taskGroups, taskPoolOrder).map((id, index) => [id, index]));
  return taskGroups
    .flatMap((task) => task.segments.map((duration, index) => {
      const blockId = `${task.id}-${index + 1}`;
      const segmentOverride = task.segmentOverrides?.[blockId] || {};
      const placement = resolveTaskSegmentPlacement(segmentOverride, task);
      if (placement === "deleted") return null;
      const workMinutes = Number(segmentOverride.workMinutes ?? duration ?? 0);
      const restMinutes = Number(segmentOverride.restMinutes ?? task.breakMinutes ?? 0);
      if (workMinutes + restMinutes <= 0) return null;
      const preferredPeriods = segmentOverride.preferredPeriods || task.preferredPeriods;
      const categoryId = segmentOverride.categoryId ?? task.categoryId;
      const category = segmentOverride.category ?? task.category;
      const categoryStatGroup = segmentOverride.categoryStatGroup ?? task.categoryStatGroup;
      return {
        ...task,
        categoryId,
        category,
        categoryStatGroup,
        title: typeof segmentOverride.title === "string" && segmentOverride.title.trim()
          ? segmentOverride.title.trim()
          : task.title,
        duration: workMinutes,
        segmentIndex: index + 1,
        segmentTotal: task.segments.length,
        breakAfter: restMinutes,
        priority: Number(segmentOverride.priority || task.priority || 2),
        preferredPeriods,
        snowdustReminder: segmentOverride.snowdustReminder ?? task.snowdustReminder ?? null,
        startVerification: segmentOverride.startVerification ?? segmentOverride.deskVerification ?? task.startVerification ?? task.deskVerification ?? null,
        deskVerification: segmentOverride.deskVerification ?? task.deskVerification ?? null,
        manualStart: segmentOverride.manualStart ?? task.manualStart,
        locked: Boolean(segmentOverride.locked ?? task.locked ?? false),
        placement,
        status: segmentOverride.status || "pending",
        manualOrder: orderMap[task.id] ?? 999,
        occupiedDuration: workMinutes + restMinutes,
        segmentTitle: buildPlannerSegmentTitle({ ...task, title: typeof segmentOverride.title === "string" && segmentOverride.title.trim() ? segmentOverride.title.trim() : task.title, breakMinutes: restMinutes }, workMinutes, index),
        taskGroup: task,
        blockId,
      };
    }).filter(Boolean))
    .sort(comparePlannerSegments);
}

/**
 * Turns one placed segment into the timeline block object that
 * buildAutoSchedulePlan pushes onto `blocks` (and therefore
 * autoSchedule.blocks, AgentDaySnapshot.timeline, and the reminder-plan
 * payload). Must carry every segment field that a downstream consumer reads
 * — snowdustReminder and deskVerification in particular, since dropping them
 * here silently discards a card-level reminder/desk-verification override
 * while leaving the stage-default reminder logic (which doesn't depend on
 * these fields) looking unaffected.
 */
export function buildScheduledTaskBlockFromSegment(segment, placement) {
  return {
    id: segment.blockId,
    title: segment.segmentTitle,
    start: placement.start,
    end: placement.start + segment.occupiedDuration,
    kind: "task",
    category: segment.category,
    categoryId: segment.categoryId,
    note: segment.note,
    taskId: segment.id,
    taskGroup: segment.taskGroup,
    studyMinutes: segment.duration,
    breakMinutes: segment.breakAfter,
    segmentIndex: segment.segmentIndex,
    segmentTotal: segment.segmentTotal,
    priority: segment.priority,
    preferredPeriods: segment.preferredPeriods,
    categoryStatGroup: segment.categoryStatGroup,
    systemRole: segment.systemRole || null,
    locked: Boolean(segment.locked),
    isFixedItinerary: Boolean(segment.locked),
    status: segment.status,
    snowdustReminder: segment.snowdustReminder ?? null,
    startVerification: segment.startVerification ?? null,
    deskVerification: segment.deskVerification ?? null,
    taskGroupReminderConfig: {
      snowdustReminder: segment.taskGroup?.snowdustReminder ?? null,
      startVerification: segment.taskGroup?.startVerification ?? segment.taskGroup?.deskVerification ?? null,
    },
  };
}
