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
  sumDynamicDurationByPrimary,
  sumDynamicDurationForPrimary,
  buildStudyGroupsFromTaxonomy,
  listAllStudyLeavesFromTaxonomy,
  buildStudyGroupTotals,
  sumAllStudyMinutes,
  sumStudyGroupMinutes,
} from "./reviewTaxonomyModel.js";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { CANONICAL_TAXONOMY_V3 } from "../taxonomy/taxonomyContract.js";

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

test("sumDynamicDurationByPrimary sums categoryReviewEntries duration grouped by primary (level-1) taxonomy id", () => {
  const taxonomy = [
    { id: "misc", name: "杂项", children: [
      { id: "misc.plantCare", name: "浇花", children: [] },
      { id: "misc.other2", name: "其他二", children: [] },
    ] },
    { id: "work", name: "工作", children: [{ id: "work.sideProject", name: "副业", children: [] }] },
  ];
  let draft = createReviewDraft("2026-07-24");
  draft = setCategoryEntryField(draft, "misc.plantCare", "duration", 40);
  draft = setCategoryEntryField(draft, "misc.other2", "duration", 5);
  draft = setCategoryEntryField(draft, "work.sideProject", "duration", 20);
  const totals = sumDynamicDurationByPrimary(taxonomy, draft);
  assert.deepEqual(totals, { misc: 45, work: 20 });
});

test("sumDynamicDurationForPrimary returns 0 when there are no dynamic entries under that primary", () => {
  const taxonomy = [{ id: "misc", name: "杂项", children: [{ id: "misc.plantCare", name: "浇花", children: [] }] }];
  const draft = createReviewDraft("2026-07-24");
  assert.equal(sumDynamicDurationForPrimary(taxonomy, draft, "misc"), 0);
});

test("dynamic leaves work under 'entertainment' even though it is a LEVEL-2 node (nested under the level-1 'rest') in CANONICAL_TAXONOMY_V3, not a top-level primary", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const rest = taxonomy.find((n) => n.id === "rest");
  const entertainment = rest.children.find((n) => n.id === "entertainment");
  entertainment.children.push({ id: "entertainment.boardGames", name: "桌游", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 } });

  const draft = createReviewDraft("2026-07-24");
  const addable = getAddableDynamicLeaves(taxonomy, "entertainment", draft);
  assert.deepEqual(addable.map((n) => n.id), ["entertainment.boardGames"], "must find the leaf by searching the whole tree, not just top-level children");

  const withContent = setCategoryEntryField(draft, "entertainment.boardGames", "duration", 25);
  const visible = getVisibleDynamicLeaves(taxonomy, "entertainment", withContent);
  assert.deepEqual(visible.map((n) => n.id), ["entertainment.boardGames"]);

  const totals = sumDynamicDurationByPrimary(taxonomy, withContent);
  assert.equal(totals.entertainment, 25, "must bucket under the 'entertainment' anchor id, not 'rest'");
  assert.equal(totals.rest, undefined);
});

// ---------------------------------------------------------------------------
// buildStudyGroupsFromTaxonomy / listAllStudyLeavesFromTaxonomy
// (2026-07-24 audit: taxonomy must be authoritative for EXISTING bound study
// leaves too — order/name/color/archived/enabled, not just brand-new ones.)
// ---------------------------------------------------------------------------

test("buildStudyGroupsFromTaxonomy derives group/leaf order, name and color from taxonomy, using REVIEW_BINDINGS only to resolve field ids for bound leaves", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.linearAlgebra.duration"].value = 45;
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, defaultLeafIds: [], draftAdded: [], draftHidden: [] });
  const mathGroup = groups.find((g) => g.id === "study.math");
  assert.ok(mathGroup, "math group must exist, derived from the taxonomy node");
  const linearAlgebra = mathGroup.items.find((i) => i.id === "study.math.linearAlgebra");
  assert.ok(linearAlgebra, "must be visible because it has real content");
  assert.equal(linearAlgebra.durationId, "study.math.linearAlgebra.duration");
  assert.equal(linearAlgebra.dynamic, false);
});

test("buildStudyGroupsFromTaxonomy: renaming a study leaf in taxonomy changes its displayed title immediately", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const mathNode = taxonomy.find((n) => n.id === "study").children.find((n) => n.id === "study.math");
  const linearAlgebraNode = mathNode.children.find((n) => n.id === "study.math.linearAlgebra");
  linearAlgebraNode.name = "线代（改名）";
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.linearAlgebra.duration"].value = 10;
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, defaultLeafIds: [], draftAdded: [], draftHidden: [] });
  const item = groups.find((g) => g.id === "study.math").items.find((i) => i.id === "study.math.linearAlgebra");
  assert.equal(item.title, "线代（改名）");
});

