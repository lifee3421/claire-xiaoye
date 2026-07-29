/** Shared modal safety rule: invalid previews are neither enabled nor sent. */
export function canConfirmReminderPlan(preview) {
  return Boolean(preview?.plan) && !(Array.isArray(preview.configErrors) && preview.configErrors.length > 0);
}
