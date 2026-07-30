import assert from "node:assert/strict";
import test from "node:test";
import { buildReminderPlan, normalizeStartVerification, resolveTimelineStartCheckDefaults, validateReminderPlan } from "./buildReminderPlan.js";

const meals = () => [{ id:"lunch", categoryId:"life.lunch", start:"12:10", end:"12:50" }, { id:"dinner", categoryId:"life.dinner", start:"18:00", end:"18:40" }];

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

test("migrated phase fixtures use actual meal boundaries and keep disabled phases off",()=>{const p=buildReminderPlan({localDate:"2026-07-25",deskVerification:{morning:{enabled:false},afternoon:{enabled:false},evening:{enabled:false}},cards:[...meals(),{id:"m",start:"09:00",end:"10:00",statGroup:"study"},{id:"m2",start:"10:20",end:"11:00",statGroup:"study"},{id:"a",start:"14:00",end:"15:00",statGroup:"study"},{id:"e",start:"19:00",end:"20:00",statGroup:"study"}]});const c=Object.fromEntries(p.cards.map(x=>[x.id,x]));assert.equal(c.m.studyStartVerification,null);assert.equal(c.m2.studyStartVerification,null);assert.equal(c.a.studyStartVerification,null);assert.equal(c.e.studyStartVerification,null);});

test("a card-level reminder and desk override beats phase defaults without enabling other middle cards", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-25", deskVerification: { afternoon: { enabled: false } }, cards: [...meals(),
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
  const card = [...meals(), { id: "study", start: "09:00", end: "10:00", statGroup: "study" }];
  const before = buildReminderPlan({ localDate: "2026-07-25", cards: card });
  const after = buildReminderPlan({ localDate: "2026-07-25", cards: card, deskVerification: { morning: { enabled: true }, firstFollowUpMinutes: 4, reminderIntervalMinutes: 11 } });
  assert.equal(before.cards[0].studyStartVerification.firstFollowUpMinutes, 10);
  assert.equal(after.cards[0].studyStartVerification.firstFollowUpMinutes, 4);
  assert.equal(after.cards[0].studyStartVerification.reminderIntervalMinutes, 11);
});

test("preview data carries the target date, reminder text, and desk-photo marker", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-27", revision: 9, cards: [...meals(), { id: "desk", title: "Math desk", start: "09:00", end: "10:00", statGroup: "study", snowdustReminder: { mode: "on", advanceMinutes: 6, note: "Open your math book" } }] });
  assert.equal(plan.localDate, "2026-07-27");
  assert.equal(plan.revision, 9);
  assert.equal(plan.reminders[0].text, "Open your math book");
  assert.equal(plan.reminders[0].advanceMinutes, 6);
  assert.equal(plan.reminders[0].studyStartVerification.required, true);
});

test("preview validation reads the generated reminder list and rejects only a true plan mismatch", () => {
  const plan = buildReminderPlan({ localDate: "2026-07-27", cards: [...meals(), { id: "desk", start: "09:00", end: "10:00", statGroup: "study" }] });
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

test("uses final lunch and dinner cards for phase defaults, never fixed clocks", () => {
  const plan = buildReminderPlan({ localDate:"2026-07-30", cards:[...meals(), {id:"morning",start:"11:50",end:"12:05",statGroup:"study"},{id:"afternoon",start:"13:00",end:"13:40",statGroup:"reading"},{id:"evening",start:"18:45",end:"19:30",statGroup:"study"}] });
  assert.deepEqual(plan.reminders.filter((x)=>x.requiresStartVerification).map((x)=>x.sourceCardId), ["morning","afternoon","evening"]);
  assert.deepEqual(plan.reminders.filter((x)=>x.requiresStartVerification).map((x)=>x.stage), ["morning","afternoon","evening"]);
});

test("exercise and long-rest defaults merge into one complete start verification", () => {
  const plan = buildReminderPlan({ localDate:"2026-07-30", cards:[...meals(), {id:"run",start:"09:00",end:"09:30",statGroup:"exercise"},{id:"study-a",start:"10:00",end:"10:50",statGroup:"study",breakMinutes:25},{id:"study-b",start:"11:15",end:"12:00",statGroup:"study"}] });
  const run=plan.reminders.find((x)=>x.sourceCardId==="run"); const b=plan.reminders.find((x)=>x.sourceCardId==="study-b");
  assert.equal(run.startVerification.kind,"exercise_ready"); assert.equal(run.requiresStartVerification,true);
  assert.deepEqual(b.startVerificationReasons,["long_rest_resume"]); assert.equal(plan.reminders.filter((x)=>x.sourceCardId==="study-b").length,1);
});

test("missing or invalid meal cards yield diagnostics without a fixed-time phase fallback", () => {
  const missing = buildReminderPlan({localDate:"2026-07-30",cards:[{id:"study",start:"09:00",end:"10:00",statGroup:"study"}]});
  assert.equal(missing.reminders.some((x)=>x.requiresStartVerification),false); assert.match(missing.diagnostics.warnings[0],/午餐和晚餐/);
  const invalid=resolveTimelineStartCheckDefaults([{id:"l",categoryId:"life.lunch",start:"12:00",end:"19:00"},{id:"d",categoryId:"life.dinner",start:"18:00",end:"19:00"}]);
  assert.equal(invalid.errors.length,1);
});

test("daily review follows its stable role and disappears when the card is absent", () => {
  const withReview=buildReminderPlan({localDate:"2026-07-30",cards:[...meals(),{id:"review",specialRole:"daily_review",start:"21:10",end:"21:30"}]});
  assert.equal(withReview.reminders.find((x)=>x.sourceCardId==="review").scheduledAt,"2026-07-30T21:05:00+08:00");
  assert.equal(buildReminderPlan({localDate:"2026-07-30",cards:meals()}).reminders.some((x)=>x.sourceCardId==="review"),false);
});

test("explicit off overrides exercise, long-rest and phase defaults", () => {
  const plan=buildReminderPlan({localDate:"2026-07-30",cards:[...meals(),{id:"exercise",start:"09:00",end:"09:30",statGroup:"exercise",startVerification:{mode:"off"} ,snowdustReminder:{mode:"off"}},{id:"a",start:"10:00",end:"10:30",statGroup:"study",breakMinutes:30},{id:"b",start:"11:00",end:"11:30",statGroup:"study",startVerification:{mode:"off"},snowdustReminder:{mode:"off"}}]});
  assert.equal(plan.reminders.some((x)=>x.sourceCardId==="exercise"),false); assert.equal(plan.reminders.some((x)=>x.sourceCardId==="b"),false);
});

test("only a 20-minute final-card break triggers and evening selects professional course, not IELTS", () => {
  const plan=buildReminderPlan({localDate:"2026-07-30",cards:[...meals(),{id:"ten",start:"09:00",end:"09:30",statGroup:"study",breakMinutes:10},{id:"after-ten",start:"09:40",end:"10:10",statGroup:"study"},{id:"ielts",title:"雅思单词",start:"17:00",end:"17:30",statGroup:"study"},{id:"professional",title:"专业课｜经济金融",start:"18:45",end:"19:30",statGroup:"study"}]});
  assert.equal(plan.reminders.find((x)=>x.sourceCardId==="after-ten"),undefined); const evening=plan.reminders.find((x)=>x.sourceCardId==="professional"); assert.equal(evening.stage,"evening"); assert.equal(evening.startVerificationReasons.includes("stage_first"),true);
});