test("buildStudyGroupsFromTaxonomy: archiving a study leaf in taxonomy hides it on a new (non-historical) date even though it has content, but keeps it on a historical date", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const mathNode = taxonomy.find((n) => n.id === "study").children.find((n) => n.id === "study.math");
  const linearAlgebraNode = mathNode.children.find((n) => n.id === "study.math.linearAlgebra");
  linearAlgebraNode.archived = true;
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.linearAlgebra.duration"].value = 45;

  const newDateGroups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, isHistoricalDate: false });
  const newDateMath = newDateGroups.find((g) => g.id === "study.math");
  assert.ok(!newDateMath || !newDateMath.items.some((i) => i.id === "study.math.linearAlgebra"), "archived leaf must not show on a new date");

  const historicalGroups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, isHistoricalDate: true });
  const historicalMath = historicalGroups.find((g) => g.id === "study.math");
  assert.ok(historicalMath.items.some((i) => i.id === "study.math.linearAlgebra"), "archived leaf with a real record must still show on a historical date");
});

test("buildStudyGroupsFromTaxonomy: a bound leaf pinned via the LEGACY leafKey (profile.dailyReviewUi.defaultStudyLeaves, e.g. 'math.linearAlgebra') still shows even with no content — backward compatible, no key migration needed", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, defaultLeafIds: ["math.linearAlgebra"] });
  const item = groups.find((g) => g.id === "study.math")?.items.find((i) => i.id === "study.math.linearAlgebra");
  assert.ok(item, "pinned via legacy leafKey must still show with zero content");
});

test("buildStudyGroupsFromTaxonomy: single-child-less level-2 nodes (study.japanese, study.reading) become their own one-item group, exactly like the old STUDY_LEAF_GROUPS shape", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.japanese.totalMinutes"].value = 30;
  draft.fields["study.reading.totalMinutes"].value = 20;
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft });
  const japanese = groups.find((g) => g.id === "study.japanese");
  assert.ok(japanese, "study.japanese must be its own group");
  assert.equal(japanese.items.length, 1);
  assert.equal(japanese.items[0].durationId, "study.japanese.totalMinutes");

  const reading = groups.find((g) => g.id === "study.reading");
  assert.equal(reading.items[0].durationId, "study.reading.totalMinutes");
  assert.equal(reading.items[0].progressId, "study.reading.content");
});

test("buildStudyGroupsFromTaxonomy: a brand-new dynamic leaf added directly under study.math in taxonomy (no REVIEW_BINDINGS entry) renders through categoryReviewEntries, in the same group as the bound leaves", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const mathNode = taxonomy.find((n) => n.id === "study").children.find((n) => n.id === "study.math");
  mathNode.children.push({ id: "study.math.probability", name: "概率论", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } });
  let draft = createReviewDraft("2026-07-24");
  draft = setCategoryEntryField(draft, "study.math.probability", "duration", 30);
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft });
  const mathGroup = groups.find((g) => g.id === "study.math");
  const item = mathGroup.items.find((i) => i.id === "study.math.probability");
  assert.ok(item, "dynamic leaf under study.math must appear in the math group");
  assert.equal(item.dynamic, true);
  assert.equal(item.durationId, null);
});

test("listAllStudyLeavesFromTaxonomy returns every leaf (visible and hidden) with a visible flag, for the management panel / hidden-count badge", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  const all = listAllStudyLeavesFromTaxonomy({ taxonomy, draft });
  assert.ok(all.length > 5, "must list every leaf across every study group");
  assert.ok(all.every((leaf) => leaf.visible === false), "with no content and no pins, every leaf starts hidden");
  const linearAlgebra = all.find((leaf) => leaf.id === "study.math.linearAlgebra");
  assert.equal(linearAlgebra.groupId, "study.math");
});

// ---------------------------------------------------------------------------
// buildStudyGroupTotals / sumAllStudyMinutes / sumStudyGroupMinutes
// (single shared computation source for 学习总时长 / bar chart / per-group total)
// ---------------------------------------------------------------------------

test("sumStudyGroupMinutes shows a total even for a single-leaf group (math with only 高等数学 filled in)", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.calculus.duration"].value = 40;
  assert.equal(sumStudyGroupMinutes("study.math", { taxonomy, draft }), 40);
});

test("sumStudyGroupMinutes sums multiple leaves in the same group (calculus 40 + linearAlgebra 30 = 1h10min worth of minutes = 70)", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.calculus.duration"].value = 40;
  draft.fields["study.math.linearAlgebra.duration"].value = 30;
  assert.equal(sumStudyGroupMinutes("study.math", { taxonomy, draft }), 70);
});

test("sumStudyGroupMinutes also totals a single-leaf group with no tertiary children (study.japanese)", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.japanese.totalMinutes"].value = 25;
  assert.equal(sumStudyGroupMinutes("study.japanese", { taxonomy, draft }), 25);
});

