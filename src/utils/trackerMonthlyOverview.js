import { resolveTrackerEvidence } from "./trackerFacts.js";
import { validDate } from "./plannerOverview.js";

function asArray(value) { return Array.isArray(value) ? value : []; }

export function monthBounds(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
  const [year, month] = monthKey.split("-").map(Number);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(lastDay).padStart(2, "0")}`, days: lastDay };
}

export function shiftMonth(monthKey, amount) {
  const bounds = monthBounds(monthKey);
  if (!bounds) return monthKey;
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function activeTrackerEvents(events, trackerId) {
  return asArray(events).filter((event) => event?.trackerId === trackerId && event.state === "active" && validDate(event.occurredOn));
}

function dailyEvidence(events) {
  const byDate = new Map();
  for (const event of events) {
    const entry = { id: event.id, occurredOn: event.occurredOn, evidenceSummary: event.evidenceSummary || "", sourceType: event.sourceType || "", value: Number(event.value) || 0, unit: event.unit || "" };
    byDate.set(event.occurredOn, [...(byDate.get(event.occurredOn) || []), entry]);
  }
  return byDate;
}

export function projectTrackerMonthlyOverview({ tracker = {}, events = [], monthKey, today, todaySettlementExists = false, hasSavedHistory = false } = {}) {
  const bounds = monthBounds(monthKey);
  if (!bounds) return { state: "invalid_month", monthKey, completionDates: [], evidenceByDate: new Map() };
  const activeEvents = activeTrackerEvents(events, tracker.id);
  const facts = resolveTrackerEvidence(tracker, { events: activeEvents, today: today || bounds.end, todaySettlementExists });
  if (facts.requiresSetup) return { state: "requires_setup", monthKey, bounds, facts, monthlyEvents: [], completionDates: [], evidenceByDate: new Map(), monthlyValue: 0, monthlyCount: 0 };
  const monthlyEvents = activeEvents.filter((event) => event.occurredOn >= bounds.start && event.occurredOn <= bounds.end);
  const evidenceByDate = dailyEvidence(monthlyEvents);
  const completionDates = [...evidenceByDate.keys()].sort();
  const aggregation = tracker.goal?.aggregation || "occurrence";
  const monthlyValue = aggregation === "sum" ? monthlyEvents.reduce((total, event) => total + (Number(event.value) || 0), 0) : completionDates.length;
  const state = monthlyEvents.length ? "ready" : hasSavedHistory ? "history_not_migrated" : "empty";
  return { state, monthKey, bounds, facts, aggregation, monthlyEvents, completionDates, evidenceByDate, monthlyValue, monthlyCount: completionDates.length, lastCompletedDate: facts.lastCompletedDate, nextDueDate: facts.nextDueDate, progress: facts.progress };
}
