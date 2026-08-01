function messageFor(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "未知错误");
}

/** Resolves every loader outcome to a visible sidebar state; failures are not swallowed. */
export async function resolveTrackerOverviewFacts({ loadFacts, trackers = [], targetDate } = {}) {
  if (typeof loadFacts !== "function") return { status: "error", facts: [], error: "习惯状态读取服务不可用" };
  try {
    const facts = await loadFacts(trackers, targetDate);
    return { status: "ready", facts: Array.isArray(facts) ? facts : [], error: "" };
  } catch (error) {
    return { status: "error", facts: [], error: messageFor(error) };
  }
}

/** A stale or unmounted request must never overwrite a newer sidebar state. */
export function canApplyTrackerOverviewResult({ active, requestId, currentRequestId } = {}) {
  return active === true && requestId === currentRequestId;
}