test("buildStudyGroupTotals counts a leaf's value even when it is currently HIDDEN today — total must not silently drop already-recorded time", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.linearAlgebra.duration"].value = 30;
  draft.ui.studyLeafVisibility = { added: [], hidden: ["math.linearAlgebra"] };
  // Confirm it's really hidden from the rendered groups...
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, draftHidden: draft.ui.studyLeafVisibility.hidden });
  const mathGroup = groups.find((g) => g.id === "study.math");
  assert.ok(!mathGroup || !mathGroup.items.some((i) => i.id === "study.math.linearAlgebra"));
  // ...but the total still counts it.
  assert.equal(sumStudyGroupMinutes("study.math", { taxonomy, draft }), 30);
});

test("sumAllStudyMinutes equals the sum of every buildStudyGroupTotals entry — the same source backs both the top metric and each group total, never three separate sums", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.calculus.duration"].value = 40;
  draft.fields["study.english.vocabulary.duration"].value = 15;
  draft.fields["study.japanese.totalMinutes"].value = 25;
  const totals = buildStudyGroupTotals({ taxonomy, draft });
  const sumOfGroups = Object.values(totals).reduce((sum, v) => sum + v, 0);
  assert.equal(sumAllStudyMinutes({ taxonomy, draft }), sumOfGroups);
  assert.equal(sumAllStudyMinutes({ taxonomy, draft }), 80);
});

test("buildStudyGroupTotals includes a dynamic (taxonomy-only) leaf added under study.math, without double-counting against the bound leaves", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const mathNode = taxonomy.find((n) => n.id === "study").children.find((n) => n.id === "study.math");
  mathNode.children.push({ id: "study.math.probability", name: "概率论", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 } });
  let draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.calculus.duration"].value = 40;
  draft = setCategoryEntryField(draft, "study.math.probability", "duration", 20);
  assert.equal(sumStudyGroupMinutes("study.math", { taxonomy, draft }), 60);
});

test("buildStudyGroupsFromTaxonomy: a leaf added TODAY (draft.ui.studyLeafVisibility.added, e.g. right after clicking '添加今日学习项') stays visible even while all three of its fields are still empty — this is the literal 'fills in duration, item vanishes' scenario", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24");
  // Exactly what addStudyLeafToday("math.calculus") writes — duration/progress/adjustment
  // all still empty, only draft.ui.studyLeafVisibility.added has the leafKey.
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, draftAdded: ["math.calculus"] });
  const mathGroup = groups.find((g) => g.id === "study.math");
  assert.ok(mathGroup, "math group must be present");
  assert.ok(mathGroup.items.some((i) => i.id === "study.math.calculus"), "the just-added leaf must be visible with all-empty fields");

  // Filling in duration, then clearing progress/adjustment back to empty
  // (e.g. user typed then deleted) must not make it disappear either —
  // "added" always wins over content state.
  const draftAfterFillThenClear = { ...draft, fields: { ...draft.fields, "study.math.calculus.duration": { ...draft.fields["study.math.calculus.duration"], value: 40 } } };
  const stillThere = buildStudyGroupsFromTaxonomy({ taxonomy, draft: draftAfterFillThenClear, draftAdded: ["math.calculus"] });
  assert.ok(stillThere.find((g) => g.id === "study.math").items.some((i) => i.id === "study.math.calculus"));

  const clearedAgain = { ...draftAfterFillThenClear, fields: { ...draftAfterFillThenClear.fields, "study.math.calculus.duration": { ...draftAfterFillThenClear.fields["study.math.calculus.duration"], value: "" } } };
  const stillThereAfterClear = buildStudyGroupsFromTaxonomy({ taxonomy, draft: clearedAgain, draftAdded: ["math.calculus"] });
  assert.ok(stillThereAfterClear.find((g) => g.id === "study.math").items.some((i) => i.id === "study.math.calculus"), "clearing the value back to empty must not hide an explicitly-added leaf");
});

test("buildStudyGroupsFromTaxonomy: a DYNAMIC leaf added today via draft.ui.categoryVisibility also stays visible with all-empty fields, same guarantee as bound leaves", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const mathNode = taxonomy.find((n) => n.id === "study").children.find((n) => n.id === "study.math");
  mathNode.children.push({ id: "study.math.probability", name: "概率论", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } });
  const draft = createReviewDraft("2026-07-24");
  const withAdded = { ...draft, ui: { ...draft.ui, categoryVisibility: { added: ["study.math.probability"], hidden: [] } } };
  const groups = buildStudyGroupsFromTaxonomy({ taxonomy, draft: withAdded });
  const item = groups.find((g) => g.id === "study.math").items.find((i) => i.id === "study.math.probability");
  assert.ok(item, "the just-added dynamic leaf must be visible even with zero categoryReviewEntries content");
});
