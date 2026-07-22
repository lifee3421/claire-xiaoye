import fs from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Missing patch target: ${label}`);
  if (source.indexOf(needle, index + needle.length) >= 0) throw new Error(`Patch target is not unique: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function write(path, content) {
  fs.writeFileSync(path, content, "utf8");
  console.log(`updated ${path}`);
}

let unified = fs.readFileSync("src/utils/unifiedPlannerCards.js", "utf8");
unified = replaceOnce(unified,
`export const LIFE_CATEGORY_IDS = Object.freeze({`,
`export const MORNING_ROUTINE_CARD_ID = "wake-prep";
export const MORNING_ROUTINE_SYSTEM_ROLE = "wake_routine";

export const LIFE_CATEGORY_IDS = Object.freeze({`,
"morning constants");

unified = replaceOnce(unified,
`function minute(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const match = typeof value === "string" ? value.match(/^(\\d{1,2}):(\\d{2})$/) : null;
  if (!match) return null;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? result : null;
}`,
`function minute(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const match = typeof value === "string" ? value.match(/^(\\d{1,2}):(\\d{2})$/) : null;
  if (!match) return null;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? result : null;
}

function clock(value) {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, Number(value) || 0));
  return \`\${String(Math.floor(normalized / 60)).padStart(2, "0")}:\${String(normalized % 60).padStart(2, "0")}\`;
}

export function isMorningRoutineCard(value = {}) {
  return value?.id === MORNING_ROUTINE_CARD_ID
    || value?.taskId === MORNING_ROUTINE_CARD_ID
    || value?.categoryId === LIFE_CATEGORY_IDS.morningRoutine
    || value?.systemRole === MORNING_ROUTINE_SYSTEM_ROLE;
}`,
"morning identity helper");

const oldEnsure = `/** Restores the durable morning routine card for older drafts without adding duplicates. */
export function ensureMorningRoutineCard(draft = {}) {
  const cards = Array.isArray(draft.todayCustomBlocks) ? draft.todayCustomBlocks.filter(Boolean) : [];
  if (cards.some((card) => card.categoryId === LIFE_CATEGORY_IDS.morningRoutine)) return draft;
  const start = minute(draft.wakeUpTime);
  const duration = Number(draft.morningPrepMinutes || 0);
  if (!Number.isFinite(start) || start < 0 || duration <= 0) return draft;
  const usedIds = new Set(cards.map((card) => card.id).filter(Boolean));
  const id = usedIds.has("wake-prep") ? \`morning-routine-\${draft.targetDate || "legacy"}\` : "wake-prep";
  return {
    ...draft,
    todayCustomBlocks: [...cards, {
      id,
      title: "起床｜洗漱 + 到学习地点",
      category: "晨间洗漱",
      categoryId: LIFE_CATEGORY_IDS.morningRoutine,
      categoryStatGroup: "life",
      segments: [duration],
      breakMinutes: 0,
      manualStart: start,
      locked: true,
      status: "pending",
      systemRole: "wake_routine",
      source: "system-life-card",
      note: "从已有起床与晨间准备设置恢复",
    }],
    todaySegmentOverrides: {
      ...(draft.todaySegmentOverrides || {}),
      [\`\${id}-1\`]: {
        placement: "timeline",
        manualStart: start,
        workMinutes: duration,
        locked: true,
        status: "pending",
      },
    },
    morningRoutineMigrationVersion: 1,
    _morningRoutineMigrationPending: true,
  };
}`;

