import assert from "node:assert/strict";
import test from "node:test";
import { buildReminderPlan, normalizeStartVerification, validateReminderPlan } from "./buildReminderPlan.js";

test("builds exact semantic reminders and a conditional follow-up", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", revision: 7, cards: [{ id: "math", title: "数学", start: "17:00", end: "17:50", systemRole: "evening_study" }] });
  assert.equal(plan.reminders[0].scheduledAt, "2026-07-25T16:55:00+08:00");
  assert.equal(plan.reminders[0].followUpPolicy.delayMinutes, 10);
  assert.equal(plan.reminders[0].deliveryMode, "must_send");
});

test("does not infer defaults from a display title", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", cards: [{ id: "x", title: "起床", start: "07:00", end: "07:20" }] });
  assert.equal(plan.reminders.length, 0);
});

test("marks only each stage's first semantic study card, with every phase configurable",()=>{const p=buildReminderPlan({localDate:"2026-07-25",deskVerification:{morning:{enabled:false},afternoon:{enabled:false},evening:{enabled:false}},cards:[{id:"m",start:"09:00",end:"10:00",statGroup:"study"},{id:"m2",start:"10:20",end:"11:00",statGroup:"study"},{id:"a",start:"14:00",end:"15:00",statGroup:"study"},{id:"e",start:"19:00",end:"20:00",statGroup:"study"}]});const c=Object.fromEntries(p.cards.map(x=>[x.id,x]));assert.equal(c.m.studyStartVerification,null);assert.equal(c.m2.isFirstStudyCardOfStage,false);assert.equal(c.a.studyStartVerification,null);assert.equal(c.e.studyStartVerification,null);});

test("a card-level reminder and desk override beats phase defaults without enabling other middle cards", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", deskVerification: { afternoon: { enabled: false } }, cards: [
    { id: "first", start: "14:00", end: "14:30", statGroup: "study" },
    { id: "middle", start: "15:00", end: "15:30", statGroup: "study", snowdustReminder: { mode: "on", advanceMinutes: 0 }, deskVerification: { mode: "on" } },
  ] });
  assert.equal(plan.reminders.length, 2);
  assert.equal(plan.reminders.find((item) => item.sourceCardId === "first").studyStartVerification, null);
  const middle = plan.reminders.find((item) => item.sourceCardId === "middle");
  assert.equal(middle.scheduledAt, "2026-07-25T15:00:00+08:00");
  assert.equal(middle.studyStartVerification.required, true);
});

test("plan preview reflects edited verification settings immediately", () => {
  const card = [{ id: "study", start: "09:00", end: "10:00", statGroup: "study" }];
  const before = buildReminderPlan({ localDate: "2026-07-25", cards: card });
  const after = buildReminderPlan({ localDate: "2026-07-25", cards: card, deskVerification: { morning: { enabled: true }, firstFollowUpMinutes: 4, reminderIntervalMinutes: 11 } });
  assert.equal(before.cards[0].studyStartVerification.firstFollowUpMinutes, 10);
  assert.equal(after.cards[0].studyStartVerification.firstFollowUpMinutes, 4);
  assert.equal(after.cards[0].studyStartVerification.reminderIntervalMinutes, 11);
});

test("preview data carries the target date, reminder text, and desk-photo marker", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-27", revision: 9, cards: [{ id: "desk", title: "Math desk", start: "09:00", end: "10:00", statGroup: "study", snowdustReminder: { mode: "on", advanceMinutes: 6, note: "Open your math book" } }] });
  assert.equal(plan.localDate, "2026-07-27");
  assert.equal(plan.revision, 9);
  assert.equal(plan.reminders[0].text, "Open your math book");
  assert.equal(plan.reminders[0].advanceMinutes, 6);
  assert.equal(plan.reminders[0].studyStartVerification.required, true);
});

test("preview validation reads the generated reminder list and rejects only a true plan mismatch", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-27", cards: [{ id: "desk", start: "09:00", end: "10:00", statGroup: "study" }] });
  assert.deepEqual(validateReminderPlan(plan), []);
  const malformed = { ...plan, reminders: [] };
  assert.equal(validateReminderPlan(malformed).length, 1);
});

test("smart start verification derives its method and kind from the card statGroup, including legacy smart data", () => {
  const smart = { mode: "on", method: "smart" };
  assert.deepEqual(normalizeStartVerification(smart, { statGroup: "study" }).method, "photo");
  assert.equal(normalizeStartVerification(smart, { statGroup: "study" }).kind, "study_ready");
  assert.equal(normalizeStartVerification(smart, { statGroup: "reading" }).kind, "study_ready");
  assert.equal(normalizeStartVerification(smart, { statGroup: "exercise" }).kind, "exercise_ready");
  assert.equal(normalizeStartVerification(smart, { statGroup: "other" }).kind, "text_ack");
  assert.equal(normalizeStartVerification({ mode: "on", method: "smart", kind: "study_ready" }, { statGroup: "exercise" }).kind, "exercise_ready", "legacy smart kind must be ignored");
});

test("explicit photo and text methods retain their chosen kind rather than being smart-derived", () => {
  assert.equal(normalizeStartVerification({ mode: "on", method: "photo", kind: "study_ready" }, { statGroup: "exercise" }).kind, "study_ready");
  assert.equal(normalizeStartVerification({ mode: "on", method: "photo", kind: "exercise_ready" }, { statGroup: "study" }).kind, "exercise_ready");
});
