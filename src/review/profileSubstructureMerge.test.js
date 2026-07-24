// Section 6 audit (2026-07-24): profile.classificationTaxonomy,
// profile.dailyReviewUi, profile.periodCycle (and other existing profile
// settings) must never clobber each other when only one is being updated —
// neither via Firestore's merge:true (already true for disjoint top-level
// keys) NOR via the payload CONSTRUCTION itself in the app before it ever
// reaches Firestore. dataService.js/App.jsx aren't importable under plain
// `node --test` (Vite-only import.meta.env / JSX), so this file mirrors the
// exact construction patterns those call sites use (App.jsx's
// saveDailyReviewUi, TaxonomyManager's updateNode/mapTaxonomyNodes) as pure
// functions, and proves the pattern itself is merge-safe.
import test from "node:test";
import assert from "node:assert/strict";

// Mirrors DailyReviewWorkbench.jsx's saveDailyReviewUi: always spreads the
// full previous dailyReviewUi object before applying the partial patch, so
// any key not mentioned in `partial` survives untouched. The caller then
// sends { dailyReviewUi: next } as the ENTIRE settings payload — a single
// top-level key, never anything else alongside it.
function buildDailyReviewUiSavePayload(previousDailyReviewUi, partial) {
  return { dailyReviewUi: { ...previousDailyReviewUi, ...partial } };
}

// Mirrors App.jsx's TaxonomyManager updateNode + mapTaxonomyNodes: recursively
// walks the tree and only spreads `patch` onto the ONE matching node,
// preserving every other field on that node (and every other node) exactly.
function mapTaxonomyNodes(nodes = [], mapper) {
  return nodes.map((node) => mapper({ ...node, children: mapTaxonomyNodes(node.children || [], mapper) }));
}
function updateTaxonomyNode(taxonomy, id, patch) {
  return mapTaxonomyNodes(taxonomy, (node) => (node.id === id ? { ...node, ...patch } : node));
}

test("saveDailyReviewUi pattern: updating quickChoices preserves archivedWorkGroups/defaultStudyLeaves/studyLeafDefaults/quickDurationFields/pinnedStudySections untouched", () => {
  const previous = {
    archivedWorkGroups: ["党团"],
    defaultStudyLeaves: ["math.linearAlgebra"],
    studyLeafDefaults: { "math.linearAlgebra": { defaultMinutes: 30 } },
    quickDurationFields: { work: ["work.redCross.totalMinutes"] },
    pinnedStudySections: ["math"],
    quickChoices: { moodTags: ["开心"] },
  };
  const payload = buildDailyReviewUiSavePayload(previous, { quickChoices: { ...previous.quickChoices, bodyConditions: ["正常"] } });
  assert.deepEqual(Object.keys(payload), ["dailyReviewUi"]);
  assert.deepEqual(payload.dailyReviewUi.archivedWorkGroups, ["党团"]);
  assert.deepEqual(payload.dailyReviewUi.defaultStudyLeaves, ["math.linearAlgebra"]);
  assert.deepEqual(payload.dailyReviewUi.studyLeafDefaults, { "math.linearAlgebra": { defaultMinutes: 30 } });
  assert.deepEqual(payload.dailyReviewUi.quickDurationFields, { work: ["work.redCross.totalMinutes"] });
  assert.deepEqual(payload.dailyReviewUi.pinnedStudySections, ["math"]);
  assert.deepEqual(payload.dailyReviewUi.quickChoices, { moodTags: ["开心"], bodyConditions: ["正常"] });
});

test("saveDailyReviewUi pattern: setting a study leaf's defaultMinutes preserves every other leaf's defaultMinutes and every other dailyReviewUi key", () => {
  const previous = {
    archivedWorkGroups: [],
    defaultStudyLeaves: [],
    studyLeafDefaults: { "math.linearAlgebra": { defaultMinutes: 30 }, "english.ieltsWriting": { defaultMinutes: 45 } },
    quickChoices: { moodTags: ["开心"] },
  };
  const leafKey = "math.linearAlgebra";
  const nextStudyLeafDefaults = { ...previous.studyLeafDefaults, [leafKey]: { ...previous.studyLeafDefaults[leafKey], defaultMinutes: 60 } };
  const payload = buildDailyReviewUiSavePayload(previous, { studyLeafDefaults: nextStudyLeafDefaults });
  assert.equal(payload.dailyReviewUi.studyLeafDefaults["math.linearAlgebra"].defaultMinutes, 60);
  assert.equal(payload.dailyReviewUi.studyLeafDefaults["english.ieltsWriting"].defaultMinutes, 45, "sibling leaf's default must survive untouched");
  assert.deepEqual(payload.dailyReviewUi.quickChoices, { moodTags: ["开心"] });
});

