// Pure, JSX-free planner segment/block helpers extracted out of App.jsx so
// they can be imported and integration-tested directly under Node's test
// runner (App.jsx itself contains JSX and cannot be `require`/`import`-ed
// outside a bundler). This is the exact code path that flattens each task
// group's segments (honoring todaySegmentOverrides) and turns a placed
// segment into the timeline block object that ends up on autoSchedule.blocks
// — and therefore on AgentDaySnapshot.timeline and the reminder-plan payload.
import { hasExplicitFiniteMinute } from "./nullableMinutes.js";

export function resolveTaskSegmentPlacement(override = {}, task = {}) {
  if (override.deleted || override.placement === "deleted") return "deleted";
  if (["pool", "timeline", "history"].includes(override.placement)) return override.placement;
  if (override.unscheduled) return "pool";
  if (["pool", "timeline", "history"].includes(task.placement)) return task.placement;
  const manualStart = "manualStart" in override ? override.manualStart : task.manualStart;
  if (hasExplicitFiniteMinute(manualStart)) return "timeline";
  return "pool";
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
      const preferredPeriodsSource = segmentOverride.preferredPeriods || task.preferredPeriods;
      const preferredPeriods = Array.isArray(preferredPeriodsSource) ? preferredPeriodsSource : [];
      const categoryId = segmentOverride.categoryId ?? task.categoryId;
      const categoryLevel2Id = segmentOverride.categoryLevel2Id ?? task.categoryLevel2Id;
      const category = segmentOverride.category ?? task.category;
      const categoryName = segmentOverride.categoryName ?? task.categoryName;
      const categoryColor = segmentOverride.categoryColor ?? task.categoryColor;
      const categoryPrimaryId = segmentOverride.categoryPrimaryId ?? task.categoryPrimaryId;
      const categoryPrimaryName = segmentOverride.categoryPrimaryName ?? task.categoryPrimaryName;
      const categoryStatGroup = segmentOverride.categoryStatGroup ?? task.categoryStatGroup;
      const lastTimelineStartRaw = segmentOverride.lastTimelineStart ?? task.lastTimelineStart;
      const lastTimelineStart = Number.isFinite(Number(lastTimelineStartRaw)) ? Number(lastTimelineStartRaw) : null;
      return {
        ...task,
        categoryId,
        categoryLevel2Id,
        category,
        categoryName,
        categoryColor,
        categoryPrimaryId,
        categoryPrimaryName,
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
        lastTimelineStart,
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

export function buildScheduledTaskBlockFromSegment(segment, placement) {
  return {
    id: segment.blockId,
    title: segment.segmentTitle,
    start: placement.start,
    end: placement.start + segment.occupiedDuration,
    kind: "task",
    category: segment.category,
    categoryId: segment.categoryId,
    categoryLevel2Id: segment.categoryLevel2Id,
    categoryName: segment.categoryName,
    categoryColor: segment.categoryColor,
    categoryPrimaryId: segment.categoryPrimaryId,
    categoryPrimaryName: segment.categoryPrimaryName,
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
    lastTimelineStart: segment.lastTimelineStart ?? null,
    snowdustReminder: segment.snowdustReminder ?? null,
    startVerification: segment.startVerification ?? null,
    deskVerification: segment.deskVerification ?? null,
    taskGroupReminderConfig: {
      snowdustReminder: segment.taskGroup?.snowdustReminder ?? null,
      startVerification: segment.taskGroup?.startVerification ?? segment.taskGroup?.deskVerification ?? null,
    },
  };
}