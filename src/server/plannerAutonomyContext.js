import { buildScheduledTaskBlockFromSegment } from "../utils/plannerTimelineBlocks.js";
import { resolveMovableSegments } from "../schedule/plannerPatchApply.js";
import { isLivePlanBlock } from "../schedule/timelineRescheduleGate.js";
import {
  resolveMorningPrepMinutes,
  resolvePlannerTimelineBounds,
  resolveSystemCardIntervals,
} from "../schedule/plannerLiveTimeline.js";

function mergeIntervals(intervals = []) {
  return intervals
    .filter((item) => Number.isFinite(item?.start) && Number.isFinite(item?.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start)
    .reduce((rows, item) => {
      const last = rows[rows.length - 1];
      if (!last || item.start > last.end) rows.push({ start: item.start, end: item.end });
      else last.end = Math.max(last.end, item.end);
      return rows;
    }, []);
}

function subtractOccupied(start, end, occupied = []) {
  const result = [];
  let cursor = start;
  for (const item of mergeIntervals(occupied)) {
    if (item.end <= cursor || item.start >= end) continue;
    const clippedStart = Math.max(start, item.start);
    const clippedEnd = Math.min(end, item.end);
    if (clippedStart > cursor) result.push({ start: cursor, end: clippedStart });
    cursor = Math.max(cursor, clippedEnd);
  }
  if (cursor < end) result.push({ start: cursor, end });
  return result;
}

function compactTask(task = {}) {
  return {
    title: task.title || "",
    categoryId: task.categoryId || null,
    categoryLevel2Id: task.categoryLevel2Id || null,
    categoryName: task.categoryName || task.category || null,
    categoryStatGroup: task.categoryStatGroup || null,
    segments: Array.isArray(task.segments) ? task.segments.map(Number).filter((value) => Number.isFinite(value) && value > 0) : [],
    breakMinutes: Math.max(0, Number(task.breakMinutes || 0)),
    priority: Number(task.priority || 2),
    preferredPeriods: Array.isArray(task.preferredPeriods) ? task.preferredPeriods.slice(0, 4) : [],
  };
}

function compactTimelineTemplate(segment = {}) {
  return {
    title: segment.title || "",
    categoryId: segment.categoryId || null,
    categoryLevel2Id: segment.categoryLevel2Id || null,
    categoryName: segment.categoryName || segment.category || null,
    categoryStatGroup: segment.categoryStatGroup || null,
    startMinute: Number.isFinite(Number(segment.startMinute)) ? Number(segment.startMinute) : null,
    workMinutes: Math.max(0, Number(segment.workMinutes || 0)),
    restMinutes: Math.max(0, Number(segment.restMinutes || 0)),
    priority: Number(segment.priority || 2),
  };
}

function compactTemplates(settings = {}) {
  const rows = Array.isArray(settings.dayTemplates) ? settings.dayTemplates : [];
  const defaultId = settings.defaultDayTemplateId || rows.find((item) => item?.isDefault)?.id || null;
  return rows.slice(0, 12).map((item) => {
    const content = item?.content && typeof item.content === "object" ? item.content : item || {};
    const defaultTasks = Array.isArray(content.defaultTaskGroups) ? content.defaultTaskGroups.slice(0, 16).map(compactTask) : [];
    const timeline = Array.isArray(content.timelineSegments) ? content.timelineSegments.slice(0, 20).map(compactTimelineTemplate) : [];
    return {
      id: item.id || null,
      name: item.name || item.systemKey || "未命名模板",
      description: item.description || "",
      systemKey: item.systemKey || null,
      isDefault: Boolean(item.id && item.id === defaultId) || item.isDefault === true,
      defaultTaskCount: Array.isArray(content.defaultTaskGroups) ? content.defaultTaskGroups.length : 0,
      timelineTaskCount: Array.isArray(content.timelineSegments) ? content.timelineSegments.length : 0,
      wakeUpTime: content.wakeUpTime || null,
      targetBedTime: content.targetBedTime || null,
      scene: content.scene || null,
      lunchStartTime: content.lunchStartTime || null,
      lunchBlockMinutes: Number.isFinite(Number(content.lunchBlockMinutes)) ? Number(content.lunchBlockMinutes) : null,
      startupBufferMinutes: Number.isFinite(Number(content.startupBufferMinutes)) ? Number(content.startupBufferMinutes) : null,
      exerciseMinutes: Number.isFinite(Number(content.exerciseMinutes)) ? Number(content.exerciseMinutes) : null,
      showerMinutes: Number.isFinite(Number(content.showerMinutes)) ? Number(content.showerMinutes) : null,
      defaultTasks,
      timeline,
    };
  });
}

function normalizeCustomRules(settings = {}) {
  const source = settings.snowdustPlannerRules;
  if (Array.isArray(source)) return source.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30);
  if (typeof source === "string") return source.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
  return [];
}