const newEnsure = `/** Keeps exactly one durable morning routine card and removes stale ghost data. */
export function ensureMorningRoutineCard(draft = {}) {
  const cards = Array.isArray(draft.todayCustomBlocks) ? draft.todayCustomBlocks.filter(Boolean) : [];
  const fixedEvents = Array.isArray(draft.fixedEvents) ? draft.fixedEvents.filter(Boolean) : [];
  const overrides = draft.todaySegmentOverrides && typeof draft.todaySegmentOverrides === "object" ? { ...draft.todaySegmentOverrides } : {};
  const fixedOverrides = draft.fixedEventOverrides && typeof draft.fixedEventOverrides === "object" ? { ...draft.fixedEventOverrides } : {};
  const morningCards = cards.filter(isMorningRoutineCard);

  const timingCandidates = morningCards.map((card) => {
    const override = overrides[\`\${card.id}-1\`] || overrides[card.id] || {};
    const start = minute(override.manualStart ?? card.manualStart);
    const duration = Number(override.workMinutes ?? card.segments?.[0] ?? 0);
    return { card, override, start, duration };
  }).filter((item) => Number.isFinite(item.start) && item.duration > 0)
    .sort((left, right) => left.start - right.start);

  const canonicalOverride = overrides[\`\${MORNING_ROUTINE_CARD_ID}-1\`] || overrides[MORNING_ROUTINE_CARD_ID] || {};
  const overrideStart = minute(canonicalOverride.manualStart);
  const overrideDuration = Number(canonicalOverride.workMinutes || 0);
  const chosen = timingCandidates[0];
  const start = Number.isFinite(overrideStart)
    ? overrideStart
    : Number.isFinite(chosen?.start)
      ? chosen.start
      : minute(draft.wakeUpTime) ?? 7 * 60 + 30;
  const duration = overrideDuration > 0
    ? overrideDuration
    : Number(chosen?.duration || 0) > 0
      ? Number(chosen.duration)
      : Math.max(5, Number(draft.morningPrepMinutes || 20));
  const status = canonicalOverride.status || chosen?.override?.status || chosen?.card?.status || "pending";

  const morningIds = new Set([
    MORNING_ROUTINE_CARD_ID,
    \`\${MORNING_ROUTINE_CARD_ID}-1\`,
    ...morningCards.flatMap((card) => [card.id, \`\${card.id}-1\`]).filter(Boolean),
  ]);
  const nextOverrides = Object.fromEntries(Object.entries(overrides).filter(([id]) => !morningIds.has(id)));
  nextOverrides[\`\${MORNING_ROUTINE_CARD_ID}-1\`] = {
    placement: "timeline",
    manualStart: start,
    workMinutes: duration,
    restMinutes: 0,
    locked: true,
    status,
  };
  const nextFixedOverrides = Object.fromEntries(Object.entries(fixedOverrides).filter(([id, value]) => !morningIds.has(id) && !isMorningRoutineCard({ id, ...value })));
  const canonicalCard = {
    ...(chosen?.card || {}),
    id: MORNING_ROUTINE_CARD_ID,
    title: "晨间洗漱",
    category: "晨间洗漱",
    categoryId: LIFE_CATEGORY_IDS.morningRoutine,
    categoryStatGroup: "life",
    segments: [duration],
    breakMinutes: 0,
    manualStart: start,
    locked: true,
    status,
    systemRole: MORNING_ROUTINE_SYSTEM_ROLE,
    persistent: true,
    transient: false,
    source: "system-life-card",
    note: chosen?.card?.note || "一天从这里开始",
  };
  const normalized = {
    ...draft,
    wakeUpTime: clock(start),
    morningPrepMinutes: duration,
    fixedEvents: fixedEvents.filter((card) => !isMorningRoutineCard(card)),
    fixedEventOverrides: nextFixedOverrides,
    todayCustomBlocks: [canonicalCard, ...cards.filter((card) => !isMorningRoutineCard(card))],
    todaySegmentOverrides: nextOverrides,
    deletedTodayTaskIds: (Array.isArray(draft.deletedTodayTaskIds) ? draft.deletedTodayTaskIds : []).filter((id) => !morningIds.has(id)),
    morningRoutineMigrationVersion: 2,
  };
  const relevantBefore = JSON.stringify({
    wakeUpTime: draft.wakeUpTime,
    morningPrepMinutes: draft.morningPrepMinutes,
    fixedEvents: draft.fixedEvents,
    fixedEventOverrides: draft.fixedEventOverrides,
    todayCustomBlocks: draft.todayCustomBlocks,
    todaySegmentOverrides: draft.todaySegmentOverrides,
    deletedTodayTaskIds: draft.deletedTodayTaskIds,
    morningRoutineMigrationVersion: draft.morningRoutineMigrationVersion,
  });
  const relevantAfter = JSON.stringify({
    wakeUpTime: normalized.wakeUpTime,
    morningPrepMinutes: normalized.morningPrepMinutes,
    fixedEvents: normalized.fixedEvents,
    fixedEventOverrides: normalized.fixedEventOverrides,
    todayCustomBlocks: normalized.todayCustomBlocks,
    todaySegmentOverrides: normalized.todaySegmentOverrides,
    deletedTodayTaskIds: normalized.deletedTodayTaskIds,
    morningRoutineMigrationVersion: normalized.morningRoutineMigrationVersion,
  });
  return draft._morningRoutineMigrationPending || relevantBefore !== relevantAfter
    ? { ...normalized, _morningRoutineMigrationPending: true }
    : normalized;
}

export function updateMorningRoutineDraft(draft = {}, { startMinute, durationMinutes } = {}) {
  const normalized = ensureMorningRoutineCard(draft);
  const start = minute(startMinute);
  const duration = Math.max(5, Number(durationMinutes || 0));
  if (!Number.isFinite(start) || duration <= 0) return normalized;
  const currentStatus = normalized.todaySegmentOverrides?.[\`\${MORNING_ROUTINE_CARD_ID}-1\`]?.status || "pending";
  return ensureMorningRoutineCard({
    ...normalized,
    wakeUpTime: clock(start),
    morningPrepMinutes: duration,
    todayCustomBlocks: (normalized.todayCustomBlocks || []).map((card) => isMorningRoutineCard(card) ? {
      ...card,
      id: MORNING_ROUTINE_CARD_ID,
      segments: [duration],
      manualStart: start,
      locked: true,
      status: currentStatus,
    } : card),
    todaySegmentOverrides: {
      ...(normalized.todaySegmentOverrides || {}),
      [\`\${MORNING_ROUTINE_CARD_ID}-1\`]: {
        placement: "timeline",
        manualStart: start,
        workMinutes: duration,
        restMinutes: 0,
        locked: true,
        status: currentStatus,
      },
    },
  });
}

export function buildMorningRoutineRippleOverrides({ blocks = [], startAt, delta, existingOverrides = {} } = {}) {
  const shift = Math.max(0, Number(delta || 0));
  const result = { ...(existingOverrides || {}) };
  if (!shift) return result;
  (Array.isArray(blocks) ? blocks : [])
    .filter((block) => !isMorningRoutineCard(block))
    .filter((block) => block?.kind === "task")
    .filter((block) => block?.taskGroup?.source !== "system-life-card")
    .filter((block) => Number(block.start) >= Number(startAt))
    .forEach((block) => {
      result[block.id] = {
        ...(result[block.id] || {}),
        placement: "timeline",
        manualStart: Number(block.start) + shift,
        locked: Boolean(block.locked),
      };
    });
  return result;
}`;

