const IMPORT_LINE = 'import TodayV13Surface from "./TodayV13Surface.jsx";\n';
const PX_MARKER = 'const PLANNER_PX_PER_MINUTE = 1.5;';
const ACTIVE_TAB_MARKER = '  const [activeTab, setActiveTab] = useState("dashboard");';
const POOL_STATE_MARKER = '  const [dropPreview, setDropPreview] = useState(null);';
const RETURN_MARKER = '  return (\n    <section className="schedule-layout">';
const DIALOG_MARKER = '      {plannerAdvancedOpen &&';
const END_MARKER = '\n    </section>\n  );\n}\n\nfunction InfoLine';

const TODAY_PATH_EXPR = '(typeof window !== "undefined" && (String(window.location.pathname || "/").replace(/\\/+$/, "") || "/") === "/today")';

function standaloneReturn(dialogTail) {
  return `  if (${TODAY_PATH_EXPR}) {
    const todayV13ActiveBlocks = (autoSchedule.blocks || [])
      .filter((block) => !isSupersededBlockStatus(block.status))
      .map((block) => {
        const category = plannerCategoryForCatalog(block, plannerCategoryCatalog);
        return {
          ...block,
          color: categoryColors[plannerCategoryId(block)] || category.foreground,
          canComplete: shouldShowTimelineCompletionToggle(block),
          isMorningRoutine: isMorningRoutineCard(block),
          priority: Number(block.priority ?? block.taskGroup?.priority ?? 2),
        };
      });
    const todayV13CurrentBlock = todayV13ActiveBlocks.find((block) => block.start <= currentBeijingMinute && block.end > currentBeijingMinute && block.status !== "completed") || null;
    const todayV13NextBlock = todayV13ActiveBlocks.filter((block) => block.start > currentBeijingMinute && block.status !== "completed").sort((a, b) => a.start - b.start)[0] || null;
    const todayV13CompletedCount = todayV13ActiveBlocks.filter((block) => block.status === "completed").length;
    const todayV13RemainingCount = todayV13ActiveBlocks.filter((block) => block.status !== "completed" && block.end > currentBeijingMinute).length;
    const todayV13InboxItems = selectActiveInboxItems(inboxItems);
    const todayV13ScheduledMinutes = studyTargetProgress.reduce((sum, item) => sum + Number(item.scheduledMinutes || 0), 0);
    const todayV13Goals = studyTargetProgress.map((item) => {
      const category = plannerCategoryForCatalog({ categoryId: item.categoryId, category: item.categoryLabel }, plannerCategoryCatalog);
      return { ...item, color: categoryColors[item.categoryId] || category.foreground };
    });
    const todayV13PoolSegmentsByTask = (autoSchedule.poolSegments || []).reduce((result, segment) => {
      result[segment.id] = [...(result[segment.id] || []), segment];
      return result;
    }, {});
    const todayV13PoolOrder = resolveTaskPoolOrder(autoSchedule.taskGroups, draft.taskPoolOrder);
    const todayV13PoolTasks = todayV13PoolOrder
      .map((taskId) => (autoSchedule.taskGroups || []).find((task) => task.id === taskId))
      .filter((task) => task && todayV13PoolSegmentsByTask[task.id]?.length)
      .map((task) => {
        const category = plannerCategoryForCatalog(task, plannerCategoryCatalog);
        const poolSegments = todayV13PoolSegmentsByTask[task.id] || [];
        const nextSegment = poolSegments[0];
        return {
          ...task,
          poolSegments,
          categoryLabel: category.name,
          color: categoryColors[plannerCategoryId(task)] || category.foreground,
          primaryDuration: Number(nextSegment?.duration ?? task.segments?.[0] ?? 50),
          rhythmText: \`${'${Number(nextSegment?.duration ?? task.segments?.[0] ?? 50)}'}${'${Number(nextSegment?.breakAfter || task.breakMinutes || 0) ? `+${Number(nextSegment?.breakAfter || task.breakMinutes || 0)}` : ""}'}\`,
        };
      });
    const todayV13FocusSessions = (focusDisplaySessions || []).map((session) => {
      const category = resolvePlannerCategoryForHierarchicalId(session.categoryId);
      return {
        ...session,
        color: categoryColors[category.id] || category.foreground,
      };
    });
    const todayV13TimelineRef = {
      get current() { return timelineRef.current; },
      set current(node) { timelineRef.current = node?.parentElement || node; },
    };
    const scrollTodayV13Current = () => {
      const node = timelineRef.current;
      if (!node || !todayV13CurrentBlock) return;
      const top = Math.max(0, (todayV13CurrentBlock.start - autoSchedule.timelineStart) * 0.7 - node.clientHeight * 0.36);
      node.scrollTo({ top, behavior: "smooth" });
    };
    const openTodayV13Focus = (source = "current") => {
      const event = new CustomEvent("snowdust:open-focus", {
        cancelable: true,
        detail: { source, blockId: todayV13CurrentBlock?.id || null, targetDate: draft.targetDate },
      });
      const unhandled = window.dispatchEvent(event);
      if (unhandled) scrollTodayV13Current();
    };
    return (
      <>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          autoScroll={{ threshold: { x: 0.1, y: 0.15 }, acceleration: 12, interval: 5 }}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveDrag(null);
            setDropPreview(null);
            previewPlanRef.current = null;
            dragGrabOffsetRef.current = 0;
            if (dragPointerListenerRef.current) window.removeEventListener("pointermove", dragPointerListenerRef.current);
            dragPointerListenerRef.current = null;
            dragPointerYRef.current = null;
          }}
        >
          <TodayV13Surface
            targetDate={draft.targetDate}
            saveLabel={saveState.includes("失败") ? "保存失败" : "已保存"}
            hasUnsavedChanges={hasUnsavedChanges}
            nowMinute={currentBeijingMinute}
            currentBlock={todayV13CurrentBlock}
            nextBlock={todayV13NextBlock}
            completedCount={todayV13CompletedCount}
            remainingCount={todayV13RemainingCount}
            scheduledMinutes={todayV13ScheduledMinutes}
            totalBlocks={todayV13ActiveBlocks.length}
            plan={autoSchedule}
            blocks={todayV13ActiveBlocks}
            focusSessions={todayV13FocusSessions}
            focusEnabled={plannerFeatureFlags.focusTimelineTrackEnabled}
            focusStatusNote={focusStatusNote}
            dropPreview={dropPreview}
            timelineRef={todayV13TimelineRef}
            poolOpen={todayV13PoolOpen}
            poolTasks={todayV13PoolTasks}
            poolOrder={todayV13PoolOrder}
            poolCount={(autoSchedule.poolSegments || []).length}
            onTogglePool={() => setTodayV13PoolOpen((value) => !value)}
            onMore={() => setPlannerAdvancedOpen(true)}
            onOverview={() => setCategoryTargetManagerOpen(true)}
            onInbox={() => setInboxItemDrawer("create")}
            onTrackers={() => { setTrackerOverviewTrackerId(null); setTrackerManagerOpen(true); }}
            onTemplates={() => setTemplateManagerOpen(true)}
            onCurrent={scrollTodayV13Current}
            onFocusCurrent={() => openTodayV13Focus("current")}
            onToday={() => switchPlannerTargetDate(todayDate)}
            onFocusNav={() => openTodayV13Focus("nav")}
            onChatNav={() => window.location.assign("/xuechen/")}
            onCreateTask={() => setCreateTaskOpen(true)}
            onClearPool={clearTaskPool}
            onEditTask={(task) => setEditingTask({ scope: "group", task })}
            onDeleteTask={(task) => { if (window.confirm(\`删除“${'${task.title}'}”？\\n\\n只会从当前日期的任务池移除，不会删除模板或历史记录。\`)) deleteTodayTask(task.id); }}
            onArrangePoolTask={(blockId) => openTaskMoveSheet(blockId, "pool")}
            onEditBlock={(block) => {
              if (isMorningRoutineCard(block)) setEditingMorningRoutine(block);
              else if (block.taskGroup) setEditingTask({ scope: "segment", task: block.taskGroup, block, segmentOverride: { ...(draft.todaySegmentOverrides?.[block.id] || {}) } });
              else setEditingFixedEvent(block);
            }}
            onToggleComplete={toggleSegmentCompletion}
            onToggleLock={toggleSegmentLock}
            onResizeTask={applyResizePlan}
            goals={todayV13Goals}
            inboxItems={todayV13InboxItems}
            onInboxItem={(item) => setInboxItemDrawer(item)}
          />
          <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
            {activeDrag ? <TaskDragPreview item={activeDrag} /> : null}
          </DragOverlay>
        </DndContext>
${dialogTail}
      </>
    );
  }

`;
}

