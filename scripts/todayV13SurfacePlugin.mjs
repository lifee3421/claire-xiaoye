const IMPORT_LINE = 'import TodayV13Surface from "./TodayV13Surface.jsx";\n';
const RETURN_MARKER = '  return (\n    <section className="schedule-layout v13-today-layout">';
const DIALOG_MARKER = '      {quickTemplateOpen && <TodayTemplateSheet';
const END_MARKER = '\n    </section>\n  );\n}\n\nfunction InfoLine';

function standaloneReturn(dialogTail) {
  return `  if (typeof window !== "undefined" && (String(window.location.pathname || "/").replace(/\\/+$/, "") || "/") === "/today") {
    const todayV13InboxItems = selectActiveInboxItems(inboxItems);
    const todayV13ScheduledMinutes = studyTargetProgress.reduce((sum, item) => sum + Number(item.scheduledMinutes || 0), 0);
    const openTodayV13Focus = (source = "current") => {
      const event = new CustomEvent("snowdust:open-focus", {
        cancelable: true,
        detail: {
          source,
          blockId: currentTimelineBlock?.id || null,
          targetDate: draft.targetDate,
        },
      });
      const unhandled = window.dispatchEvent(event);
      if (unhandled) scrollCurrentTimelineBlock();
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
            saveLabel={saveState}
            hasUnsavedChanges={hasUnsavedChanges}
            nowMinute={currentBeijingMinute}
            currentBlock={currentTimelineBlock}
            nextBlock={nextTimelineBlock}
            completedCount={completedTimelineCount}
            remainingCount={remainingTimelineCount}
            scheduledMinutes={todayV13ScheduledMinutes}
            totalBlocks={activeTimelineBlocks.length}
            poolOpen={poolOpen}
            poolCount={autoSchedule.poolSegments.length}
            onTogglePool={() => setPoolOpen((value) => !value)}
            onMore={() => setMoreOpen(true)}
            onOverview={() => setOverviewOpen(true)}
            onInbox={() => setInboxSheetOpen(true)}
            onTrackers={() => setTrackerManagerOpen(true)}
            onTemplates={() => setQuickTemplateOpen(true)}
            onCurrent={scrollCurrentTimelineBlock}
            onFocusCurrent={() => openTodayV13Focus("current")}
            onToday={() => switchPlannerTargetDate(todayDate)}
            onFocusNav={() => openTodayV13Focus("nav")}
            onChatNav={() => window.location.assign("/xuechen/")}
            goals={studyTargetProgress}
            inboxItems={todayV13InboxItems}
            onInboxItem={(item) => setInboxItemDrawer(item)}
            poolNode={
              <TaskPoolPreview
                className="is-open"
                tasks={autoSchedule.taskGroups}
                segments={autoSchedule.poolSegments}
                order={resolveTaskPoolOrder(autoSchedule.taskGroups, draft.taskPoolOrder)}
                categoryOrder={plannerCategoryOrder}
                categoryCatalog={plannerCategoryCatalog}
                categoryColors={categoryColors}
                onEdit={setEditingTask}
                onCreate={() => setCreateTaskOpen(true)}
                onDelete={deleteTodayTask}
                onClear={clearTaskPool}
                onArrange={(blockId) => openTaskMoveSheet(blockId, "pool")}
                onEditCategoryOrder={() => setCategoryOrderManagerOpen(true)}
                inboxItems={[]}
                onInboxCreate={() => setInboxItemDrawer("create")}
                onInboxEdit={(item) => setInboxItemDrawer(item)}
                onInboxArchive={archiveInboxItemById}
                onInboxDelete={deleteInboxItemById}
                onInboxSchedule={scheduleInboxItemToToday}
              />
            }
            timelineNode={
              <TimelinePreview
                plan={autoSchedule}
                dropPreview={dropPreview}
                timelineRef={timelineRef}
                nowMinute={currentBeijingMinute}
                categoryColors={categoryColors}
                onEditTask={(editing) => isMorningRoutineCard(editing.block) ? setEditingMorningRoutine(editing.block) : setEditingTask({ ...editing, segmentOverride: { ...(draft.todaySegmentOverrides?.[editing.block.id] || {}) } })}
                onEditFixed={setEditingFixedEvent}
                onToggleComplete={toggleSegmentCompletion}
                onToggleLock={toggleSegmentLock}
                onReturnToPool={moveSegmentToPool}
                onMoveTask={(blockId) => openTaskMoveSheet(blockId, "timeline")}
                onResizeTask={applyResizePlan}
                baselinePlanTrackEnabled={plannerFeatureFlags.baselinePlanTrackEnabled}
                baselineSnapshot={draft.baselinePlanSnapshot}
                focusTimelineTrackEnabled={plannerFeatureFlags.focusTimelineTrackEnabled}
                focusDisplaySessions={focusDisplaySessions}
                focusDataStatus={focusDataStatus}
                focusStatusNote={focusStatusNote}
              />
            }
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

export function todayV13SurfacePlugin() {
  return {
    name: "snowdust-today-v13-surface",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/").split("?")[0];
      if (!normalized.endsWith("/src/App.jsx")) return null;
      if (!code.includes('function ScheduleAssistant(')) return null;

      let next = code;
      if (!next.includes(IMPORT_LINE.trim())) next = IMPORT_LINE + next;

      const returnIndex = next.indexOf(RETURN_MARKER);
      if (returnIndex < 0) throw new Error("Today v13 adapter: ScheduleAssistant return marker not found");
      const dialogIndex = next.indexOf(DIALOG_MARKER, returnIndex);
      if (dialogIndex < 0) throw new Error("Today v13 adapter: dialog tail marker not found");
      const endIndex = next.indexOf(END_MARKER, dialogIndex);
      if (endIndex < 0) throw new Error("Today v13 adapter: ScheduleAssistant end marker not found");

      const dialogTail = next.slice(dialogIndex, endIndex);
      next = next.slice(0, returnIndex) + standaloneReturn(dialogTail) + next.slice(returnIndex);
      return { code: next, map: null };
    },
  };
}