unified = replaceOnce(unified, oldEnsure, newEnsure, "ensure morning routine");
write("src/utils/unifiedPlannerCards.js", unified);

let tests = fs.readFileSync("src/utils/unifiedPlannerCards.test.js", "utf8");
tests = replaceOnce(tests,
`import { LIFE_CATEGORY_IDS, allocateTasksAcrossDates, categoryCompletionFacts, ensureLifeCategories, ensureMorningRoutineCard, findDayStartAnchor, migrateLegacyFixedEvents, resolvePlannerTimelineStart, unifyPlannerDraftCards } from "./unifiedPlannerCards.js";`,
`import { LIFE_CATEGORY_IDS, MORNING_ROUTINE_CARD_ID, allocateTasksAcrossDates, buildMorningRoutineRippleOverrides, categoryCompletionFacts, ensureLifeCategories, ensureMorningRoutineCard, findDayStartAnchor, migrateLegacyFixedEvents, resolvePlannerTimelineStart, unifyPlannerDraftCards, updateMorningRoutineDraft } from "./unifiedPlannerCards.js";`,
"test imports");
tests += `

test("repairs deleted, pooled, unlocked, and duplicate morning cards into one canonical card", () => {
  const result = ensureMorningRoutineCard({
    targetDate: "2026-07-22",
    wakeUpTime: "07:30",
    morningPrepMinutes: 20,
    fixedEvents: [{ id: "legacy-morning", categoryId: LIFE_CATEGORY_IDS.morningRoutine, startTime: "07:00", endTime: "07:20" }],
    todayCustomBlocks: [
      { id: "morning-a", categoryId: LIFE_CATEGORY_IDS.morningRoutine, segments: [25], manualStart: 480, locked: false },
      { id: "morning-b", categoryId: LIFE_CATEGORY_IDS.morningRoutine, segments: [30], manualStart: 510, locked: true },
      { id: "math", categoryId: "math", segments: [50] },
    ],
    todaySegmentOverrides: {
      "morning-a-1": { placement: "pool", manualStart: 485, workMinutes: 35, locked: false, status: "completed" },
      "morning-b-1": { placement: "deleted", manualStart: 510, workMinutes: 30 },
    },
    deletedTodayTaskIds: ["morning-a", "morning-a-1", "wake-prep"],
  });
  const morningCards = result.todayCustomBlocks.filter((card) => card.categoryId === LIFE_CATEGORY_IDS.morningRoutine);
  assert.equal(morningCards.length, 1);
  assert.equal(morningCards[0].id, MORNING_ROUTINE_CARD_ID);
  assert.equal(morningCards[0].locked, true);
  assert.equal(morningCards[0].persistent, true);
  assert.equal(result.todaySegmentOverrides["wake-prep-1"].placement, "timeline");
  assert.equal(result.todaySegmentOverrides["wake-prep-1"].manualStart, 485);
  assert.equal(result.todaySegmentOverrides["wake-prep-1"].workMinutes, 35);
  assert.equal(result.todaySegmentOverrides["wake-prep-1"].status, "completed");
  assert.equal(result.fixedEvents.length, 0);
  assert.deepEqual(result.deletedTodayTaskIds, []);
});

test("editing the morning routine updates the card, wake time, and duration together", () => {
  const result = updateMorningRoutineDraft({ wakeUpTime: "07:30", morningPrepMinutes: 20 }, { startMinute: 500, durationMinutes: 30 });
  assert.equal(result.wakeUpTime, "08:20");
  assert.equal(result.morningPrepMinutes, 30);
  assert.equal(result.todayCustomBlocks[0].manualStart, 500);
  assert.equal(result.todayCustomBlocks[0].segments[0], 30);
  assert.equal(result.todaySegmentOverrides["wake-prep-1"].manualStart, 500);
  assert.equal(result.todaySegmentOverrides["wake-prep-1"].workMinutes, 30);
});

test("morning conflict ripple shifts only subsequent ordinary timeline cards", () => {
  const result = buildMorningRoutineRippleOverrides({
    startAt: 500,
    delta: 20,
    existingOverrides: {},
    blocks: [
      { id: "wake-prep-1", categoryId: LIFE_CATEGORY_IDS.morningRoutine, kind: "task", start: 480 },
      { id: "math-1", kind: "task", start: 500, locked: false, taskGroup: { source: "template" } },
      { id: "lunch-1", kind: "task", start: 760, locked: true, taskGroup: { source: "system-life-card" } },
      { id: "early", kind: "task", start: 450, locked: false, taskGroup: { source: "template" } },
    ],
  });
  assert.equal(result["math-1"].manualStart, 520);
  assert.equal(result["lunch-1"], undefined);
  assert.equal(result.early, undefined);
});
`;
write("src/utils/unifiedPlannerCards.test.js", tests);

