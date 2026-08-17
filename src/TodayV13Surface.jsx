import React, { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "./todayV13Surface.css";

const PX_PER_MINUTE = 0.7;

function clock(minutes) {
  const value = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(value / 60) % 24;
  const mins = Math.round(value % 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function duration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes || 0)));
  if (value < 60) return `${value}min`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins ? `${hours}h${mins}` : `${hours}h`;
}

function dateLabel(dateValue) {
  if (!dateValue) return "今天";
  const date = new Date(`${dateValue}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const month = parts.find((item) => item.type === "month")?.value || "";
  const day = parts.find((item) => item.type === "day")?.value || "";
  const weekday = parts.find((item) => item.type === "weekday")?.value || "";
  return `${month}月${day}日 · ${weekday}`;
}

function rhythm(block) {
  if (!block) return "";
  const work = Math.max(0, Number(block.studyMinutes ?? block.workMinutes ?? block.activeMinutes ?? (block.end - block.start)) || 0);
  const rest = Math.max(0, Number(block.breakMinutes ?? block.restMinutes ?? 0) || 0);
  const index = Math.max(1, Number(block.segmentIndex || 1));
  const total = Math.max(index, Number(block.segmentTotal || 1));
  const priority = Math.max(1, Number(block.priority || 2));
  return `${work}${rest ? `+${rest}` : ""} · ${index}/${total} · P${priority}`;
}

function timelineTicks(start, end) {
  const ticks = [];
  let value = Math.ceil(start / 30) * 30;
  while (value <= end) {
    ticks.push(value);
    value += 30;
  }
  return ticks;
}

function timelineGaps(blocks, start, end) {
  const sorted = [...blocks].filter((block) => block.end > start && block.start < end).sort((a, b) => a.start - b.start);
  const result = [];
  let cursor = start;
  for (const block of sorted) {
    const blockStart = Math.max(start, block.start);
    if (blockStart - cursor >= 30) result.push({ start: cursor, end: blockStart });
    cursor = Math.max(cursor, Math.min(end, block.end));
  }
  if (end - cursor >= 30) result.push({ start: cursor, end });
  return result;
}

function V13TimelineBlock({ block, timelineStart, allBlocks, onEditBlock, onToggleComplete, onToggleLock, onResizeTask }) {
  const locked = Boolean(block.locked);
  const completed = block.status === "completed";
  const superseded = block.status === "cancelled" || block.status === "rescheduled";
  const draggable = !block.isMorningRoutine && !superseded && !completed && !locked && (block.kind === "task" || block.kind === "fixed");
  const canInsert = block.kind === "task" && !superseded && !completed && !locked;
  const [resizePreview, setResizePreview] = useState(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `timeline-${block.id}`,
    disabled: !draggable,
    data: {
      source: block.kind === "fixed" ? "fixed" : "timeline",
      blockId: block.id,
      title: block.title,
      category: block.category,
      categoryId: block.categoryId,
      duration: block.end - block.start,
      grabOffsetY: 0,
    },
  });
  const { setNodeRef: setInsertNodeRef, isOver } = useDroppable({ id: `insert-${block.id}`, disabled: !canInsert });
  const setCombinedRef = (node) => {
    setNodeRef(node);
    setInsertNodeRef(node);
  };
  const displayedWork = resizePreview?.workMinutes ?? Number(block.studyMinutes ?? block.activeMinutes ?? (block.end - block.start));
  const displayedRest = resizePreview?.restMinutes ?? Number(block.breakMinutes || 0);
  const displayedEnd = resizePreview ? block.start + displayedWork + displayedRest : block.end;
  const height = Math.max(18, (displayedEnd - block.start) * PX_PER_MINUTE - 3);

  function beginResize(event) {
    if (block.kind !== "task" || locked || completed || superseded || block.isMorningRoutine) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const originalWork = Math.max(5, Number(block.studyMinutes ?? block.activeMinutes ?? (block.end - block.start)) || 5);
    const restMinutes = Math.max(0, Number(block.breakMinutes || 0));
    let candidate = originalWork;
    const handleMove = (moveEvent) => {
      const next = Math.max(5, Math.round((originalWork + (moveEvent.clientY - startY) / PX_PER_MINUTE) / 5) * 5);
      const nextEnd = block.start + next + restMinutes;
      const blocker = allBlocks.find((item) => item.id !== block.id && item.start < nextEnd && item.end > block.start);
      if (!blocker) candidate = next;
      setResizePreview({ workMinutes: blocker ? candidate : next, restMinutes, blocker });
    };
    const finish = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointercancel", cancel);
      if (candidate !== originalWork) onResizeTask?.(block.id, candidate);
      setResizePreview(null);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", handleMove);
      setResizePreview(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  }

  return (
    <div
      ref={setCombinedRef}
      className={`sdv13-time-block ${block.kind || "task"} ${locked ? "locked" : ""} ${completed ? "completed" : ""} ${superseded ? "superseded" : ""} ${isDragging ? "dragging" : ""} ${isOver ? "insert-target" : ""}`}
      style={{
        top: `${(block.start - timelineStart) * PX_PER_MINUTE}px`,
        height: `${height}px`,
        transform: CSS.Transform.toString(transform),
        "--block-accent": block.color || "#8d7a99",
      }}
      role="button"
      tabIndex={0}
      onClick={() => !superseded && onEditBlock?.(block)}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !superseded) onEditBlock?.(block);
      }}
    >
      <div className="sdv13-time-block-row">
        {draggable && (
          <button
            className="sdv13-drag-grip"
            type="button"
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
            aria-label={`拖动 ${block.title}`}
          >
            ⠿
          </button>
        )}
        <div className="sdv13-time-block-copy">
          {(block.end - block.start) >= 30 && <small>{clock(block.start)}–{clock(displayedEnd)}</small>}
          <strong>{block.title}</strong>
          {(block.end - block.start) >= 48 && <span>{rhythm(block)}</span>}
        </div>
        <div className="sdv13-time-block-actions">
          {block.canComplete && (
            <button
              type="button"
              className={`sdv13-complete ${completed ? "checked" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleComplete?.(block);
              }}
              aria-label={completed ? "恢复未完成" : "标记完成"}
            >
              {completed ? "✓" : ""}
            </button>
          )}
          {!superseded && (
            <button
              type="button"
              className="sdv13-lock"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleLock?.(block);
              }}
              aria-label={locked ? "解锁" : "锁定"}
            >
              {locked ? "▣" : "▢"}
            </button>
          )}
        </div>
      </div>
      {block.kind === "task" && !locked && !completed && !superseded && !block.isMorningRoutine && (
        <button className="sdv13-resize-handle" type="button" onPointerDown={beginResize} onClick={(event) => event.stopPropagation()} aria-label="调整时长"><i /></button>
      )}
      {resizePreview?.blocker && <span className="sdv13-resize-conflict">碰到硬边界</span>}
    </div>
  );
}

