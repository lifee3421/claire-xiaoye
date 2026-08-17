const TODAY_PATH = "/today";

export function isTodayPlannerPath(pathname) {
  if (typeof pathname !== "string") return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === TODAY_PATH;
}
