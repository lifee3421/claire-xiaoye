export const DEFAULT_DESK_VERIFICATION_SETTINGS = Object.freeze({
  morning: { enabled: true }, afternoon: { enabled: true }, evening: { enabled: true },
  defaultAdvanceMinutes: 5, firstFollowUpMinutes: 10, reminderIntervalMinutes: 20,
});

/** Normalizes persisted profile data. Afternoon verification is intentionally locked on. */
export function normalizeDeskVerificationSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const minutes = (candidate, fallback) => Math.max(1, Number(candidate) || fallback);
  return {
    morning: { enabled: source.morning?.enabled !== false },
    afternoon: { enabled: true },
    evening: { enabled: source.evening?.enabled !== false },
    defaultAdvanceMinutes: Math.max(0, Number(source.defaultAdvanceMinutes) || 5),
    firstFollowUpMinutes: minutes(source.firstFollowUpMinutes, 10),
    reminderIntervalMinutes: minutes(source.reminderIntervalMinutes, 20),
  };
}