let app = fs.readFileSync("src/App.jsx", "utf8");
app = replaceOnce(app,
`import { LIFE_CATEGORY_IDS, allocateTasksAcrossDates, ensureLifeCategories, ensureMorningRoutineCard, findDayStartAnchor, migrateLegacyFixedEvents, resolvePlannerTimelineStart, unifyPlannerDraftCards } from "./utils/unifiedPlannerCards";`,
`import { LIFE_CATEGORY_IDS, MORNING_ROUTINE_CARD_ID, allocateTasksAcrossDates, buildMorningRoutineRippleOverrides, ensureLifeCategories, ensureMorningRoutineCard, findDayStartAnchor, isMorningRoutineCard, migrateLegacyFixedEvents, resolvePlannerTimelineStart, unifyPlannerDraftCards, updateMorningRoutineDraft } from "./utils/unifiedPlannerCards";`,
"App import");

app = replaceOnce(app,
`  const [dragConflict, setDragConflict] = useState(null);
  const [taskMoveSheet, setTaskMoveSheet] = useState(null);`,
`  const [dragConflict, setDragConflict] = useState(null);
  const [morningRoutineConflict, setMorningRoutineConflict] = useState(null);
  const [taskMoveSheet, setTaskMoveSheet] = useState(null);`,
"morning conflict state");