export function buildPlannerRules({ draft = {}, settings = {} } = {}) {
  const rules = [
    { id: "keep-meals", source: "system", text: "保留午餐和晚餐，不用学习任务覆盖吃饭。" },
    { id: "nap-buffer", source: "system", text: `午餐后保留午休/下午启动缓冲；当前午间总块约 ${Number(draft.lunchBlockMinutes || 0) + Number(draft.startupBufferMinutes || 0)} 分钟。` },
    { id: "exercise-shower", source: "system", text: `如果安排运动，运动后必须留出洗澡；当前洗澡预留 ${Math.max(0, Number(draft.showerMinutes || 0))} 分钟。` },
    { id: "bed-boundary", source: "system", text: `不要把普通任务排到目标上床时间 ${draft.targetBedTime || "23:20"} 之后。` },
  ];
  normalizeCustomRules(settings).forEach((text, index) => rules.push({ id: `custom-${index + 1}`, source: "user", text }));
  return rules;
}

/**
 * Server-side rich fallback for Snow-dust. It deliberately does not run the
 * browser auto-placement algorithm; it reconstructs the already-persisted
 * placements, pool and hard life-card occupancy so Snow can reason and make
 * explicit proposals even when the planner page is closed. Saved templates
 * are included compactly so Snow can use one as a starting layout instead of
 * rebuilding every card from scratch.
 */
export function buildPersistedPlannerFallback({ draft = {}, settings = {}, books = [], readingSessions = [] } = {}) {
  const segments = resolveMovableSegments(draft, settings, { books, readingSessions });
  const timelineBlocks = segments
    .filter((segment) => segment.placement === "timeline" && Number.isFinite(Number(segment.manualStart)))
    .map((segment) => buildScheduledTaskBlockFromSegment(segment, { start: Number(segment.manualStart) }))
    .filter(isLivePlanBlock);
  const poolSegments = segments.filter((segment) => segment.placement === "pool" && isLivePlanBlock({ status: segment.status }));

  const { timelineStart, timelineEnd } = resolvePlannerTimelineBounds(draft);
  const hasCustomMorningAnchor = timelineBlocks.some((block) => block.systemRole === "day-start-anchor");
  const systemCards = resolveSystemCardIntervals({
    draft,
    timelineStart,
    timelineEnd,
    effectiveMorningPrepMinutes: resolveMorningPrepMinutes(draft),
    hasCustomMorningAnchor,
  });
  const occupied = [...systemCards, ...timelineBlocks].map((item) => ({ start: item.start, end: item.end }));
  const freeIntervals = subtractOccupied(timelineStart, timelineEnd, occupied);
  const freeMinutes = freeIntervals.reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0);

  return {
    plan: {
      wakeUpTime: draft.wakeUpTime || null,
      blocks: timelineBlocks,
      poolSegments,
      freeIntervals,
      segmentFree: {},
      metrics: { freeMinutes },
      loadStatus: poolSegments.length ? "has_pool_tasks" : "persisted_plan",
      warnings: [],
      conflicts: [],
    },
    systemCards: systemCards.map((item) => ({ id: item.id, title: item.title, start: item.start, end: item.end, categoryId: item.categoryId })),
    templates: compactTemplates(settings),
    rules: buildPlannerRules({ draft, settings }),
  };
}
