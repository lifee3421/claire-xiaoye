const TODAY_PATH = "/today";

export function isTodayPlannerPath(pathname) {
  if (typeof pathname !== "string") return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === TODAY_PATH;
}

export function initialPlannerTab(pathname) {
  return isTodayPlannerPath(pathname) ? "schedule" : "dashboard";
}

export function plannerPathForTab(tab, pathname = typeof window !== "undefined" ? window.location.pathname : "/") {
  // /today is an explicit SnowDustApp surface, not the canonical URL for the
  // desktop schedule tab. A desktop user who opens “明日排程” stays on the
  // normal Web shell at /. Only a session that is already inside /today keeps
  // that dedicated route while it remains on the schedule surface.
  if (tab === "schedule" && isTodayPlannerPath(pathname)) return TODAY_PATH;
  return "/";
}