test("updateTaxonomyNode pattern: patching one node's reviewConfig preserves its own name/color/keywords/order and every sibling/other node completely", () => {
  const taxonomy = [
    { id: "misc", name: "杂项", color: "#94A3B8", order: 5, children: [
      { id: "misc.diary", name: "写日记", keywords: "写日记,日记", order: 0, children: [] },
      { id: "misc.plantCare", name: "浇花", keywords: "植物", color: "#ABCDEF", order: 1, reviewConfig: { enabled: false, recordDuration: false, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 }, children: [] },
    ] },
  ];
  const patched = updateTaxonomyNode(taxonomy, "misc.plantCare", { reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 10 } });
  const plantCare = patched[0].children.find((n) => n.id === "misc.plantCare");
  assert.deepEqual(plantCare.reviewConfig, { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 10 });
  assert.equal(plantCare.name, "浇花", "name must survive untouched");
  assert.equal(plantCare.color, "#ABCDEF", "color must survive untouched");
  assert.equal(plantCare.keywords, "植物", "keywords must survive untouched");
  assert.equal(plantCare.order, 1, "order must survive untouched");

  const diary = patched[0].children.find((n) => n.id === "misc.diary");
  assert.deepEqual(diary, taxonomy[0].children[0], "sibling node must be byte-identical, untouched by the patch");

  assert.equal(patched[0].name, "杂项");
  assert.equal(patched[0].color, "#94A3B8");
  assert.equal(patched[0].order, 5);
});

test("updateTaxonomyNode pattern: archiving a node preserves reviewConfig and every other field on that same node", () => {
  const taxonomy = [{ id: "work", name: "工作", children: [
    { id: "work.redCross", name: "红会", color: "#4C6EF5", keywords: "红会", reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: true, defaultMinutes: 0 }, children: [] },
  ] }];
  const patched = updateTaxonomyNode(taxonomy, "work.redCross", { archived: true, archivedAt: "2026-07-24" });
  const redCross = patched[0].children[0];
  assert.equal(redCross.archived, true);
  assert.equal(redCross.archivedAt, "2026-07-24");
  assert.deepEqual(redCross.reviewConfig, { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: true, defaultMinutes: 0 });
  assert.equal(redCross.name, "红会");
  assert.equal(redCross.color, "#4C6EF5");
});

test("end-to-end sequence: applying all 5 update kinds (reviewConfig, quickChoices, periodCycle, taxonomy archive, study defaultMinutes) in a row against one starting profile leaves every OTHER field byte-identical at the end", () => {
  const startingProfile = {
    classificationTaxonomy: [
      { id: "work", name: "工作", children: [
        { id: "work.redCross", name: "红会", color: "#4C6EF5", children: [] },
      ] },
      { id: "misc", name: "杂项", children: [
        { id: "misc.plantCare", name: "浇花", reviewConfig: { enabled: false, recordDuration: false, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 }, children: [] },
      ] },
    ],
    dailyReviewUi: {
      archivedWorkGroups: [],
      defaultStudyLeaves: ["math.linearAlgebra"],
      studyLeafDefaults: { "math.linearAlgebra": { defaultMinutes: 30 } },
      quickChoices: { moodTags: ["开心"] },
    },
    periodCycle: { status: "inactive", startedOn: "", endedOn: "" },
    displayName: "Claire",
    points: 42,
    travelDayBonusPoints: 1,
  };

  // Simulate the demo-store / dataService merge semantics: each save only
  // ever touches its ONE top-level key, spread onto the current profile.
  let profile = startingProfile;
  const applySave = (settings) => { profile = { ...profile, ...settings }; };

  // 1. reviewConfig on misc.plantCare
  applySave({ classificationTaxonomy: updateTaxonomyNode(profile.classificationTaxonomy, "misc.plantCare", { reviewConfig: { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 15 } }) });
  // 2. quickChoices
  applySave(buildDailyReviewUiSavePayload(profile.dailyReviewUi, { quickChoices: { ...profile.dailyReviewUi.quickChoices, bodyConditions: ["正常"] } }));
  // 3. periodCycle
  applySave({ periodCycle: { status: "active", startedOn: "2026-07-24", endedOn: "" } });
  // 4. taxonomy archive (work.redCross)
  applySave({ classificationTaxonomy: updateTaxonomyNode(profile.classificationTaxonomy, "work.redCross", { archived: true, archivedAt: "2026-07-24" }) });
  // 5. study defaultMinutes
  applySave(buildDailyReviewUiSavePayload(profile.dailyReviewUi, { studyLeafDefaults: { ...profile.dailyReviewUi.studyLeafDefaults, "math.linearAlgebra": { defaultMinutes: 45 } } }));

  // Every update landed correctly...
  const plantCare = profile.classificationTaxonomy.find((p) => p.id === "misc").children.find((c) => c.id === "misc.plantCare");
  assert.equal(plantCare.reviewConfig.defaultMinutes, 15);
  assert.deepEqual(profile.dailyReviewUi.quickChoices, { moodTags: ["开心"], bodyConditions: ["正常"] });
  assert.equal(profile.periodCycle.status, "active");
  const redCross = profile.classificationTaxonomy.find((p) => p.id === "work").children.find((c) => c.id === "work.redCross");
  assert.equal(redCross.archived, true);
  assert.equal(profile.dailyReviewUi.studyLeafDefaults["math.linearAlgebra"].defaultMinutes, 45);

  // ...and nothing unrelated was clobbered along the way.
  assert.equal(redCross.name, "红会");
  assert.equal(redCross.color, "#4C6EF5");
  assert.deepEqual(profile.dailyReviewUi.archivedWorkGroups, []);
  assert.equal(profile.displayName, "Claire");
  assert.equal(profile.points, 42);
  assert.equal(profile.travelDayBonusPoints, 1);
});
