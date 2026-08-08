import fs from "node:fs";

const appPath = "src/App.jsx";
let app = fs.readFileSync(appPath, "utf8");

function replaceOnce(source, label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: source pattern not found`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${label}: source pattern not unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

app = replaceOnce(
  app,
  "focus imports",
  'import { computeTimelineFocusCoverage, aggregateFocusCoverageByCategory, mergeIntervals as mergeFocusIntervals, normalizeFocusIntervals, isoToBeijingMinutesOfDay } from "./schedule/focusOverlap";\n',
  'import { computeTimelineFocusCoverage, mergeIntervals as mergeFocusIntervals, normalizeFocusIntervals, isoToBeijingMinutesOfDay } from "./schedule/focusOverlap";\nimport { aggregateActualFocusMinutesByCategory } from "./schedule/focusCategoryTotals.js";\n',
);

app = replaceOnce(
  app,
  "live Focus refresh",
  `  // the (default-off) focusTimelineTrackEnabled flag is on.\n  useEffect(() => {\n    if (!plannerFeatureFlags.focusTimelineTrackEnabled) return undefined;\n    let cancelled = false;\n    setFocusSessionsState((current) => current.date === draft.targetDate ? current : { status: "loading", sessions: [], date: draft.targetDate });\n    requestFocusSessions(draft.targetDate).then((result) => {\n      if (cancelled) return;\n      setFocusSessionsState({ status: result.ok ? result.status : result.status, sessions: result.sessions || [], date: draft.targetDate, syncedAt: result.syncedAt || null });\n    });\n    return () => { cancelled = true; };\n  }, [plannerFeatureFlags.focusTimelineTrackEnabled, draft.targetDate]);`,
  `  // the (default-off) focusTimelineTrackEnabled flag is on. Keep today's\n  // view live: a one-shot fetch made the goal card freeze at whatever Focus\n  // total existed when the schedule page was first opened. Refresh while\n  // visible, and refresh immediately when the user returns to the browser.\n  useEffect(() => {\n    if (!plannerFeatureFlags.focusTimelineTrackEnabled) return undefined;\n    let cancelled = false;\n    let inFlight = false;\n    const loadFocusSessions = async ({ showLoading = false } = {}) => {\n      if (inFlight) return;\n      inFlight = true;\n      if (showLoading) {\n        setFocusSessionsState((current) => current.date === draft.targetDate ? current : { status: "loading", sessions: [], date: draft.targetDate });\n      }\n      try {\n        const result = await requestFocusSessions(draft.targetDate);\n        if (cancelled) return;\n        setFocusSessionsState({ status: result.status, sessions: result.sessions || [], date: draft.targetDate, syncedAt: result.syncedAt || null });\n      } finally {\n        inFlight = false;\n      }\n    };\n    const refreshWhenVisible = () => {\n      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;\n      void loadFocusSessions();\n    };\n\n    void loadFocusSessions({ showLoading: true });\n    const timer = draft.targetDate === beijingDay && typeof window !== "undefined"\n      ? window.setInterval(refreshWhenVisible, 15_000)\n      : null;\n    if (typeof window !== "undefined") window.addEventListener("focus", refreshWhenVisible);\n    if (typeof document !== "undefined") document.addEventListener("visibilitychange", refreshWhenVisible);\n\n    return () => {\n      cancelled = true;\n      if (timer !== null && typeof window !== "undefined") window.clearInterval(timer);\n      if (typeof window !== "undefined") window.removeEventListener("focus", refreshWhenVisible);\n      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", refreshWhenVisible);\n    };\n  }, [plannerFeatureFlags.focusTimelineTrackEnabled, draft.targetDate, beijingDay]);`,
);

const oldCoverage = `  const focusCoverageByCategory = useMemo(() => {\n    const byBlockId = new Map(timelineFocusCoverage.map((item) => [item.blockId, item]));\n    const raw = aggregateFocusCoverageByCategory({ blocks: autoSchedule.blocks, coverageByBlockId: byBlockId });\n    // aggregateFocusCoverageByCategory groups by the block's raw categoryId,\n    // which may still be a pre-v3 legacy/bare id — normalize here so it\n    // matches studyTargetProgress's normalized keys (buildCategoryTimeProgress\n    // already normalizes), the same "normalize on read" pattern used\n    // throughout this file for stored categoryId keys.\n    const merged = new Map();\n    raw.forEach((item) => {\n      const categoryId = normalizeCategoryId(item.categoryId);\n      const existing = merged.get(categoryId);\n      if (existing) {\n        existing.plannedWorkMinutes += item.plannedWorkMinutes;\n        existing.focusOverlapMinutes += item.focusOverlapMinutes;\n      } else {\n        merged.set(categoryId, { ...item, categoryId });\n      }\n    });\n    return [...merged.values()];\n  }, [timelineFocusCoverage, autoSchedule.blocks]);`;
const newCoverage = `  // “我的计划”的完成量 is actual categorized Focus for the day, not only\n  // the minutes that happened to overlap the original planned card windows.\n  // Timeline overlap remains separately available above for plan-vs-actual\n  // alignment and settlement diagnostics.\n  const focusCoverageByCategory = useMemo(\n    () => aggregateActualFocusMinutesByCategory({ sessions: focusSessionsState.sessions, targetDateIso: draft.targetDate })\n      .map((item) => ({ categoryId: item.categoryId, plannedWorkMinutes: 0, focusOverlapMinutes: item.focusMinutes })),\n    [focusSessionsState.sessions, draft.targetDate]\n  );`;
app = replaceOnce(app, "actual category Focus totals", oldCoverage, newCoverage);

fs.writeFileSync(appPath, app);

const stylesPath = "src/styles.css";
let styles = fs.readFileSync(stylesPath, "utf8");
styles = replaceOnce(
  styles,
  "desktop tracker container expands",
  `.planner-overview > .life-maintenance-card {\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n}`,
  `.planner-overview > .life-maintenance-card {\n  flex: none;\n  min-height: auto;\n  display: flex;\n  flex-direction: column;\n  overflow: visible;\n}`,
);
styles = replaceOnce(
  styles,
  "desktop tracker list expands",
  `.tracker-daily-summary { display: grid; align-content: start; flex: 1; min-height: 0; overflow-y: auto; }`,
  `.tracker-daily-summary { display: grid; align-content: start; flex: none; min-height: auto; overflow: visible; }`,
);
styles = replaceOnce(
  styles,
  "mobile tracker list expands",
  `  .tracker-daily-summary {\n    flex: unset;\n    min-height: unset;\n    max-height: 22rem;\n    overflow-y: auto;\n  }`,
  `  .tracker-daily-summary {\n    flex: unset;\n    min-height: unset;\n    max-height: none;\n    overflow: visible;\n  }`,
);
fs.writeFileSync(stylesPath, styles);

console.log("focus target live refresh + expanded tracker patch applied");