app = replaceOnce(app,
`  function commitDraftChange(change, label = "已更新排程") {
    setDraft((current) => {
      const next = typeof change === "function" ? change(current) : { ...current, ...change };
      setPlannerPast((past) => [...past.slice(-(MAX_PLANNER_HISTORY - 1)), current]);
      setPlannerFuture([]);
      setLastPlannerAction(label);
      setSaveState(\`\${label} · 可撤销\`);
      return next;
    });
  }`,
`  function commitDraftChange(change, label = "已更新排程") {
    setDraft((current) => {
      const next = typeof change === "function" ? change(current) : { ...current, ...change };
      const normalized = ensureMorningRoutineCard(next);
      setPlannerPast((past) => [...past.slice(-(MAX_PLANNER_HISTORY - 1)), current]);
      setPlannerFuture([]);
      setLastPlannerAction(label);
      setSaveState(\`\${label} · 可撤销\`);
      return normalized;
    });
  }`,
"commit invariant");

app = replaceOnce(app,
`  function saveSegmentOverride(blockId, patch) {
    commitDraftChange((current) => ({
      ...current,
      todaySegmentOverrides: {
        ...(current.todaySegmentOverrides || {}),
        [blockId]: {
          ...(current.todaySegmentOverrides?.[blockId] || {}),
          ...patch,
        },
      },
    }), "已保存当前块调整");
    setEditingTask(null);
  }

  function applyResizePlan(blockId, workMinutes) {`,
`  function saveSegmentOverride(blockId, patch) {
    commitDraftChange((current) => ({
      ...current,
      todaySegmentOverrides: {
        ...(current.todaySegmentOverrides || {}),
        [blockId]: {
          ...(current.todaySegmentOverrides?.[blockId] || {}),
          ...patch,
        },
      },
    }), "已保存当前块调整");
    setEditingTask(null);
  }

  function applyMorningRoutineChange(payload, shiftFollowing = false) {
    const startMinute = clockToDayMinutes(payload.startTime);
    const durationMinutes = Math.max(5, Number(payload.durationMinutes || 0));
    if (!Number.isFinite(startMinute) || durationMinutes <= 0) {
      setSaveState("请填写有效的晨间开始时间和时长");
      return;
    }
    commitDraftChange((current) => {
      let next = updateMorningRoutineDraft(current, { startMinute, durationMinutes });
      if (shiftFollowing && morningRoutineConflict) {
        next = {
          ...next,
          todaySegmentOverrides: buildMorningRoutineRippleOverrides({
            blocks: autoSchedule.blocks,
            startAt: morningRoutineConflict.blocker.start,
            delta: morningRoutineConflict.shiftMinutes,
            existingOverrides: next.todaySegmentOverrides,
          }),
        };
      }
      return next;
    }, shiftFollowing ? "已修改晨间洗漱并顺延后续任务" : "已修改今天的晨间洗漱");
    if (payload.setAsDefault) {
      setSettings((current) => ({
        ...current,
        defaultWakeUpTime: formatClockMinutes(startMinute),
        defaultMorningPrepMinutes: durationMinutes,
      }));
      setHasUnsavedChanges(true);
    }
    setEditingTask(null);
    setMorningRoutineConflict(null);
  }

  function requestMorningRoutineChange(payload) {
    const startMinute = clockToDayMinutes(payload.startTime);
    const durationMinutes = Math.max(5, Number(payload.durationMinutes || 0));
    if (!Number.isFinite(startMinute) || durationMinutes <= 0) {
      setSaveState("请填写有效的晨间开始时间和时长");
      return;
    }
    const endMinute = startMinute + durationMinutes;
    const blocker = autoSchedule.blocks
      .filter((block) => !isMorningRoutineCard(block))
      .filter((block) => block?.kind === "task")
      .filter((block) => block?.taskGroup?.source !== "system-life-card")
      .sort((left, right) => left.start - right.start)
      .find((block) => block.start < endMinute);
    if (blocker) {
      setMorningRoutineConflict({
        payload,
        blocker,
        startMinute,
        endMinute,
        overlapStart: Math.max(startMinute, blocker.start),
        overlapEnd: Math.min(endMinute, blocker.end),
        shiftMinutes: Math.max(0, endMinute - blocker.start),
      });
      setEditingTask(null);
      return;
    }
    applyMorningRoutineChange(payload, false);
  }

  function applyResizePlan(blockId, workMinutes) {`,
"morning handlers");

