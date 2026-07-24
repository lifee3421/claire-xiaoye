// Applies a user-configured default duration exactly once, at the moment a
// study leaf is added for today — never on every render, never retroactively
// overwriting a value the user already has or has since cleared.
// `currentValue` is the raw draft field value (may be "", a number, etc).
export function resolveDefaultMinutesForAdd(leafKey, studyLeafDefaults, currentValue) {
  const isEmpty = currentValue === "" || currentValue === null || currentValue === undefined;
  if (!isEmpty) return null;

  const config = studyLeafDefaults?.[leafKey];
  const defaultMinutes = Number(config?.defaultMinutes);
  if (!config || !Number.isFinite(defaultMinutes) || defaultMinutes <= 0) return null;

  return defaultMinutes;
}
