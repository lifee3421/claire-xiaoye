// Day 1 is the start date itself, not day 0.
export function calculatePeriodDay(startDate, reviewDate) {
  if (!startDate || !reviewDate) return null;

  const start = new Date(`${startDate}T00:00:00`);
  const current = new Date(`${reviewDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime())) return null;

  const diff = Math.floor((current - start) / 86400000);

  return diff >= 0 ? diff + 1 : null;
}