app = replaceOnce(app,
`  function deleteTodayTask(taskId) {
    commitDraftChange((current) => ({
      ...current,
      deletedTodayTaskIds: [...new Set([...(current.deletedTodayTaskIds || []), taskId])],
    }), "已删除今天这个任务");
  }`,
`  function deleteTodayTask(taskId) {
    const task = autoSchedule.taskGroups.find((item) => item.id === taskId);
    if (taskId === MORNING_ROUTINE_CARD_ID || isMorningRoutineCard(task)) {
      setSaveState("晨间洗漱是每天唯一的日开始卡，不能删除");
      return;
    }
    commitDraftChange((current) => ({
      ...current,
      deletedTodayTaskIds: [...new Set([...(current.deletedTodayTaskIds || []), taskId])],
    }), "已删除今天这个任务");
  }`,
"delete guard");

app = replaceOnce(app,
`  function moveSegmentToPool(blockId) {
    saveSegmentOverride(blockId, { placement: "pool", manualStart: null, locked: false });
    setSaveState("当前任务已移回任务池");
  }`,
`  function moveSegmentToPool(blockId) {
    const block = autoSchedule.blocks.find((item) => item.id === blockId);
    if (isMorningRoutineCard(block)) {
      setSaveState("晨间洗漱固定在时间线顶部，不能移回任务池");
      return;
    }
    saveSegmentOverride(blockId, { placement: "pool", manualStart: null, locked: false });
    setSaveState("当前任务已移回任务池");
  }`,
"pool guard");

app = replaceOnce(app,
`  function toggleSegmentLock(block) {
    saveSegmentOverride(block.id, { locked: !block.locked, placement: "timeline" });
    setSaveState(block.locked ? "已解锁位置 · 可撤销" : "已锁定位置 · 可撤销");
  }`,
`  function toggleSegmentLock(block) {
    if (isMorningRoutineCard(block)) {
      setSaveState("晨间洗漱始终锁定为一天的开始");
      return;
    }
    saveSegmentOverride(block.id, { locked: !block.locked, placement: "timeline" });
    setSaveState(block.locked ? "已解锁位置 · 可撤销" : "已锁定位置 · 可撤销");
  }`,
"lock guard");

app = replaceOnce(app,
`  function requestTaskMove(blockId, startMinute, source = "timeline") {
    const segment = autoSchedule.taskSegments.find((item) => item.blockId === blockId);`,
`  function requestTaskMove(blockId, startMinute, source = "timeline") {
    const morningBlock = autoSchedule.blocks.find((item) => item.id === blockId);
    if (isMorningRoutineCard(morningBlock)) {
      setEditingTask({ scope: "segment", task: morningBlock.taskGroup, block: morningBlock });
      setTaskMoveSheet(null);
      return;
    }
    const segment = autoSchedule.taskSegments.find((item) => item.blockId === blockId);`,
"move guard");

app = replaceOnce(app,
`      {editingTask && <EditTaskBlockModal editing={editingTask} taxonomy={classificationTaxonomy} rhythmPresets={settings.rhythmPresets} onSaveRhythmPresets={(rhythmPresets) => setSettings((current) => ({ ...current, rhythmPresets }))} onCancel={() => setEditingTask(null)} onSaveTask={saveTaskOverride} onSaveSegment={saveSegmentOverride} onMoveSegmentToPool={moveSegmentToPool} onDeleteTask={(task) => { deleteTodayTask(task.id); setEditingTask(null); }} onCopyTask={copyTodayTask} onRescheduleAfter={(blockId) => { rescheduleScope(\`after:\${blockId}\`); setEditingTask(null); }} />}
      {recoveryDialog && <RecoveryScheduleModal`,
`      {editingTask && (isMorningRoutineCard(editingTask.block || editingTask.task)
        ? <MorningRoutineModal editing={editingTask} onCancel={() => setEditingTask(null)} onSave={requestMorningRoutineChange} />
        : <EditTaskBlockModal editing={editingTask} taxonomy={classificationTaxonomy} rhythmPresets={settings.rhythmPresets} onSaveRhythmPresets={(rhythmPresets) => setSettings((current) => ({ ...current, rhythmPresets }))} onCancel={() => setEditingTask(null)} onSaveTask={saveTaskOverride} onSaveSegment={saveSegmentOverride} onMoveSegmentToPool={moveSegmentToPool} onDeleteTask={(task) => { deleteTodayTask(task.id); setEditingTask(null); }} onCopyTask={copyTodayTask} onRescheduleAfter={(blockId) => { rescheduleScope(\`after:\${blockId}\`); setEditingTask(null); }} />)}
      {morningRoutineConflict && <MorningRoutineConflictModal conflict={morningRoutineConflict} onCancel={() => setMorningRoutineConflict(null)} onShift={() => applyMorningRoutineChange(morningRoutineConflict.payload, true)} />}
      {recoveryDialog && <RecoveryScheduleModal`,
"modal rendering");

