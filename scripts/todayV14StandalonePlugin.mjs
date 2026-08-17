const IMPORT_LINE = 'import TodayV14Frame from "./TodayV14Frame.jsx";\n';
const NATIVE_AUTH_IMPORT = 'import { createNativePlannerAuthHandoff, isNativePlannerAuthContext, NativePlannerAuthState } from "./auth/nativePlannerAuthHandoff.js";\n';
const AUTH_IMPORT_MARKER = 'import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";';
const FIREBASE_IMPORT_MARKER = 'import { auth, googleProvider, isFirebaseConfigured } from "./services/firebase";';
const ACTIVE_TAB_MARKER = '  const [activeTab, setActiveTab] = useState("dashboard");';
const LOADING_STATE_MARKER = '  const [loading, setLoading] = useState(isFirebaseConfigured);';
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

function liveReturn(dialogTail) {
  return `  if (${TODAY_PATH_EXPR}) {
    const todayV14Blocks = (autoSchedule.blocks || [])
      .filter((block) => !isSupersededBlockStatus(block.status))
      .map((block) => {
        const duration = Math.max(1, Number(block.end || 0) - Number(block.start || 0));
        const rest = Math.max(0, Number(block.breakMinutes || 0));
        const category = plannerCategoryForCatalog(block, plannerCategoryCatalog);
        return {
          id: block.id,
          groupId: block.taskGroup?.id || block.taskId || block.groupId || block.id,
          title: block.title,
          categoryId: plannerCategoryId(block),
          category: category.name,
          kind: block.kind || (block.taskGroup ? "task" : "fixed"),
          start: Number(block.start),
          end: Number(block.end),
          work: Math.max(1, Number(block.workMinutes ?? (duration - rest))),
          rest,
          priority: Number(block.priority ?? block.taskGroup?.priority ?? 2),
          index: Number(block.segmentIndex ?? block.index ?? 1),
          total: Number(block.taskGroup?.segments?.length ?? block.total ?? 1),
          status: block.status || "pending",
          locked: Boolean(block.locked),
          protected: Boolean(block.protected),
          type: block.type || "",
          canComplete: shouldShowTimelineCompletionToggle(block),
          rhythm: \`${'${Math.max(1, Number(block.workMinutes ?? (duration - rest))) }'}${'${rest ? `+${rest}` : ""}'}\`,
        };
      });
    const currentBlock = todayV14Blocks.find((block) => block.start <= currentBeijingMinute && block.end > currentBeijingMinute && block.status !== "completed") || null;
    const nextBlock = todayV14Blocks.filter((block) => block.start > currentBeijingMinute && block.status !== "completed").sort((a, b) => a.start - b.start)[0] || null;
    const completedBlocks = todayV14Blocks.filter((block) => block.status === "completed");
    const completedMinutes = completedBlocks.reduce((sum, block) => sum + Math.max(0, block.end - block.start), 0);
    const remainingCount = todayV14Blocks.filter((block) => block.status !== "completed" && block.end > currentBeijingMinute).length;
    const poolTaskById = new Map((autoSchedule.taskGroups || []).map((task) => [task.id, task]));
    const poolSegments = (autoSchedule.poolSegments || []).map((segment, index) => {
      const task = poolTaskById.get(segment.id) || {};
      return {
        id: segment.blockId || segment.segmentId || \`${'${segment.id || "pool"}'}-${'${index + 1}'}\`,
        groupId: segment.id || task.id || \`pool-group-${'${index + 1}'}\`,
        title: segment.segmentTitle || task.title || "待安排任务",
        categoryId: segment.categoryId || plannerCategoryId(task),
        category: segment.category || task.category || "",
        work: Number(segment.duration ?? task.segments?.[0] ?? 50),
        rest: Number(segment.breakAfter ?? task.breakMinutes ?? 0),
        priority: Number(segment.priority ?? task.priority ?? 2),
        status: segment.status || "pending",
        lastTimelineStart: todayV14ReturnStartsRef.current.get(segment.blockId) ?? null,
      };
    });
    const baseline = (activeBaselineSnapshot?.blocks || []).filter((block) => block.kind === "task" && block.status !== "cancelled").map((block) => ({
      id: block.id, start: Number(block.start), end: Number(block.end), categoryId: plannerCategoryId(block), category: block.category,
    }));
    const focusSessions = (focusDisplaySessions || []).map((session) => ({
      start: Number(session.start), end: Number(session.end), title: session.title || "专注", note: session.note || (Number.isFinite(Number(session.end - session.start)) ? \`${'${Math.round(session.end - session.start)}'}min\` : ""),
    }));
    const goalItems = studyTargetProgress.map((item) => {
      const target = Number(item.targetMinutes ?? item.effectiveTargetMinutes ?? item.goalMinutes ?? 0);
      const scheduled = Number(item.scheduledMinutes || 0);
      return {
        categoryId: item.categoryId,
        categoryLabel: item.categoryLabel || item.label || "学习",
        label: item.categoryLabel || item.label || "学习",
        valueLabel: target > 0 ? \`${'${formatDuration(scheduled)}'} / ${'${formatDuration(target)}'}\` : formatDuration(scheduled),
        percent: target > 0 ? Math.round((scheduled / target) * 100) : 0,
      };
    });
    const goalTargetMinutes = studyTargetProgress.reduce((sum, item) => sum + Number(item.targetMinutes ?? item.effectiveTargetMinutes ?? item.goalMinutes ?? 0), 0);
    const goalScheduledMinutes = studyTargetProgress.reduce((sum, item) => sum + Number(item.scheduledMinutes || 0), 0);
    const liveInboxItems = (inboxItems || []).filter((item) => item.status !== "scheduled").map((item) => ({
      ...item,
      kind: item.kind || (item.estimatedMinutes ? "task" : "note"),
      minutes: item.estimatedMinutes || null,
      done: item.status === "archived",
      source: item.source || "user",
    }));
    const liveState = {
      targetDate: draft.targetDate,
      saveLabel: saveState.includes("失败") ? "保存失败" : hasUnsavedChanges ? "未保存" : "已保存",
      hasUnsavedChanges,
      nowMinute: currentBeijingMinute,
      timelineStart: autoSchedule.timelineStart,
      timelineEnd: autoSchedule.timelineEnd,
      currentBlock,
      nextBlock,
      completedLabel: formatDuration(completedMinutes),
      remainingCount,
      timelineBlocks: todayV14Blocks,
      poolSegments,
      baseline,
      focusSessions,
      inboxItems: liveInboxItems,
      goals: goalItems,
      goalTotal: {
        targetLabel: formatDuration(goalTargetMinutes),
        subLabel: \`已排 ${'${formatDuration(goalScheduledMinutes)}'} · 已完成 ${'${formatDuration(completedMinutes)}'}\`,
      },
      followup: null,
    };
    const openFocus = (source = "current") => {
      const event = new CustomEvent("snowdust:open-focus", { cancelable: true, detail: { source, blockId: currentBlock?.id || null, targetDate: draft.targetDate } });
      window.dispatchEvent(event);
    };
    const liveActive = (blockId, source) => {
      const segment = (autoSchedule.taskSegments || []).find((item) => item.blockId === blockId);
      const block = (autoSchedule.blocks || []).find((item) => item.id === blockId);
      return {
        source: source === "pool" ? "task-pool" : "timeline",
        blockId,
        taskId: segment?.id,
        duration: Number(segment?.occupiedDuration ?? (block ? block.end - block.start : 50)),
        workMinutes: Number(segment?.duration ?? block?.workMinutes ?? 50),
        restMinutes: Number(segment?.breakAfter ?? block?.breakMinutes ?? 0),
        title: segment?.segmentTitle || block?.title || "任务",
        category: segment?.category || block?.category,
        categoryId: segment?.categoryId || block?.categoryId,
      };
    };
    const commitLiveDrop = ({ source = "timeline", blockId, start, intent, targetBlockId }) => {
      if (!blockId || !Number.isFinite(Number(start))) return;
      const active = liveActive(blockId, source);
      let result = null;
      if (intent === "swap" && targetBlockId) {
        result = source === "pool" ? planPoolTaskSwap(autoSchedule, blockId, targetBlockId) : planTaskSwap(autoSchedule, blockId, targetBlockId);
      } else {
        result = planTaskMove(autoSchedule, blockId, Number(start), undefined, true, true);
      }
      if (!result || result.type === "noop") return;
      if (["hard-conflict", "needs-compression"].includes(result.type)) {
        setDragConflict({
          active,
          nearestGap: findNearestPlannerGap(autoSchedule, active, Number(start), Number(active.workMinutes || 0)),
          preview: {
            start: Number(start),
            end: Number(start) + Number(active.duration || 0),
            title: active.title,
            category: active.category,
            conflict: true,
            conflictBlock: result.boundary,
            availableMinutes: result.availableMinutes,
            gapEnd: result.gapEnd,
            requestedWork: result.requestedWork,
            requestedRest: result.requestedRest,
            period: periodKeyForPlannerMinute(Number(start)),
          },
        });
        return;
      }
      commitTimelinePositions(result.positions, {
        returnedToPool: result.returnedToPool || [],
        label: result.type === "success-ripple" ? \`已插入并顺延后续 ${'${result.shifted?.length || 0}'} 项任务\` : result.returnedToPool?.length ? "已交换任务，原任务回到任务池" : \`已移动至 ${'${formatClockMinutes(result.positions?.[0]?.start ?? Number(start))}'}\`,
      });
    };
    const handleLiveAction = (action, payload = {}) => {
      if (action === "focus") { openFocus("today-v14"); return; }
      if (action === "chat") { window.location.assign("/xuechen/"); return; }
      if (action === "more" || action === "date") { setPlannerAdvancedOpen(true); return; }
      if (action === "overview") { setCategoryTargetManagerOpen(true); return; }
      if (action === "trackers") { setTrackerOverviewTrackerId(null); setTrackerManagerOpen(true); return; }
      if (action === "templates") { setTemplateManagerOpen(true); return; }
      if (action === "categoryOrder") { setCategoryOrderManagerOpen(true); return; }
      if (action === "createTask") { setCreateTaskOpen(true); return; }
      if (action === "createInbox") { setInboxItemDrawer("create"); return; }
      if (action === "editInbox") { const item = inboxItems.find((entry) => entry.id === payload.id); if (item) setInboxItemDrawer(item); return; }
      if (action === "toggleInbox") {
        const item = inboxItems.find((entry) => entry.id === payload.id); if (!item) return;
        const nextStatus = item.status === "archived" ? "active" : "archived";
        onSaveProfile({ plannerInbox: updateInboxItem(inboxItems, item.id, { status: nextStatus }) });
        setSaveState(nextStatus === "archived" ? "已完成一起记待办" : "已恢复一起记待办");
        return;
      }
      if (action === "scheduleInbox") { const item = inboxItems.find((entry) => entry.id === payload.id); if (item) scheduleInboxItemToToday(item); return; }
      if (action === "editPoolTask") {
        const task = (autoSchedule.taskGroups || []).find((entry) => entry.id === payload.groupId);
        if (task) setEditingTask({ scope: "group", task });
        return;
      }
      if (action === "editBlock") {
        const block = (autoSchedule.blocks || []).find((entry) => entry.id === payload.blockId); if (!block) return;
        if (isMorningRoutineCard(block)) setEditingMorningRoutine(block);
        else if (block.taskGroup) setEditingTask({ scope: "segment", task: block.taskGroup, block, segmentOverride: { ...(draft.todaySegmentOverrides?.[block.id] || {}) } });
        else setEditingFixedEvent(block);
        return;
      }
      if (action === "toggleComplete") { const block = (autoSchedule.blocks || []).find((entry) => entry.id === payload.blockId); if (block) toggleSegmentCompletion(block); return; }
      if (action === "toggleLock") { const block = (autoSchedule.blocks || []).find((entry) => entry.id === payload.blockId); if (block) toggleSegmentLock(block); return; }
      if (action === "resize") { applyResizePlan(payload.blockId, payload.workMinutes); return; }
      if (action === "returnToPool") {
        const block = (autoSchedule.blocks || []).find((entry) => entry.id === payload.blockId);
        if (block && Number.isFinite(Number(block.start))) todayV14ReturnStartsRef.current.set(payload.blockId, Number(block.start));
        moveSegmentToPool(payload.blockId); return;
      }
      if (action === "restoreToTimeline") {
        const start = Number.isFinite(Number(payload.start)) ? Number(payload.start) : todayV14ReturnStartsRef.current.get(payload.blockId);
        if (!Number.isFinite(Number(start))) { openTaskMoveSheet(payload.blockId, "pool"); return; }
        const result = planTaskMove(autoSchedule, payload.blockId, Number(start), undefined, true, true);
        if (result && !["hard-conflict", "needs-compression", "noop"].includes(result.type)) {
          commitTimelinePositions(result.positions, { returnedToPool: result.returnedToPool || [], label: \`已放回 ${'${formatClockMinutes(Number(start))}'}\` });
          todayV14ReturnStartsRef.current.delete(payload.blockId);
        } else {
          openTaskMoveSheet(payload.blockId, "pool");
        }
        return;
      }
      if (action === "drop") { commitLiveDrop(payload); return; }
    };
    return (
      <>
        <TodayV14Frame state={liveState} onAction={handleLiveAction} />
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

export function todayV14StandalonePlugin() {
  return {
    name: "snowdust-today-v14-live",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/").split("?")[0];
      if (!normalized.endsWith("/src/App.jsx")) return null;
      if (!code.includes("function ScheduleAssistant(")) return null;
      let next = code;
      if (!next.includes(IMPORT_LINE.trim())) next = IMPORT_LINE + NATIVE_AUTH_IMPORT + next;
      if (!next.includes(AUTH_IMPORT_MARKER)) throw new Error("Today v14: Firebase auth import marker not found");
      next = next.replace(AUTH_IMPORT_MARKER, 'import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut } from "firebase/auth";');
      if (!next.includes(FIREBASE_IMPORT_MARKER)) throw new Error("Today v14: Firebase service import marker not found");
      next = next.replace(FIREBASE_IMPORT_MARKER, 'import { auth, firebaseAuthReady, googleProvider, isFirebaseConfigured } from "./services/firebase";');
      if (!next.includes(ACTIVE_TAB_MARKER)) throw new Error("Today v14: activeTab marker not found");
      next = next.replace(ACTIVE_TAB_MARKER, `  const [activeTab, setActiveTab] = useState(() => ${TODAY_PATH_EXPR} ? "schedule" : "dashboard");`);
      if (!next.includes(LOADING_STATE_MARKER)) throw new Error("Today v14: loading state marker not found");
      next = next.replace(LOADING_STATE_MARKER, `${LOADING_STATE_MARKER}\n  const [authResolved, setAuthResolved] = useState(!isFirebaseConfigured);\n  const [nativeLoginState, setNativeLoginState] = useState(NativePlannerAuthState.IDLE);\n  const nativePlannerAuthRef = useRef(null);\n  const todayV14ReturnStartsRef = useRef(new Map());`);
      if (!next.includes(AUTH_EFFECT_MARKER)) throw new Error("Today v14: auth effect marker not found");
      next = next.replace(AUTH_EFFECT_MARKER, authReplacement());
      if (!next.includes(LOADING_GATE_MARKER)) throw new Error("Today v14: loading gate marker not found");
      next = next.replace(LOADING_GATE_MARKER, `  if (${TODAY_PATH_EXPR} && (loading || (user && !data))) {\n    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#100f14", color: "#8f8888", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif' }}><span style={{width:6,height:6,borderRadius:"50%",background:"#8f7ca0"}} /></main>;\n  }\n\n  if (isFirebaseConfigured && !user && isNativePlannerAuthContext()) {\n    const failed = nativeLoginState === NativePlannerAuthState.FAILED;\n    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#100f14", color: "#c8b8cf", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif' }}><section style={{ textAlign: "center", padding: 24 }}><strong style={{ display: "block", fontSize: 18, marginBottom: 8 }}>{failed ? "登录没有完成" : "正在连接 SnowDustApp"}</strong><span style={{ display: "block", color: "#777177", fontSize: 12 }}>{failed ? "可以重新唤起系统账号选择。" : "请在系统账号选择器里确认 Google 账号。"}</span>{failed && <button type="button" onClick={() => nativePlannerAuthRef.current?.requestLogin()} style={{ marginTop: 14, minHeight: 34, padding: "0 14px", border: "1px solid rgba(255,255,255,.09)", borderRadius: 10, background: "#211e25", color: "#d3c7d7" }}>重试登录</button>}</section></main>;\n  }\n\n${LOADING_GATE_MARKER}`);
      const returnIndex = next.indexOf(RETURN_MARKER);
      if (returnIndex < 0) throw new Error("Today v14: original ScheduleAssistant return marker not found");
      const dialogIndex = next.indexOf(DIALOG_MARKER, returnIndex);
      if (dialogIndex < 0) throw new Error("Today v14: planner dialog marker not found");
      const endIndex = next.indexOf(END_MARKER, dialogIndex);
      if (endIndex < 0) throw new Error("Today v14: ScheduleAssistant end marker not found");
      const dialogTail = next.slice(dialogIndex, endIndex);
      next = next.slice(0, returnIndex) + liveReturn(dialogTail) + next.slice(returnIndex);
      return { code: next, map: null };
    },
  };
}
