import assert from "node:assert/strict";
import test from "node:test";
import { buildReminderPlan } from "./buildReminderPlan.js";

test("builds exact semantic reminders and a conditional follow-up", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", revision: 7, cards: [{ id: "math", title: "数学", start: "17:00", end: "17:50", systemRole: "evening_study" }] });
  assert.equal(plan.reminders[0].scheduledAt, "2026-07-25T17:00:00+08:00");
  assert.equal(plan.reminders[0].followUpPolicy.delayMinutes, 10);
  assert.equal(plan.reminders[0].deliveryMode, "must_send");
});

test("does not infer defaults from a display title", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", cards: [{ id: "x", title: "起床", start: "07:00", end: "07:20" }] });
  assert.equal(plan.reminders.length, 0);
});

test("marks only each stage's first semantic study card, with afternoon forced",()=>{const p=buildReminderPlan({localDate:"2026-07-25",deskVerification:{morning:{enabled:false},evening:{enabled:false}},cards:[{id:"m",start:"09:00",end:"10:00",statGroup:"study"},{id:"m2",start:"10:20",end:"11:00",statGroup:"study"},{id:"a",start:"14:00",end:"15:00",statGroup:"study"},{id:"e",start:"19:00",end:"20:00",statGroup:"study"}]});const c=Object.fromEntries(p.cards.map(x=>[x.id,x]));assert.equal(c.m.studyStartVerification,null);assert.equal(c.m2.isFirstStudyCardOfStage,false);assert.equal(c.a.studyStartVerification.required,true);assert.equal(c.e.studyStartVerification,null);});

test("plan preview reflects edited verification settings immediately", () => {
  const card = [{ id: "study", start: "09:00", end: "10:00", statGroup: "study" }];
  const before = buildReminderPlan({ localDate: "2026-07-25", cards: card });
  const after = buildReminderPlan({ localDate: "2026-07-25", cards: card, deskVerification: { morning: { enabled: true }, firstFollowUpMinutes: 4, reminderIntervalMinutes: 11 } });
  assert.equal(before.cards[0].studyStartVerification.firstFollowUpMinutes, 10);
  assert.equal(after.cards[0].studyStartVerification.firstFollowUpMinutes, 4);
  assert.equal(after.cards[0].studyStartVerification.reminderIntervalMinutes, 11);
});
