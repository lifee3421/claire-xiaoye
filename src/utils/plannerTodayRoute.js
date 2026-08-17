const TODAY_PATH = "/today";

export function isTodayPlannerPath(pathname) {
  if (typeof pathname !== "string") return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === TODAY_PATH;
}

export function initialPlannerTab(pathname) {
  return isTodayPlannerPath(pathname) ? "schedule" : "dashboard";
}

export function plannerPathForTab(tab) {
  return tab === "schedule" ? TODAY_PATH : "/";
}