export function todayV13StandalonePlugin() {
  return {
    name: "snowdust-today-v13-standalone",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/").split("?")[0];
      if (!normalized.endsWith("/src/App.jsx")) return null;
      if (!code.includes("function ScheduleAssistant(")) return null;

      let next = code;
      if (!next.includes(IMPORT_LINE.trim())) next = IMPORT_LINE + next;

      if (!next.includes(PX_MARKER)) throw new Error("Today v13 standalone: planner px marker not found");
      next = next.replace(PX_MARKER, `const PLANNER_PX_PER_MINUTE = ${TODAY_PATH_EXPR} ? 0.7 : 1.5;`);

      if (!next.includes(ACTIVE_TAB_MARKER)) throw new Error("Today v13 standalone: activeTab marker not found");
      next = next.replace(ACTIVE_TAB_MARKER, `  const [activeTab, setActiveTab] = useState(() => ${TODAY_PATH_EXPR} ? "schedule" : "dashboard");`);

      if (!next.includes(POOL_STATE_MARKER)) throw new Error("Today v13 standalone: pool state marker not found");
      next = next.replace(POOL_STATE_MARKER, `${POOL_STATE_MARKER}\n  const [todayV13PoolOpen, setTodayV13PoolOpen] = useState(false);`);

      const returnIndex = next.indexOf(RETURN_MARKER);
      if (returnIndex < 0) throw new Error("Today v13 standalone: original ScheduleAssistant return marker not found");
      const dialogIndex = next.indexOf(DIALOG_MARKER, returnIndex);
      if (dialogIndex < 0) throw new Error("Today v13 standalone: planner dialog marker not found");
      const endIndex = next.indexOf(END_MARKER, dialogIndex);
      if (endIndex < 0) throw new Error("Today v13 standalone: ScheduleAssistant end marker not found");

      const dialogTail = next.slice(dialogIndex, endIndex);
      next = next.slice(0, returnIndex) + standaloneReturn(dialogTail) + next.slice(returnIndex);
      return { code: next, map: null };
    },
  };
}
