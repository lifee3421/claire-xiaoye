import fs from "node:fs";

const path = "src/App.jsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: source pattern not found`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${label}: source pattern is not unique`);
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceRegexOnce(label, pattern, replacement) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected 1 match, got ${matches.length}`);
  source = source.replace(pattern, replacement);
}

replaceOnce(
  "planner UI policy import",
  'import { getBlockActiveMinutes, summarizePlannerMinutes } from "./utils/plannerMinutes";\n',
  'import { getBlockActiveMinutes, summarizePlannerMinutes } from "./utils/plannerMinutes";\nimport { shouldShowTimelineCompletionToggle } from "./utils/plannerUiPolicy.js";\n',
);

replaceOnce(
  "tracker facts follow plan date",
  'resolveTrackerOverviewFacts({ loadFacts: onLoadTrackerFacts, trackers: effectiveTrackers, targetDate: beijingDay })',
  'resolveTrackerOverviewFacts({ loadFacts: onLoadTrackerFacts, trackers: effectiveTrackers, targetDate: draft.targetDate })',
);
replaceOnce(
  "tracker facts dependency follows plan date",
  '}, [effectiveTrackersKey, beijingDay, onLoadTrackerFacts, trackerFactsReloadKey, trackerReloadSignal]);',
  '}, [effectiveTrackersKey, draft.targetDate, onLoadTrackerFacts, trackerFactsReloadKey, trackerReloadSignal]);',
);
replaceOnce(
  "tracker summary date follows plan date",
  'trackerToday={beijingDay}',
  'trackerToday={draft.targetDate}',
);

replaceOnce(
  "auto-materialize tracker reminders for viewed plan date",
  `  }, [effectiveTrackersKey, draft.targetDate, onLoadTrackerFacts, trackerFactsReloadKey, trackerReloadSignal]);\n  useEffect(() => {\n    if (plannerFeatureFlags.agentSnapshot) onAgentSnapshot?.(currentAgentSnapshot);\n`,
  `  }, [effectiveTrackersKey, draft.targetDate, onLoadTrackerFacts, trackerFactsReloadKey, trackerReloadSignal]);\n\n  // Make review/habit reminders follow the date currently being planned, not\n  // merely the wall-clock day. CompletionEvents remain the fact layer; this\n  // only materializes the already-resolved due reminder as a planner sticker.\n  useEffect(() => {\n    if (trackerFactsState.status !== "ready") return;\n    const stickerTrackers = effectiveTrackers.filter((tracker) => tracker?.stickerSettings?.enabled === true);\n    if (!stickerTrackers.length) return;\n    applyTrackerStickerSync({\n      trackerFactsList: trackerFactsState.facts,\n      reviewDate: draft.targetDate,\n      draft,\n      commitDraftChange,\n      trackers: stickerTrackers,\n      createSticker: createTrackerSticker,\n      completeSticker: completeStickerInstance,\n      reopenSticker: reopenStickerInstance,\n      updateSticker: updateTrackerStickerInstance,\n    });\n  }, [trackerFactsState.status, trackerFactsState.facts, draft.targetDate, effectiveTrackersKey]);\n\n  useEffect(() => {\n    if (plannerFeatureFlags.agentSnapshot) onAgentSnapshot?.(currentAgentSnapshot);\n`,
);

replaceOnce(
  "persistence payload accepts settings source",
  'function buildPlannerPersistencePayload(updatedAt = new Date().toISOString(), draftSource = draft) {',
  'function buildPlannerPersistencePayload(updatedAt = new Date().toISOString(), draftSource = draft, settingsSource = settings) {',
);
replaceOnce(
  "persistence payload uses settings source",
  '      scheduleAssistantSettings: settings,\n      scheduleAssistantDraft: savedDraft,',
  '      scheduleAssistantSettings: settingsSource,\n      scheduleAssistantDraft: savedDraft,',
);
replaceOnce(
  "persist planner accepts settings source",
  'async function persistPlannerNow(mode = "manual", draftSource = draft) {',
  'async function persistPlannerNow(mode = "manual", draftSource = draft, settingsSource = settings) {',
);
replaceOnce(
  "persist planner builds supplied settings",
  '    const payload = buildPlannerPersistencePayload(updatedAt, draftSource);',
  '    const payload = buildPlannerPersistencePayload(updatedAt, draftSource, settingsSource);',
);

