const IMPORT_LINE = 'import TodayV13Surface from "./TodayV13Surface.jsx";\n';
const NATIVE_AUTH_IMPORT = 'import { createNativePlannerAuthHandoff, isNativePlannerAuthContext, NativePlannerAuthState } from "./auth/nativePlannerAuthHandoff.js";\n';
const AUTH_IMPORT_MARKER = 'import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";';
const FIREBASE_IMPORT_MARKER = 'import { auth, googleProvider, isFirebaseConfigured } from "./services/firebase";';
const PX_MARKER = 'const PLANNER_PX_PER_MINUTE = 1.5;';
const ACTIVE_TAB_MARKER = '  const [activeTab, setActiveTab] = useState("dashboard");';
const LOADING_STATE_MARKER = '  const [loading, setLoading] = useState(isFirebaseConfigured);';
const POOL_STATE_MARKER = '  const [dropPreview, setDropPreview] = useState(null);';
const LOADING_GATE_MARKER = '  if (loading || (user && !data)) {';
const RETURN_MARKER = '  return (\n    <section className="schedule-layout">';
const DIALOG_MARKER = '      {plannerAdvancedOpen &&';
const END_MARKER = '\n    </section>\n  );\n}\n\nfunction InfoLine';
const AUTH_EFFECT_MARKER = `  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setLoading(true);
        await ensureUserSeed(currentUser.uid, currentUser);
      } else {
        setData(null);
        setLoading(false);
      }
    });
  }, []);`;

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
        const workMinutes = Number(nextSegment?.duration ?? task.segments?.[0] ?? 50);
        const restMinutes = Number(nextSegment?.breakAfter || task.breakMinutes || 0);
        return {
          ...task,
          poolSegments,
          categoryLabel: category.name,
          color: categoryColors[plannerCategoryId(task)] || category.foreground,
          primaryDuration: workMinutes,
          rhythmText: restMinutes ? \`${'${workMinutes}'}+${'${restMinutes}'}\` : String(workMinutes),
        };
      });
    const todayV13FocusSessions = (focusDisplaySessions || []).map((session) => {
      const category = resolvePlannerCategoryForHierarchicalId(session.categoryId);
      return { ...session, color: categoryColors[category.id] || category.foreground };
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

function authReplacement() {
  return `  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};
    firebaseAuthReady
      .catch((error) => console.warn("Firebase auth persistence unavailable", error))
      .finally(() => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          setUser(currentUser);
          setAuthResolved(true);
          if (currentUser) {
            setLoading(true);
            await ensureUserSeed(currentUser.uid, currentUser);
          } else {
            setData(null);
            setLoading(false);
          }
        });
      });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !isNativePlannerAuthContext()) return undefined;
    const handoff = createNativePlannerAuthHandoff({
      onStateChange: setNativeLoginState,
      onCredential: async (googleIdToken) => {
        await firebaseAuthReady;
        const credential = GoogleAuthProvider.credential(googleIdToken);
        await signInWithCredential(auth, credential);
      },
    });
    handoff.start();
    nativePlannerAuthRef.current = handoff;
    return () => {
      handoff.stop();
      if (nativePlannerAuthRef.current === handoff) nativePlannerAuthRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!authResolved || user || !isNativePlannerAuthContext()) return;
    nativePlannerAuthRef.current?.requestLogin();
  }, [authResolved, user]);`;
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
      if (!next.includes(IMPORT_LINE.trim())) next = IMPORT_LINE + NATIVE_AUTH_IMPORT + next;

      if (!next.includes(AUTH_IMPORT_MARKER)) throw new Error("Today v13 standalone: Firebase auth import marker not found");
      next = next.replace(AUTH_IMPORT_MARKER, 'import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut } from "firebase/auth";');
      if (!next.includes(FIREBASE_IMPORT_MARKER)) throw new Error("Today v13 standalone: Firebase service import marker not found");
      next = next.replace(FIREBASE_IMPORT_MARKER, 'import { auth, firebaseAuthReady, googleProvider, isFirebaseConfigured } from "./services/firebase";');

      if (!next.includes(PX_MARKER)) throw new Error("Today v13 standalone: planner px marker not found");
      next = next.replace(PX_MARKER, `const PLANNER_PX_PER_MINUTE = ${TODAY_PATH_EXPR} ? 0.7 : 1.5;`);

      if (!next.includes(ACTIVE_TAB_MARKER)) throw new Error("Today v13 standalone: activeTab marker not found");
      next = next.replace(ACTIVE_TAB_MARKER, `  const [activeTab, setActiveTab] = useState(() => ${TODAY_PATH_EXPR} ? "schedule" : "dashboard");`);
      if (!next.includes(LOADING_STATE_MARKER)) throw new Error("Today v13 standalone: loading state marker not found");
      next = next.replace(LOADING_STATE_MARKER, `${LOADING_STATE_MARKER}\n  const [authResolved, setAuthResolved] = useState(!isFirebaseConfigured);\n  const [nativeLoginState, setNativeLoginState] = useState(NativePlannerAuthState.IDLE);\n  const nativePlannerAuthRef = useRef(null);`);

      if (!next.includes(AUTH_EFFECT_MARKER)) throw new Error("Today v13 standalone: auth effect marker not found");
      next = next.replace(AUTH_EFFECT_MARKER, authReplacement());

      if (!next.includes(LOADING_GATE_MARKER)) throw new Error("Today v13 standalone: loading gate marker not found");
      next = next.replace(LOADING_GATE_MARKER, `  if (${TODAY_PATH_EXPR} && (loading || (user && !data))) {\n    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#100f14", color: "#8f8888", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif' }}><span>正在打开今日排程…</span></main>;\n  }\n\n  if (isFirebaseConfigured && !user && isNativePlannerAuthContext()) {\n    const failed = nativeLoginState === NativePlannerAuthState.FAILED;\n    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#100f14", color: "#c8b8cf", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif' }}><section style={{ textAlign: "center", padding: 24 }}><strong style={{ display: "block", fontSize: 18, marginBottom: 8 }}>{failed ? "登录没有完成" : "正在连接 SnowDustApp"}</strong><span style={{ display: "block", color: "#777177", fontSize: 12 }}>{failed ? "可以重新唤起系统账号选择。" : "请在系统账号选择器里确认 Google 账号。"}</span>{failed && <button type="button" onClick={() => nativePlannerAuthRef.current?.requestLogin()} style={{ marginTop: 14, minHeight: 34, padding: "0 14px", border: "1px solid rgba(255,255,255,.09)", borderRadius: 10, background: "#211e25", color: "#d3c7d7" }}>重试登录</button>}</section></main>;\n  }\n\n${LOADING_GATE_MARKER}`);

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
