import fs from "node:fs";

function replaceOnce(source, label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: source pattern not found`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${label}: source pattern not unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const appPath = "src/App.jsx";
let app = fs.readFileSync(appPath, "utf8");

app = replaceOnce(
  app,
  "Focus category rollup input",
  `    () => aggregateActualFocusMinutesByCategory({ sessions: focusSessionsState.sessions, targetDateIso: draft.targetDate })\n      .map((item) => ({ categoryId: item.categoryId, plannedWorkMinutes: 0, focusOverlapMinutes: item.focusMinutes })),\n    [focusSessionsState.sessions, draft.targetDate]\n`,
  `    () => aggregateActualFocusMinutesByCategory({ sessions: focusSessionsState.sessions, targetDateIso: draft.targetDate, categoryTree: classificationTaxonomy })\n      .map((item) => ({ categoryId: item.categoryId, plannedWorkMinutes: 0, focusOverlapMinutes: item.focusMinutes })),\n    [focusSessionsState.sessions, draft.targetDate, classificationTaxonomy]\n`,
);

app = replaceOnce(
  app,
  "per-category settled Focus display",
  `            // Waiting is only useful when this row has no settled Focus yet.\n            // Once we have a real completed value, don't append the noisy\n            // technical “部分等待结算” suffix to every category.\n            anyCardWaitingSettlement: anyCardWaitingSettlement && !focusEntry,\n`,
  `            // Daily target completion is a settled-Focus counter. Future or\n            // currently-running planner blocks must not turn a category row\n            // back into “等待结算”; the live Focus rail owns that transient state.\n            anyCardWaitingSettlement: false,\n`,
);

fs.writeFileSync(appPath, app);

const stylesPath = "src/styles.css";
let styles = fs.readFileSync(stylesPath, "utf8");
styles = replaceOnce(
  styles,
  "expanded planner overview frame",
  `.schedule-availability {\n  position: sticky;\n  top: 5.5rem;\n  height: calc(100vh - 7rem);\n  min-height: 0;\n  overflow: hidden;\n  align-self: start;\n}`,
  `.schedule-availability {\n  position: sticky;\n  top: 5.5rem;\n  height: calc(100vh - 7rem);\n  min-height: 0;\n  overflow: hidden;\n  align-self: start;\n}\n\n/* PlannerOverview contains an intentionally fully-expanded Tracker list.\n * Let this specific right rail grow with its contents and use page scrolling;\n * the generic availability box keeps its bounded/sticky behavior elsewhere. */\n.planner-overview.schedule-availability {\n  position: static;\n  height: auto;\n  max-height: none;\n  min-height: max-content;\n  overflow: visible;\n  align-self: start;\n}`,
);

fs.writeFileSync(stylesPath, styles);
console.log("Focus target category rollup + expanded planner frame applied");
