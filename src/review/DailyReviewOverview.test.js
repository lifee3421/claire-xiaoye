import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sumDynamicDurationByPrimary } from "./reviewTaxonomyModel.js";
import { createReviewDraft } from "./dailyReviewSchema.js";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "DailyReviewOverview.jsx");
const source = readFileSync(sourcePath, "utf8");

test("DailyReviewOverview.jsx wires taxonomy + sumDynamicDurationByPrimary into studyTotal/projectWorkTotal/hobbyTotal/entertainmentTotal/familyMiscTotal", () => {
  assert.match(source, /sumDynamicDurationByPrimary/);
  assert.match(source, /dynamicTotalsByAnchor\.study/);
  assert.match(source, /dynamicTotalsByAnchor\.project/);
  assert.match(source, /dynamicTotalsByAnchor\.work/);
  assert.match(source, /dynamicTotalsByAnchor\.hobby/);
  assert.match(source, /dynamicTotalsByAnchor\.entertainment/);
  assert.match(source, /dynamicTotalsByAnchor\.family/);
  assert.match(source, /dynamicTotalsByAnchor\.misc/);
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
