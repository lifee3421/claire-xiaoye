function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function maintenanceCandidate(item) {
  if (!item || typeof item.id !== "string" || !item.id) return null;
  const every = positiveNumber(item.intervalDays);
  return {
    id: item.id,
    ...(typeof item.name === "string" && item.name.trim() ? { title: item.name.trim() } : {}),
    ...(item.hidden === true ? { enabled: false } : {}),
    ...(every
      ? {
          schedule: { kind: "interval", every, unit: "day" },
          goal: { aggregation: "occurrence", target: 1, unit: "times" },
        }
      : {}),
  };
}

function reviewCandidate(item) {
  if (!item || typeof item.id !== "string" || !item.id) return null;
  const candidate = {
    id: item.id,
    ...(typeof item.name === "string" && item.name.trim() ? { title: item.name.trim() } : {}),
    ...(item.enabled === false || item.paused === true ? { enabled: false } : {}),
  };
  const target = positiveNumber(item.goal?.target ?? item.target ?? item.targetMinutes);
  const aggregation = item.goal?.aggregation || item.aggregation || (item.measure === "duration" ? "sum" : "occurrence");
  if (item.schedule?.kind === "interval" && positiveNumber(item.schedule.every) && item.schedule.unit) {
    candidate.schedule = { kind: "interval", every: positiveNumber(item.schedule.every), unit: item.schedule.unit };
  } else if (item.schedule?.kind === "period" && item.schedule.period) {
    candidate.schedule = { kind: "period", period: item.schedule.period };
  } else if (item.schedule?.kind === "deadline" && typeof item.schedule.dueDate === "string") {
    candidate.schedule = { kind: "deadline", dueDate: item.schedule.dueDate };
  }
  if (candidate.schedule && target && ["occurrence", "active_days", "sum"].includes(aggregation)) {
    candidate.goal = { aggregation, target, unit: item.goal?.unit || item.unit || (aggregation === "sum" ? "minutes" : "times") };
  }
  if (typeof item.categoryId === "string" && item.categoryId) candidate.evidenceBindings = [{ type: "categoryId", categoryId: item.categoryId }];
  if (Array.isArray(item.fieldPath) && item.fieldPath.length) candidate.evidenceBindings = [{ type: "reviewFieldPath", path: item.fieldPath, ...(aggregation === "sum" ? { valueType: "duration" } : {}) }];
  return candidate;
}

function mergeCandidate(base, patch) {
  if (!base) return patch;
  return {
    ...base,
    ...patch,
    schedule: patch.schedule || base.schedule,
    goal: patch.goal || base.goal,
    evidenceBindings: patch.evidenceBindings || base.evidenceBindings,
  };
}

// Only explicit ids and fields are adapted. Names/titles are never used to
// infer a tracker identity, so dynamic categories stay out of this path.
export function buildLegacyTrackerCandidates({ healthMaintenanceItems, reviewTrackers } = {}) {
  const candidates = new Map();
  for (const item of asArray(healthMaintenanceItems)) {
    const candidate = maintenanceCandidate(item);
    if (candidate) candidates.set(candidate.id, mergeCandidate(candidates.get(candidate.id), candidate));
  }
  for (const item of asArray(reviewTrackers)) {
    const candidate = reviewCandidate(item);
    if (candidate) candidates.set(candidate.id, mergeCandidate(candidates.get(candidate.id), candidate));
  }
  return candidates;
}
