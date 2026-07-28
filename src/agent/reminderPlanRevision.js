function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintReminderPlan(plan = {}) {
  const { revision, generatedAt, ...content } = plan;
  return `v1:${hash(stableSerialize(content))}`;
}

export function resolveReminderPlanRevision(syncByDate = {}, localDate, plan = {}) {
  const prior = syncByDate?.[localDate] || {};
  const fingerprint = fingerprintReminderPlan(plan);
  const acceptedRevision = Math.max(0, Number(prior.acceptedRevision) || 0);
  const revision = prior.fingerprint === fingerprint && acceptedRevision > 0 ? acceptedRevision : acceptedRevision + 1 || 1;
  return { localDate, fingerprint, revision };
}

export function prepareReminderPlanForSync(syncByDate = {}, plan = {}) {
  const revisionState = resolveReminderPlanRevision(syncByDate, plan.localDate, plan);
  return { plan: { ...plan, revision: revisionState.revision }, revisionState };
}

export function recordAcceptedReminderPlanRevision(draft = {}, accepted = {}) {
  const localDate = String(accepted.localDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !accepted.fingerprint || !(Number(accepted.revision) >= 1)) return draft;
  return {
    ...draft,
    reminderPlanSyncByDate: {
      ...(draft.reminderPlanSyncByDate || {}),
      [localDate]: { fingerprint: accepted.fingerprint, acceptedRevision: Number(accepted.revision) },
    },
  };
}
