import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveReminderConfig } from "./reminderConfigResolver.js";
import { buildReminderPlan } from "./buildReminderPlan.js";

const settings = { defaultAdvanceMinutes: 8, firstFollowUpMinutes: 10, reminderIntervalMinutes: 20, morning: { enabled: true }, afternoon: { enabled: true }, evening: { enabled: true } };

test("explicit photo verification wins and is carried unchanged into the reminder payload", () => {
  const card = { id: "writing", start: "19:00", end: "20:00", statGroup: "study", startVerification: { mode: "on", method: "photo", kind: "study_ready" }, snowdustReminder: { mode: "on", advanceMinutes: 3 } };
  const effective = resolveEffectiveReminderConfig({ card, globalSettings: settings, cardsOfStage: [card] });
  assert.deepEqual(effective.startVerification, { mode: "on", method: "photo", kind: "study_ready", source: "card", firstFollowUpMinutes: 10, reminderIntervalMinutes: 20 });
  const plan = buildReminderPlan({ localDate: "2026-07-29", cards: [card], deskVerification: settings });
  assert.equal(plan.reminders[0].startVerification.kind, "study_ready");
  assert.equal(plan.reminders[0].advanceMinutes, 3);
});

test("the first study card after dinner resolves as evening stage default", () => {
  const dinner = { id: "dinner", start: "18:10", end: "18:50", statGroup: "life", categoryId: "life.dinner" };
  const study = { id: "after-dinner-study", start: "19:00", end: "20:00", statGroup: "study" };
  const effective = resolveEffectiveReminderConfig({ card: study, globalSettings: settings, cardsOfStage: [dinner, study] });
  assert.equal(effective.stage, "evening");
  assert.equal(effective.startVerification.source, "stageDefault");
  assert.equal(effective.startVerification.kind, "study_ready");
  assert.equal(effective.startVerification.method, "photo");
});

test("a stage default is resolved only for that stage's first study card", () => {
  const first = { id: "first", start: "19:00", end: "20:00", statGroup: "study" };
  const later = { id: "later", start: "20:10", end: "21:00", statGroup: "study" };
  const cardsOfStage = [first, later];
  const firstResult = resolveEffectiveReminderConfig({ card: first, globalSettings: settings, cardsOfStage });
  const laterResult = resolveEffectiveReminderConfig({ card: later, globalSettings: settings, cardsOfStage });
  assert.equal(firstResult.startVerification.source, "stageDefault");
  assert.equal(firstResult.startVerification.mode, "on");
  assert.equal(laterResult.startVerification.mode, "off");
});

test("global advance applies only to inherited cards and explicit off overrides a stage default", () => {
  const inherited = { id: "inherit", start: "14:00", end: "15:00", statGroup: "study" };
  const disabled = { id: "off", start: "19:00", end: "20:00", statGroup: "study", startVerification: { mode: "off" }, snowdustReminder: { mode: "on", advanceMinutes: 2 } };
  const plan = buildReminderPlan({ localDate: "2026-07-29", cards: [inherited, disabled], deskVerification: settings });
  const byId = Object.fromEntries(plan.reminders.map((item) => [item.sourceCardId, item]));
  assert.equal(byId.inherit.advanceMinutes, 8);
  assert.equal(byId.off.advanceMinutes, 2);
  assert.equal(byId.off.startVerification, null);
  assert.equal(byId.off.startVerificationSource, "card");
});