app = replaceOnce(app,
`        <div className="timeline-conflict-banner">发现 {plan.conflicts.length} 处排程冲突，请点击一键重新排程或调整固定事件。</div>`,
`        <div className="timeline-conflict-banner">发现 {plan.conflicts.length} 处排程冲突：{plan.conflicts.map((item) => \`\${item.first.title} ↔ \${item.second.title}\`).join("；")}。请调整对应卡片。</div>`,
"conflict labels");

app = replaceOnce(app,
`function TimelineBlock({ block, timelineStart, minuteHeight, categoryColors = {}, onEditTask, onEditFixed, onToggleComplete, onToggleLock, onReturnToPool, onMoveTask, onResizeTask, allBlocks = [] }) {
  const [resizePreview, setResizePreview] = useState(null);
  const suppressNextCardClickRef = useRef(false);
  const draggable = Boolean((block.taskGroup && !block.locked) || (block.kind === "fixed" && !block.locked));
  const canInsert = block.kind === "task" && block.status !== "completed" && !block.locked;`,
`function TimelineBlock({ block, timelineStart, minuteHeight, categoryColors = {}, onEditTask, onEditFixed, onToggleComplete, onToggleLock, onReturnToPool, onMoveTask, onResizeTask, allBlocks = [] }) {
  const [resizePreview, setResizePreview] = useState(null);
  const suppressNextCardClickRef = useRef(false);
  const isMorningRoutine = isMorningRoutineCard(block);
  const draggable = !isMorningRoutine && Boolean((block.taskGroup && !block.locked) || (block.kind === "fixed" && !block.locked));
  const canInsert = !isMorningRoutine && block.kind === "task" && block.status !== "completed" && !block.locked;`,
"timeline morning state");

app = replaceOnce(app,
`  const className = \`timeline-block \${block.kind} \${plannerCategoryClass(block.categoryId || block.category)} \${block.locked ? "locked" : ""} \${block.status === "completed" ? "completed" : ""} \${block.end - block.start < 20 ? "short" : block.end - block.start < 40 ? "compact" : ""} \${block.conflict ? "conflict" : ""} \${isDragging ? "dragging" : ""}\`;
  function beginResize(event) {
    if (block.kind !== "task" || block.status === "completed") return;`,
`  const className = \`timeline-block \${block.kind} \${plannerCategoryClass(block.categoryId || block.category)} \${block.locked ? "locked" : ""} \${block.status === "completed" ? "completed" : ""} \${block.end - block.start < 20 ? "short" : block.end - block.start < 40 ? "compact" : ""} \${block.conflict ? "conflict" : ""} \${isMorningRoutine ? "morning-anchor" : ""} \${isDragging ? "dragging" : ""}\`;
  function beginResize(event) {
    if (isMorningRoutine || block.kind !== "task" || block.status === "completed") return;`,
"timeline class");

app = replaceOnce(app,
`        <strong>{block.title}{resizePreview ? \` · \${resizePreview.workMinutes}\${resizePreview.restMinutes ? \`+\${resizePreview.restMinutes}\` : ""}\` : ""}</strong>
        {block.kind === "task" && <button className="timeline-lock-button"`,
`        <strong>{isMorningRoutine ? "☀ 晨间洗漱 · 一天从这里开始" : block.title}{resizePreview ? \` · \${resizePreview.workMinutes}\${resizePreview.restMinutes ? \`+\${resizePreview.restMinutes}\` : ""}\` : ""}</strong>
        {block.kind === "task" && !isMorningRoutine && <button className="timeline-lock-button"`,
"morning title and lock");

app = replaceOnce(app,
`        {block.kind === "task" && block.status !== "completed" && <button className="return-to-pool-button" type="button" aria-label={\`将“\${block.title}”放回任务池\`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onReturnToPool(block.id); }}><Undo2 size={14} /></button>}
        {block.kind === "task" && <button className="mobile-move-button"`,
`        {block.kind === "task" && block.status !== "completed" && !isMorningRoutine && <button className="return-to-pool-button" type="button" aria-label={\`将“\${block.title}”放回任务池\`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onReturnToPool(block.id); }}><Undo2 size={14} /></button>}
        {block.kind === "task" && !isMorningRoutine && <button className="mobile-move-button"`,
"morning pool/move");