function V13FocusBlock({ session, timelineStart, timelineEnd }) {
  const start = Math.max(timelineStart, Number(session.start));
  const end = Math.min(timelineEnd, Number(session.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (
    <div
      className="sdv13-focus-block"
      style={{
        top: `${(start - timelineStart) * PX_PER_MINUTE}px`,
        height: `${Math.max(4, (end - start) * PX_PER_MINUTE)}px`,
        "--focus-accent": session.color || "#6f8f86",
      }}
      title={`${clock(session.start)}–${clock(session.end)} ${session.title || "Focus"}`}
    >
      {(end - start) >= 28 && <span>{session.title || "专注"}</span>}
    </div>
  );
}

function V13Timeline({ plan, blocks, focusSessions, focusEnabled, planMode, nowMinute, dropPreview, poolOpen, timelineRef, onEditBlock, onToggleComplete, onToggleLock, onResizeTask }) {
  const totalHeight = Math.max(240, (plan.timelineEnd - plan.timelineStart) * PX_PER_MINUTE);
  const ticks = useMemo(() => timelineTicks(plan.timelineStart, plan.timelineEnd), [plan.timelineStart, plan.timelineEnd]);
  const gaps = useMemo(() => timelineGaps(blocks, plan.timelineStart, plan.timelineEnd), [blocks, plan.timelineStart, plan.timelineEnd]);
  const { setNodeRef, isOver } = useDroppable({ id: "timeline" });
  const setTimelineRef = (node) => {
    setNodeRef(node);
    if (timelineRef) timelineRef.current = node;
  };
  const showPlan = planMode !== "focus";
  const showFocus = focusEnabled && planMode !== "plan";
  const previewClass = dropPreview?.type === "swap" ? "swap" : dropPreview?.type === "hard-conflict" || dropPreview?.conflict ? "conflict" : "valid";

  return (
    <div className={`sdv13-timeline-canvas ${isOver ? "drag-over" : ""}`} ref={setTimelineRef} style={{ height: `${totalHeight}px` }}>
      {ticks.map((tick) => <div className="sdv13-tick" key={tick} style={{ top: `${(tick - plan.timelineStart) * PX_PER_MINUTE}px` }}><span>{clock(tick)}</span><i /></div>)}
      {poolOpen && gaps.map((gap) => <div className="sdv13-gap-hint" key={`${gap.start}-${gap.end}`} style={{ top: `${(gap.start - plan.timelineStart) * PX_PER_MINUTE}px`, height: `${(gap.end - gap.start) * PX_PER_MINUTE}px` }}><span>{gap.end - gap.start}min 空档</span></div>)}
      {Number.isFinite(nowMinute) && nowMinute >= plan.timelineStart && nowMinute <= plan.timelineEnd && <div className="sdv13-now-line" style={{ top: `${(nowMinute - plan.timelineStart) * PX_PER_MINUTE}px` }}><i /><span>{clock(nowMinute)}</span></div>}
      {showFocus && focusSessions.map((session, index) => <V13FocusBlock session={session} timelineStart={plan.timelineStart} timelineEnd={plan.timelineEnd} key={`${session.start}-${session.end}-${index}`} />)}
      {showPlan && blocks.map((block) => <V13TimelineBlock block={block} allBlocks={blocks} timelineStart={plan.timelineStart} onEditBlock={onEditBlock} onToggleComplete={onToggleComplete} onToggleLock={onToggleLock} onResizeTask={onResizeTask} key={block.id} />)}
      {Number.isFinite(dropPreview?.start) && Number.isFinite(dropPreview?.end) && dropPreview.end > dropPreview.start && (
        <div className={`sdv13-drop-preview ${previewClass}`} style={{ top: `${(dropPreview.start - plan.timelineStart) * PX_PER_MINUTE}px`, height: `${Math.max(18, (dropPreview.end - dropPreview.start) * PX_PER_MINUTE - 2)}px` }}>
          <strong>{previewClass === "swap" ? "⇄ 交换" : previewClass === "conflict" ? "× 硬边界" : dropPreview.type === "ripple" ? "→ 插入并顺延" : "放这里"}</strong>
          <span>{dropPreview.title || "任务"}</span>
        </div>
      )}
    </div>
  );
}

function V13PoolTask({ task, onEditTask, onDeleteTask, onArrange }) {
  const nextSegment = task.poolSegments?.[0];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-sort-${task.id}`,
    data: {
      source: "task-pool",
      taskId: task.id,
      blockId: nextSegment?.blockId,
      title: task.title,
      category: task.category,
      categoryId: task.categoryId,
      duration: nextSegment?.occupiedDuration || nextSegment?.duration || task.primaryDuration || 50,
      workMinutes: nextSegment?.duration || task.primaryDuration || 50,
      restMinutes: nextSegment?.breakAfter || 0,
    },
  });
  return (
    <div ref={setNodeRef} className={`sdv13-pool-task ${isDragging ? "dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition, "--block-accent": task.color || "#8d7a99" }}>
      <button className="sdv13-pool-grip" type="button" {...attributes} {...listeners} aria-label={`拖动 ${task.title}`}>⠿</button>
      <button className="sdv13-pool-task-copy" type="button" onClick={() => onEditTask?.(task)}>
        <strong>{task.title}</strong>
        <span>{task.rhythmText || `${nextSegment?.duration || task.primaryDuration || 50}${nextSegment?.breakAfter ? `+${nextSegment.breakAfter}` : ""}`} · P{task.priority || 2}</span>
      </button>
      <button className="sdv13-pool-more" type="button" onClick={(event) => { event.stopPropagation(); onDeleteTask?.(task); }} aria-label="删除任务">⋮</button>
      <button className="sdv13-pool-arrange" type="button" onClick={(event) => { event.stopPropagation(); onArrange?.(nextSegment?.blockId); }}>安排</button>
    </div>
  );
}

function V13TaskPool({ tasks, poolOrder, onCreateTask, onClearPool, onEditTask, onDeleteTask, onArrange }) {
  const { setNodeRef, isOver } = useDroppable({ id: "task-pool" });
  const categories = useMemo(() => {
    const grouped = [];
    for (const task of tasks) {
      const key = task.categoryId || task.category || "other";
      let group = grouped.find((item) => item.id === key);
      if (!group) {
        group = { id: key, label: task.categoryLabel || task.category || "其他", tasks: [] };
        grouped.push(group);
      }
      group.tasks.push(task);
    }
    return grouped;
  }, [tasks]);
  return (
    <div className={`sdv13-pool-body ${isOver ? "drag-over" : ""}`} ref={setNodeRef}>
      <button className="sdv13-pool-add" type="button" onClick={onCreateTask}>＋ 新增当天任务块</button>
      <SortableContext items={poolOrder.map((id) => `task-sort-${id}`)} strategy={verticalListSortingStrategy}>
        <div className="sdv13-pool-list">
          {categories.map((group) => <React.Fragment key={group.id}>
            <div className="sdv13-pool-category"><span>{group.label}</span><b>{group.tasks.reduce((sum, task) => sum + (task.poolSegments?.length || 0), 0)} 段</b></div>
            {group.tasks.map((task) => <V13PoolTask task={task} key={task.id} onEditTask={onEditTask} onDeleteTask={onDeleteTask} onArrange={onArrange} />)}
          </React.Fragment>)}
        </div>
      </SortableContext>
      {!tasks.length && <p className="sdv13-empty">任务池空啦。</p>}
      <button className="sdv13-pool-clear" type="button" disabled={!tasks.length} onClick={onClearPool}>清空任务池</button>
    </div>
  );
}

export default function TodayV13Surface({
  targetDate,
  saveLabel = "已保存",
  hasUnsavedChanges = false,
  nowMinute = 0,
  currentBlock,
  nextBlock,
  completedCount = 0,
  remainingCount = 0,
  scheduledMinutes = 0,
  totalBlocks = 0,
  plan,
  blocks = [],
  focusSessions = [],
  focusEnabled = false,
  focusStatusNote = "",
  dropPreview,
  timelineRef,
  poolOpen = false,
  poolTasks = [],
  poolOrder = [],
  poolCount = 0,
  onTogglePool,
  onMore,
  onOverview,
  onInbox,
  onTrackers,
  onTemplates,
  onCurrent,
  onFocusCurrent,
  onToday,
  onFocusNav,
  onChatNav,
  onCreateTask,
  onClearPool,
  onEditTask,
  onDeleteTask,
  onArrangePoolTask,
  onEditBlock,
  onToggleComplete,
  onToggleLock,
  onResizeTask,
  goals = [],
  inboxItems = [],
  onInboxItem,
}) {
  const [planMode, setPlanMode] = useState("plan");
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const progress = totalBlocks ? Math.max(0, Math.min(100, Math.round((completedCount / totalBlocks) * 100))) : 0;
  const activeInbox = (inboxItems || []).slice(0, 3);
  const goalRows = (goals || []).filter((item) => Number(item.targetMinutes || item.scheduledMinutes || 0) > 0).slice(0, 4);
  const goalTarget = goalRows.reduce((sum, item) => sum + Number(item.targetMinutes || 0), 0);
  const goalScheduled = goalRows.reduce((sum, item) => sum + Number(item.scheduledMinutes || 0), 0);
  const modeLabel = planMode === "focus" ? "仅专注" : planMode === "plan-focus" ? "计划+专注" : "计划";

  return (
    <div className={`today-v13-surface ${poolOpen ? "arrange" : ""}`}>
      <aside className="sdv13-pool-drawer" aria-hidden={!poolOpen}>
        <div className="sdv13-pool-head"><b>任务池 · {poolCount}</b><button className="sdv13-pool-close" type="button" onClick={onTogglePool} aria-label="收起任务池">×</button></div>
        <p className="sdv13-pool-sub">拖的是下一块。空白处精确放；压到卡片上可插入、互换或替换。</p>
        <V13TaskPool tasks={poolTasks} poolOrder={poolOrder} onCreateTask={onCreateTask} onClearPool={onClearPool} onEditTask={onEditTask} onDeleteTask={onDeleteTask} onArrange={onArrangePoolTask} />
        <p className="sdv13-pool-note">5 分钟吸附 · 同长互换 · 插入顺延 · 硬边界防撞</p>
      </aside>

      <main className="sdv13-app">
        <header className="sdv13-topbar">
          <button className="sdv13-date-button" type="button" onClick={onToday}><h1>今天</h1><span>{dateLabel(targetDate)}⌄</span></button>
          <div className="sdv13-top-actions">
            <span className={`sdv13-save-dot ${hasUnsavedChanges ? "pending" : ""}`}><i />{hasUnsavedChanges ? "未保存" : saveLabel}</span>
            <button className="sdv13-pool-trigger" type="button" onClick={onTogglePool}>任务池 <b>{poolCount}</b></button>
            <button className="sdv13-round" type="button" onClick={onMore} aria-label="更多">•••</button>
          </div>
        </header>

        <div className="sdv13-content">
          <section className="sdv13-now-card">
            <div className="sdv13-now-kicker"><i /><span>现在 · {clock(nowMinute)}</span></div>
            <div className="sdv13-now-main">
              <button className="sdv13-now-copy" type="button" onClick={onCurrent}>
                <h2>{currentBlock?.title || "当前没有进行中的任务"}</h2>
                <div className="sdv13-now-meta">{currentBlock ? <><span>{clock(currentBlock.start)}–{clock(currentBlock.end)}</span><span>·</span><span className="rhythm">{rhythm(currentBlock)}</span></> : <span>查看时间线安排下一项</span>}</div>
              </button>
              <button className="sdv13-focus-btn" type="button" onClick={onFocusCurrent}>开始专注</button>
            </div>
            <button className="sdv13-next-line" type="button" onClick={onCurrent}><span>接下来</span><strong>{nextBlock?.title || "今天后面暂时没有下一项"}</strong>{nextBlock && <time>{clock(nextBlock.start)}</time>}</button>
          </section>

          <div className="sdv13-summary-row">
            <button className="sdv13-tiny-link" type="button" onClick={onOverview}><strong>已完成 {completedCount}</strong> · 还剩 {remainingCount} 项</button>
            <div className="sdv13-summary-progress"><i style={{ width: `${progress}%` }} /></div>
            <button className="sdv13-tiny-link" type="button" onClick={onInbox}>一起记 · {inboxItems.length}</button>
          </div>

          <aside className="sdv13-landscape-panel">
            <section className="sdv13-landscape-card">
              <div className="sdv13-landscape-card-head"><b>今日目标</b><button type="button" onClick={onOverview}>统计</button></div>
              <div className="sdv13-landscape-goal-total"><strong>{duration(goalTarget || scheduledMinutes)}</strong><span>已排 {duration(goalScheduled || scheduledMinutes)}</span></div>
              <div className="sdv13-landscape-goals">{goalRows.length ? goalRows.map((item) => {
                const target = Math.max(0, Number(item.targetMinutes || 0));
                const scheduled = Math.max(0, Number(item.scheduledMinutes || 0));
                const ratio = target ? Math.min(100, Math.round(scheduled / target * 100)) : 0;
                return <button className="sdv13-goal-row" type="button" onClick={onOverview} key={item.categoryId || item.categoryLabel}><span className="sdv13-goal-row-top"><b>{item.categoryLabel || item.label || "目标"}</b><small>{duration(scheduled)} / {duration(target)}</small></span><span className="sdv13-goal-bar"><i style={{ width: `${ratio}%`, background: item.color || "#8d7a99" }} /></span></button>;
              }) : <p className="sdv13-empty">今天还没有设置分类目标</p>}</div>
            </section>
            <section className="sdv13-landscape-card">
              <div className="sdv13-landscape-card-head"><b>今天一起记</b><button type="button" onClick={onInbox}>全部</button></div>
              <div className="sdv13-landscape-inbox-list">{activeInbox.length ? activeInbox.map((item) => <button className="sdv13-landscape-inbox-row" type="button" key={item.id} onClick={() => onInboxItem?.(item)}><span className="mark">{item.kind === "note" ? "•" : "○"}</span><span><strong>{item.title}</strong><small>{item.kind === "note" ? "记事" : `待办${item.estimatedMinutes ? ` · ${item.estimatedMinutes}min` : ""}`}{item.source === "snowdust" ? " · 雪尘记的" : ""}</small></span><span className="state">›</span></button>) : <p className="sdv13-empty">今天还没有一起记的内容</p>}</div>
            </section>
          </aside>

          <section className="sdv13-timeline-zone">
            <div className="sdv13-timeline-head">
              <h3>时间线</h3>
              {poolOpen && <span className="sdv13-edit-mode-chip">排程中 · 5min吸附</span>}
              <div className="sdv13-timeline-tools">
                <button className="sdv13-tracker-mini" type="button" onClick={onTrackers}><i /><span>追踪</span></button>
                <button className="sdv13-template-mini" type="button" onClick={onTemplates}><span>模板</span><b>⌄</b></button>
                <div className="sdv13-plan-menu-wrap">
                  <button className="sdv13-template-mini" type="button" onClick={() => setPlanMenuOpen((value) => !value)}><span>{modeLabel}</span><b>⌄</b></button>
                  {planMenuOpen && <div className="sdv13-plan-menu"><button className={planMode === "plan" ? "active" : ""} type="button" onClick={() => { setPlanMode("plan"); setPlanMenuOpen(false); }}>计划</button>{focusEnabled && <button className={planMode === "plan-focus" ? "active" : ""} type="button" onClick={() => { setPlanMode("plan-focus"); setPlanMenuOpen(false); }}>计划 + 专注</button>}{focusEnabled && <button className={planMode === "focus" ? "active" : ""} type="button" onClick={() => { setPlanMode("focus"); setPlanMenuOpen(false); }}>仅专注</button>}</div>}
                </div>
              </div>
            </div>
            {focusStatusNote && planMode !== "plan" && <div className="sdv13-focus-note">{focusStatusNote}</div>}
            <div className="sdv13-timeline-window"><V13Timeline plan={plan} blocks={blocks} focusSessions={focusSessions} focusEnabled={focusEnabled} planMode={planMode} nowMinute={nowMinute} dropPreview={dropPreview} poolOpen={poolOpen} timelineRef={timelineRef} onEditBlock={onEditBlock} onToggleComplete={onToggleComplete} onToggleLock={onToggleLock} onResizeTask={onResizeTask} /></div>
          </section>
        </div>
      </main>

      <nav className="sdv13-bottomnav" aria-label="SnowDustApp 常用入口"><button className="active" type="button" onClick={onToday}><b>⌁</b><span>今天</span></button><button type="button" onClick={onFocusNav}><b>◉</b><span>专注</span></button><button type="button" onClick={onChatNav}><b>◌</b><span>雪尘</span></button></nav>
    </div>
  );
}
