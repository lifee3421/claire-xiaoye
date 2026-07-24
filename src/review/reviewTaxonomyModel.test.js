import test from "node:test";
import assert from "node:assert/strict";
import {
  categoryEntryValue,
  setCategoryEntryField,
  hasCategoryEntryContent,
  getVisibleDynamicLeaves,
  getAddableDynamicLeaves,
  resolveDynamicDefaultMinutesForAdd,
  buildReviewTaxonomyModel,
  buildTaxonomySnapshot,
  getCategoryVisibility,
} from "./reviewTaxonomyModel.js";
import { createReviewDraft } from "./dailyReviewSchema.js";

const MISC_TAXONOMY = [
  {
    id: "misc", name: "杂项", children: [
      { id: "misc.diary", name: "写日记", children: [] }, // has a REVIEW_BINDINGS entry -> NOT dynamic
      { id: "misc.plantCare", name: "浇花", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 10 } },
      { id: "misc.archivedThing", name: "旧杂项", archived: true, children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 } },
    ],
  },
];

test("setCategoryEntryField + categoryEntryValue round-trip for a dynamic (unbound) leaf", () => {
  const draft = createReviewDraft("2026-07-24");
  const next = setCategoryEntryField(draft, "misc.plantCare", "duration", 15);
  assert.equal(categoryEntryValue(next, "misc.plantCare", "duration"), 15);
  assert.equal(hasCategoryEntryContent(next, "misc.plantCare"), true);
  assert.equal(hasCategoryEntryContent(next, "misc.otherThing"), false);
});

test("getAddableDynamicLeaves lists reviewConfig.enabled, non-archived, not-yet-visible dynamic leaves only — misc.diary (has a binding) is excluded", () => {
  const draft = createReviewDraft("2026-07-24");
  const addable = getAddableDynamicLeaves(MISC_TAXONOMY, "misc", draft);
  const ids = addable.map((node) => node.id);
  assert.deepEqual(ids, ["misc.plantCare"]);
});

test("getVisibleDynamicLeaves shows a leaf once it's added today, and hides it again once removed today — independent of profile", () => {
  const draft = createReviewDraft("2026-07-24");
  const added = { ...draft, ui: { ...draft.ui, categoryVisibility: { added: ["misc.plantCare"], hidden: [] } } };
  assert.deepEqual(getVisibleDynamicLeaves(MISC_TAXONOMY, "misc", added).map((n) => n.id), ["misc.plantCare"]);

  const removed = { ...draft, ui: { ...draft.ui, categoryVisibility: { added: ["misc.plantCare"], hidden: ["misc.plantCare"] } } };
  assert.deepEqual(getVisibleDynamicLeaves(MISC_TAXONOMY, "misc", removed), []);
});

test("getVisibleDynamicLeaves also shows a leaf purely from real content, with no draft.ui add needed", () => {
  const draft = createReviewDraft("2026-07-24");
  const withContent = setCategoryEntryField(draft, "misc.plantCare", "duration", 20);
  assert.deepEqual(getVisibleDynamicLeaves(MISC_TAXONOMY, "misc", withContent).map((n) => n.id), ["misc.plantCare"]);
});

test("archived dynamic leaves are hidden for a new (non-historical) date even if added, but stay visible on a historical date with a real record", () => {
  const draft = createReviewDraft("2026-07-24");
  const added = { ...draft, ui: { ...draft.ui, categoryVisibility: { added: ["misc.archivedThing"], hidden: [] } } };
  assert.deepEqual(getVisibleDynamicLeaves(MISC_TAXONOMY, "misc", added, { isHistoricalDate: false }), []);

  const withHistory = setCategoryEntryField(draft, "misc.archivedThing", "duration", 5);
  assert.deepEqual(getVisibleDynamicLeaves(MISC_TAXONOMY, "misc", withHistory, { isHistoricalDate: true }).map((n) => n.id), ["misc.archivedThing"]);
  assert.deepEqual(getVisibleDynamicLeaves(MISC_TAXONOMY, "misc", withHistory, { isHistoricalDate: false }), []);
});

test("resolveDynamicDefaultMinutesForAdd applies defaultMinutes only when duration entry is currently empty", () => {
  const node = { id: "misc.plantCare", reviewConfig: { enabled: true, recordDuration: true, defaultMinutes: 10 } };
  const emptyDraft = createReviewDraft("2026-07-24");
  assert.equal(resolveDynamicDefaultMinutesForAdd(node, emptyDraft, "misc.plantCare"), 10);

  const filledDraft = setCategoryEntryField(emptyDraft, "misc.plantCare", "duration", 99);
  assert.equal(resolveDynamicDefaultMinutesForAdd(node, filledDraft, "misc.plantCare"), null);
});

test("buildReviewTaxonomyModel groups dynamic leaves by primary category, and lists archived-but-has-history nodes separately", () => {
  const draft = createReviewDraft("2026-07-24");
  const withHistory = setCategoryEntryField(draft, "misc.archivedThing", "duration", 5);
  const model = buildReviewTaxonomyModel({ taxonomy: MISC_TAXONOMY, draft: withHistory, reviewDate: "2026-07-20", isHistoricalDate: true });
  assert.deepEqual(model.categoryGroups.misc.map((n) => n.id), ["misc.archivedThing"]);
  assert.deepEqual(model.archivedWithHistory.map((n) => n.categoryId), ["misc.archivedThing"]);
});

test("buildTaxonomySnapshot only includes categoryReviewEntries that actually have content today, not the whole taxonomy", () => {
  const draft = createReviewDraft("2026-07-24");
  const withContent = setCategoryEntryField(draft, "misc.plantCare", "duration", 20);
  const withEmptyEntry = { ...withContent, categoryReviewEntries: { ...withContent.categoryReviewEntries, "misc.archivedThing": {} } };
  const snapshot = buildTaxonomySnapshot(MISC_TAXONOMY, withEmptyEntry);
  assert.deepEqual(snapshot, [{ categoryId: "misc.plantCare", name: "浇花", parentId: "misc", color: "", archived: false }]);
});

test("getCategoryVisibility defaults to empty added/hidden when draft.ui has none set yet", () => {
  const draft = createReviewDraft("2026-07-24");
  assert.deepEqual(getCategoryVisibility(draft), { added: [], hidden: [] });
});

test("getVisibleDynamicLeaves returns full nodes (with reviewConfig, not just flattened tree rows)", () => {
  const draft = createReviewDraft("2026-07-24");
  const withContent = setCategoryEntryField(draft, "misc.plantCare", "duration", 5);
  const [node] = getVisibleDynamicLeaves(MISC_TAXONOMY, "misc", withContent);
  assert.equal(node.id, "misc.plantCare");
  assert.deepEqual(node.reviewConfig, { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 10 });
  assert.equal(node.parentId, "misc");
});