replaceOnce(
  "durable study target callbacks",
  '          onSaveDefaults={(nextDefaults) => { setSettings((current) => ({ ...current, studyTargetDefaults: nextDefaults })); }}\n          onSaveOverrides={(nextOverrides) => { setDraft((current) => ({ ...current, studyTargetOverrides: nextOverrides })); }}',
  `          onSaveDefaults={async (nextDefaults) => {\n            const nextSettings = { ...settings, studyTargetDefaults: nextDefaults };\n            setSettings(nextSettings);\n            const ok = await persistPlannerNow("manual", draft, nextSettings);\n            if (ok) setSaveState("学习目标默认值已保存");\n            return ok;\n          }}\n          onSaveOverrides={async (nextOverrides) => {\n            // A user edit is authoritative for the active day. Clear any\n            // legacy frozen target snapshot so an old confirmation cannot\n            // visually mask the newly-saved target after refresh.\n            const nextDraft = { ...draft, studyTargetOverrides: nextOverrides, studyTargetSnapshot: null };\n            setDraft(nextDraft);\n            const ok = await persistPlannerNow("manual", nextDraft);\n            if (ok) setSaveState("今日学习目标已保存");\n            return ok;\n          }}`,
);

replaceOnce(
  "single learning target entry point",
  `      <div className="planner-overview-actions">\n        <button className="secondary-button compact" type="button" onClick={onEditTargets}>\n          设置计划目标\n        </button>\n        {studyTargetDefaultsEnabled && (\n          <button className="secondary-button compact" type="button" onClick={onEditStudyTargetDefaults}>\n            学习目标默认值\n          </button>\n        )}\n      </div>`,
  `      <div className="planner-overview-actions">\n        {studyTargetDefaultsEnabled && (\n          <button className="secondary-button compact" type="button" onClick={onEditStudyTargetDefaults}>\n            学习目标\n          </button>\n        )}\n      </div>`,
);

replaceRegexOnce(
  "remove legacy plan-target progress card",
  /\n      \{categoryProgress\.length > 0 && \([\s\S]*?\n      \)\}\n      <section className="life-maintenance-card">/,
  '\n      <section className="life-maintenance-card">',
);

replaceOnce(
  "study target editor starts on today",
  '  const [tab, setTab] = useState("defaults");',
  '  const [tab, setTab] = useState("today");',
);
replaceOnce(
  "study target modal title and copy",
  `            <h3>学习目标默认值</h3>\n            <p>“默认值”决定新的一天自动继承的目标；“今日”只改今天，不影响默认值。{hasSnapshot ? " 今日计划已确认，目标已冻结为快照，这里的“今日”修改只影响尚未确认的部分。" : ""}</p>`,
  `            <h3>学习目标</h3>\n            <p>“今日”修改当前排程日期并立即保存；“默认值”决定未来新日期自动继承的目标。</p>`,
);
replaceOnce(
  "study target tab order",
  `        <div className="settings-tab-row">\n          <button className={\`secondary-button compact \${tab === "defaults" ? "active" : ""}\`} type="button" onClick={() => setTab("defaults")}>默认值</button>\n          <button className={\`secondary-button compact \${tab === "today" ? "active" : ""}\`} type="button" onClick={() => setTab("today")}>今日</button>\n        </div>`,
  `        <div className="settings-tab-row">\n          <button className={\`secondary-button compact \${tab === "today" ? "active" : ""}\`} type="button" onClick={() => setTab("today")}>今日</button>\n          <button className={\`secondary-button compact \${tab === "defaults" ? "active" : ""}\`} type="button" onClick={() => setTab("defaults")}>默认值</button>\n        </div>`,
);
replaceOnce(
  "my plan target status copy",
  '<span>{effectiveStudyTarget?.source === "snapshot" ? "目标已锁定" : "目标（草稿）"}</span>',
  '<span>今日目标</span>',
);

replaceOnce(
  "hide partial waiting suffix when settled minutes exist",
  `          const focus = resolveMyPlanFocusDisplay({\n            focusDataStatus,\n            entry: focusByCategoryId.get(row.categoryId) || null,\n            anyCardWaitingSettlement,\n          });`,
  `          const focusEntry = focusByCategoryId.get(row.categoryId) || null;\n          const focus = resolveMyPlanFocusDisplay({\n            focusDataStatus,\n            entry: focusEntry,\n            // Waiting is only useful when this row has no settled Focus yet.\n            // Once we have a real completed value, don't append the noisy\n            // technical “部分等待结算” suffix to every category.\n            anyCardWaitingSettlement: anyCardWaitingSettlement && !focusEntry,\n          });`,
);

replaceOnce(
  "completion checkbox only for meals",
  '        {block.kind === "task" && !isSuperseded && (\n          <button\n            type="button"\n            className={`timeline-task-checkbox-hit-area ${block.status === "completed" ? "checked" : ""}`}',
  '        {shouldShowTimelineCompletionToggle(block) && (\n          <button\n            type="button"\n            className={`timeline-task-checkbox-hit-area ${block.status === "completed" ? "checked" : ""}`}',
);

fs.writeFileSync(path, source);
console.log("planner follow-through patch applied");