app = replaceOnce(app,
`      {block.kind === "task" && block.status !== "completed" && !block.locked && <button className="resize-handle-hit-area"`,
`      {block.kind === "task" && block.status !== "completed" && !block.locked && !isMorningRoutine && <button className="resize-handle-hit-area"`,
"morning resize");

app = replaceOnce(app,
`function EditTaskBlockModal({ editing, taxonomy = [], rhythmPresets, onSaveRhythmPresets, onCancel, onSaveTask, onSaveSegment, onMoveSegmentToPool, onDeleteTask, onCopyTask, onRescheduleAfter }) {`,
`function MorningRoutineModal({ editing, onCancel, onSave }) {
  const block = editing.block || {};
  const [form, setForm] = useState(() => ({
    startTime: formatClockMinutes(block.start ?? 7 * 60 + 30),
    durationMinutes: Math.max(5, Number(block.studyMinutes ?? block.end - block.start ?? 20)),
  }));
  const startMinute = clockToDayMinutes(form.startTime);
  const endTime = Number.isFinite(startMinute) ? formatClockMinutes(startMinute + Number(form.durationMinutes || 0)) : "—";
  const submit = (setAsDefault) => onSave({ ...form, setAsDefault });
  return <div className="modal-backdrop"><form className="task-edit-modal" onSubmit={(event) => { event.preventDefault(); submit(false); }}>
    <div className="panel-title"><div><p className="eyebrow">每天唯一 · 固定在时间线顶部</p><h2>编辑晨间洗漱</h2></div><button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button></div>
    <TextField label="开始时间" type="time" value={form.startTime} onChange={(startTime) => setForm((current) => ({ ...current, startTime }))} />
    <NumberField label="持续时间（分钟）" value={form.durationMinutes} step={5} onChange={(durationMinutes) => setForm((current) => ({ ...current, durationMinutes: Math.max(5, Number(durationMinutes || 0)) }))} />
    <div className="task-preview-card"><span>结束时间自动计算</span><strong>{form.startTime || "—"}–{endTime}</strong><small>晨间卡开始时间同时作为时间线起点和 Snapshot wakeTime。</small></div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="secondary-button" type="button" onClick={() => submit(true)}>修改今天并设为默认</button><button className="primary-button" type="submit">仅修改今天</button></div>
  </form></div>;
}

function MorningRoutineConflictModal({ conflict, onCancel, onShift }) {
  const overlap = conflict.overlapEnd > conflict.overlapStart
    ? \`\${formatClockMinutes(conflict.overlapStart)}–\${formatClockMinutes(conflict.overlapEnd)}\`
    : "已有任务位于新的晨间结束时间之前";
  return <div className="modal-backdrop"><div className="task-edit-modal recovery-modal" role="dialog" aria-modal="true" aria-label="晨间洗漱冲突">
    <div className="panel-title"><div><p className="eyebrow">晨间洗漱必须是第一张卡</p><h2>与「{conflict.blocker.title}」冲突</h2></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div>
    <div className="recovery-preview-grid"><InfoLine label="新的晨间时间" value={\`\${formatClockMinutes(conflict.startMinute)}–\${formatClockMinutes(conflict.endMinute)}\`} /><InfoLine label="阻挡任务" value={\`\${conflict.blocker.title} · \${formatClockMinutes(conflict.blocker.start)}–\${formatClockMinutes(conflict.blocker.end)}\`} /><InfoLine label="重叠/顺序问题" value={overlap} /><InfoLine label="需要顺延" value={\`\${conflict.shiftMinutes} 分钟\`} /></div>
    <p className="field-help">晨间洗漱不会被移动到其他空档。可以顺延后续普通任务，或取消本次修改。</p>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消修改</button><button className="primary-button" type="button" onClick={onShift}>顺延后续任务</button></div>
  </div></div>;
}

function EditTaskBlockModal({ editing, taxonomy = [], rhythmPresets, onSaveRhythmPresets, onCancel, onSaveTask, onSaveSegment, onMoveSegmentToPool, onDeleteTask, onCopyTask, onRescheduleAfter }) {`,
"morning modals");

write("src/App.jsx", app);
console.log("Permanent morning routine v2 patch applied.");
