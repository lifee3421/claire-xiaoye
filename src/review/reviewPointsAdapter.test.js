import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { buildSettlementInputFromReview } from "./reviewPointsAdapter.js";
import { CANONICAL_TAXONOMY_V3 } from "../taxonomy/taxonomyContract.js";

function focusField(autoValue) {
  return { value: "", autoValue, autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false };
}

test("structured review adapts its final values through the existing point functions", () => {
  const draft = createReviewDraft("2026-07-23");
  draft.fields["study.math.totalMinutes"].value = 120;
  draft.fields["work.redCross.totalMinutes"].value = 50;
  draft.fields["exercise.today.totalMinutes"].value = 30;
  draft.fields["exercise.today.intensity"].value = "低强度";
  draft.fields["sleep.yesterday.bedtime"].value = "23:00";
  draft.fields["entertainment.today.totalMinutes"].value = 30;

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-23");
  assert.equal(settlement.studyMinutes, 120);
  assert.equal(settlement.workMinutes, 50);
  assert.equal(settlement.exerciseIntensity, "low");
  assert.equal(settlement.sleepAdjustment, 2);
  assert.equal(settlement.reviewTimelinessBonus, 1);
  assert.ok(settlement.pointsAdded > 0);
});

test("A. Focus-only data (数学242 + 英语152 + 日语9 = 403min, all autoValue, none manually typed) => settlement.studyMinutes = 403, not 0", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.math.linearAlgebra.duration"] = focusField(242);
  draft.fields["study.english.ieltsListening.duration"] = focusField(39);
  draft.fields["study.english.ieltsWriting.duration"] = focusField(56);
  draft.fields["study.english.ieltsSpeaking.duration"] = focusField(50);
  draft.fields["study.english.vocabulary.duration"] = focusField(7);
  draft.fields["study.japanese.totalMinutes"] = focusField(9);

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-24", taxonomy);
  assert.equal(settlement.studyMinutes, 403, "39+56+50+7=152 english + 242 math + 9 japanese = 403");
});

test("B. 420min of Focus-only study => studyCredit=75, bankPointsAdded=7 (the real point formulas, now actually fed a non-zero studyMinutes)", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.math.linearAlgebra.duration"] = focusField(420);

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-24", taxonomy);
  assert.equal(settlement.studyMinutes, 420);
  assert.equal(settlement.studyCredit, 75);
  assert.equal(settlement.bankPointsAdded, 7);
});

test("C. manual override (autoValue=56, manuallyEdited=true, value=0) => settlement must use 0, never the Focus autoValue", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = { value: 0, autoValue: 56, autoValueSource: "ticktick_focus", source: "manual", manuallyEdited: true };

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-24", taxonomy);
  assert.equal(settlement.studyMinutes, 0, "a genuine manual 0 must be respected, not silently replaced by the Focus autoValue");
});

test("D. non-manual field (value=0, autoValue=56, autoValueSource=ticktick_focus, manuallyEdited=false) => settlement must use 56", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = { value: 0, autoValue: 56, autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false };

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-24", taxonomy);
  assert.equal(settlement.studyMinutes, 56, "a stray value=0 (never actually typed, manuallyEdited=false) must never mask a real Focus autoValue");
});

test("E. parent totalMinutes=0 (stale/default) while a child leaf has a real autoValue => parent group total (and thus settlement.studyMinutes) equals the child sum", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.math.totalMinutes"] = { value: 0, autoValue: 0, source: "default", manuallyEdited: false };
  draft.fields["study.math.linearAlgebra.duration"] = focusField(242);

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-24", taxonomy);
  assert.equal(settlement.studyMinutes, 242, "a stale parent value=0 must never override a real child autoValue sum");
});

test("real 2026-07-24 regression: 学习403 + 生活16(不计入studyMinutes) + 娱乐15 => settlement.studyMinutes=403, studyCredit and bankPointsAdded are non-zero", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const life = taxonomy.find((node) => node.id === "life");
  life.children.push({ id: "secondary-1784951587521", name: "做饭", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } });

  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.math.linearAlgebra.duration"] = focusField(242);
  draft.fields["study.english.ieltsListening.duration"] = focusField(39);
  draft.fields["study.english.ieltsWriting.duration"] = focusField(56);
  draft.fields["study.english.ieltsSpeaking.duration"] = focusField(50);
  draft.fields["study.english.vocabulary.duration"] = focusField(7);
  draft.fields["study.japanese.totalMinutes"] = focusField(9);
  draft.fields["entertainment.today.game.duration"] = focusField(15);
  draft.categoryReviewEntries = { "secondary-1784951587521": { duration: focusField(16) } };

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-07-24", taxonomy);
  assert.equal(settlement.studyMinutes, 403, "生活/做饭 must never leak into studyMinutes");
  assert.ok(settlement.studyCredit > 0, "学习积分不再为 0");
  assert.ok(settlement.bankPointsAdded > 0);
});

test("F. Keep-synced exercise.today.totalMinutes (autoValue=36, autoValueSource=keep_exercise) feeds settlement.exerciseIntensity/points exactly like a manual value — points math is unchanged by the sync source", () => {
  const draft = createReviewDraft("2026-08-04");
  draft.fields["exercise.today.totalMinutes"] = { value: "", autoValue: 36, autoValueSource: "keep_exercise", source: "default", manuallyEdited: false };
  draft.fields["exercise.today.activity"] = { value: "", autoValue: "燃脂派对 ×2、马甲线养成", autoValueSource: "keep_exercise", source: "default", manuallyEdited: false };
  // intensity is still the user's own manual choice — Keep sync never sets it.
  draft.fields["exercise.today.intensity"].value = "中高强度";

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-08-04");
  assert.equal(settlement.exerciseMinutes, 36, "the effective (Keep autoValue) minutes must reach settlement, exactly like a Focus autoValue would");
  assert.equal(settlement.exerciseIntensity, "medium_high");
});

test("G. a manual override of Keep's totalMinutes still wins over the Keep autoValue, same as it would for Focus", () => {
  const draft = createReviewDraft("2026-08-04");
  draft.fields["exercise.today.totalMinutes"] = { value: 45, autoValue: 36, autoValueSource: "keep_exercise", source: "manual", manuallyEdited: true };

  const settlement = buildSettlementInputFromReview(draft, {}, "2026-08-04");
  assert.equal(settlement.exerciseMinutes, 45, "a genuine manual override must win over the Keep autoValue");
});

test("travel-day setting remains opt-in and affects only the existing day classification", () => {
  const draft = createReviewDraft("2026-07-23");
  draft.fields["summary.isTravelDay"].value = "是";
  const settlement = buildSettlementInputFromReview(draft, { travelDayBonusPoints: 2 }, "2026-07-23");
  assert.equal(settlement.isTravelDay, true);
  assert.equal(settlement.travelDayBonusPoints, 2);
});
