const flagNames = [
  "agentSnapshot",
  "autosave",
  "localRecovery",
  "catkeeperSender",
  "lifeMaintenance",
  "newStatistics",
  "dynamicContinuousBlocks",
];

/** Development-only isolation: append ?plannerDisable=agentSnapshot,autosave to a local Vite URL. */
export function readPlannerFeatureFlags(search = typeof window === "undefined" ? "" : window.location.search) {
  const isDev = Boolean(import.meta.env?.DEV);
  const disabled = isDev ? new Set(new URLSearchParams(search).get("plannerDisable")?.split(",").map((item) => item.trim()).filter(Boolean)) : new Set();
  return Object.fromEntries(flagNames.map((name) => [name, !disabled.has(name)]));
}
