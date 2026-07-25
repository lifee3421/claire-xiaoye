import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sumDynamicDurationByPrimary, sumAllStudyMinutes } from "./reviewTaxonomyModel.js";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { CANONICAL_TAXONOMY_V3 } from "../taxonomy/taxonomyContract.js";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "DailyReviewOverview.jsx");
const source = readFileSync(sourcePath, "utf8");

test("DailyReviewOverview.jsx wires taxonomy + sumDynamicDurationByPrimary into projectWorkTotal/hobbyTotal/entertainmentTotal/familyMiscTotal, and studyTotal through the unified sumAllStudyMinutes source", () => {
  assert.match(source, /sumDynamicDurationByPrimary/);
  assert.match(source, /sumAllStudyMinutes\(\{ taxonomy, draft \}\)/, "studyTotal must come from the same shared source StudyLeafGroupBlock uses, not a separate dynamicTotalsByAnchor.study addition");
  assert.match(source, /dynamicTotalsByAnchor\.project/);
  assert.match(source, /dynamicTotalsByAnchor\.work/);
  assert.match(source, /dynamicTotalsByAnchor\.hobby/);
  assert.match(source, /dynamicTotalsByAnchor\.entertainment/);
  assert.match(source, /dynamicTotalsByAnchor\.family/);
  assert.match(source, /dynamicTotalsByAnchor\.misc/);
  assert.match(source, /dynamicTotalsByAnchor\.life/, "生活 (life) must be its own bucket in the time-distribution overview, not folded into 家庭 / 杂项");
});

test("a custom dynamic leaf under 生活 (life) — e.g. 做饭 — feeds dynamicTotalsByAnchor.life, never dynamicTotalsByAnchor.misc, and is not double-counted", () => {
  const taxonomy = [{ id: "life", name: "生活", children: [
    { id: "secondary-1784951587521", name: "做饭", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } },
  ] }];
  const draft = createReviewDraft("2026-07-24");
  draft.categoryReviewEntries = {
    "secondary-1784951587521": { duration: { value: "", autoValue: 16, autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false } },
  };
  const totals = sumDynamicDurationByPrimary(taxonomy, draft);
  assert.equal(totals.life, 16);
  assert.equal(totals.misc, undefined, "做饭 must never also land in the misc bucket once it is a real 生活 leaf");
});

test("real 2026-07-24 regression: 数学242 + 英语152(单词7+听力39+写作56+口语50) + 日语9 + 娱乐15 + 生活16(做饭) = 434min = 7h14min, matching what DailyReviewOverview actually sums", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const life = taxonomy.find((node) => node.id === "life");
  life.children.push({ id: "secondary-1784951587521", name: "做饭", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } });

  const draft = createReviewDraft("2026-07-24");
  const focusField = (autoValue) => ({ value: "", autoValue, autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false });
  draft.fields = {
    ...draft.fields,
    "study.math.linearAlgebra.duration": focusField(242),
    "study.english.ieltsListening.duration": focusField(39),
    "study.english.ieltsWriting.duration": focusField(56),
    "study.english.ieltsSpeaking.duration": focusField(50),
    "study.english.vocabulary.duration": focusField(7),
    "study.japanese.totalMinutes": focusField(9),
    "entertainment.today.game.duration": focusField(15),
  };
  draft.categoryReviewEntries = {
    "secondary-1784951587521": { duration: focusField(16) },
  };

  const studyTotal = sumAllStudyMinutes({ taxonomy, draft });
  const dynamicTotals = sumDynamicDurationByPrimary(taxonomy, draft);
  const entertainmentTotal = Number(draft.fields["entertainment.today.game.duration"].autoValue) + (dynamicTotals.entertainment || 0);
  const lifeTotal = dynamicTotals.life || 0;

  assert.equal(studyTotal, 242 + 39 + 56 + 50 + 7 + 9, "study total must be 403min (6h43min)");
  assert.equal(entertainmentTotal, 15);
  assert.equal(lifeTotal, 16);
  assert.equal(studyTotal + entertainmentTotal + lifeTotal, 434, "grand total must be exactly 434min = 7h14min, matching the real Focus total");
});

test("a misc.water-plants-style dynamic entry with 40min duration is exactly what sumDynamicDurationByPrimary(taxonomy, draft).misc feeds into DailyReviewOverview's familyMiscTotal", () => {
  const taxonomy = [{ id: "misc", name: "杂项", children: [
    { id: "misc.diary", name: "写日记", children: [] },
    { id: "misc.water-plants", name: "阳台植物", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } },
  ] }];
  let draft = createReviewDraft("2026-07-24");
  draft.categoryReviewEntries = {
    "misc.water-plants": {
      duration: { value: 40, autoValue: 40, source: "manual", manuallyEdited: true },
      progress: { value: "给阳台植物浇水并修剪枯叶", autoValue: "", source: "manual", manuallyEdited: true },
    },
  };
  const totals = sumDynamicDurationByPrimary(taxonomy, draft);
  assert.equal(totals.misc, 40);
});

test("hiding a dynamic leaf today (draft.ui.categoryVisibility.hidden) does not remove it from the duration totals — only from the row's visibility", () => {
  const taxonomy = [{ id: "misc", name: "杂项", children: [
    { id: "misc.water-plants", name: "阳台植物", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } },
  ] }];
  const draft = createReviewDraft("2026-07-24");
  draft.categoryReviewEntries = { "misc.water-plants": { duration: { value: 40, autoValue: 40, source: "manual", manuallyEdited: true } } };
  draft.ui.categoryVisibility = { added: ["misc.water-plants"], hidden: ["misc.water-plants"] };
  const totals = sumDynamicDurationByPrimary(taxonomy, draft);
  assert.equal(totals.misc, 40, "hidden today does not mean excluded from stats");
});
