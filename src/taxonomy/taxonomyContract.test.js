import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_TAXONOMY_V3,
  LEGACY_CATEGORY_ALIASES,
  normalizeCategoryId,
  mergeLiveTaxonomyWithCanonical,
  buildThreeWayTaxonomyDiff,
  flattenTaxonomy,
  validateTaxonomyIntegrity,
  isLeafTaxonomyNode,
  defaultReviewConfig,
  inferReviewConfigFromBinding,
  normalizeReviewConfig,
  shouldShowTaxonomyNode,
  migrateLegacyReviewUiIntoTaxonomy,
} from "./taxonomyContract.js";

function findNode(taxonomy, id) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (node?.id === id) { found = node; return; }
    (Array.isArray(node?.children) ? node.children : []).forEach(visit);
  };
  taxonomy.forEach(visit);
  return found;
}

// Full realistic pre-migration live tree: a legacy secondary "math" (containing a
// legacy tertiary "study.math.linear" whose stored parentId is the OLD secondary id
// "math", exactly as App.jsx's normalizeClassificationTaxonomy would have persisted
// it before this phase), a legacy "english" with all four legacy kebab-case ielts
// children, and a legacy "economics" with corporate-finance/investment children.
const LEGACY_LIVE_FIXTURE = [
  { id: "study", name: "学习", color: "#111111", children: [
    { id: "math", name: "数学", keywords: "", color: "#222222", children: [
      { id: "study.math.calculus", name: "高等数学", keywords: "", parentId: "math" },
      { id: "study.math.linear", name: "线性代数", keywords: "", parentId: "math" },
    ] },
    { id: "english", name: "英语", keywords: "", color: "#333333", children: [
      { id: "study.english.ielts-writing", name: "雅思写作", keywords: "", parentId: "english" },
      { id: "study.english.ielts-reading", name: "雅思阅读", keywords: "", parentId: "english" },
      { id: "study.english.ielts-listening", name: "雅思听力", keywords: "", parentId: "english" },
      { id: "study.english.ielts-speaking", name: "雅思口语", keywords: "", parentId: "english" },
    ] },
    { id: "economics", name: "经济 / 专业课", keywords: "", color: "#444444", children: [
      { id: "study.professional.corporate-finance", name: "公司金融", keywords: "", parentId: "economics" },
      { id: "study.professional.investment", name: "投资学", keywords: "", parentId: "economics" },
    ] },
  ] },
];

test("mergeLiveTaxonomyWithCanonical: normalizes BOTH a node's own id and its stored parentId (not just id, masked by nesting)", () => {
  const { taxonomy, diff } = mergeLiveTaxonomyWithCanonical({ liveTaxonomy: LEGACY_LIVE_FIXTURE, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });

  const linearAlgebra = findNode(taxonomy, "study.math.linearAlgebra");
  assert.ok(linearAlgebra, "id itself must be canonicalized");
  assert.equal(linearAlgebra.parentId, "study.math", "parentId must be rewritten to the canonical parent id, not left as legacy 'math'");

  const calculus = findNode(taxonomy, "study.math.calculus");
  assert.equal(calculus.parentId, "study.math");

  ["study.english.ieltsWriting", "study.english.ieltsReading", "study.english.ieltsListening", "study.english.ieltsSpeaking"].forEach((id) => {
    const node = findNode(taxonomy, id);
    assert.ok(node, `${id} must exist`);
    assert.equal(node.parentId, "study.english", `${id}.parentId must be study.english`);
  });

  const corporateFinance = findNode(taxonomy, "study.professional.corporateFinance");
  assert.equal(corporateFinance.parentId, "study.professional");
  const investments = findNode(taxonomy, "study.professional.investments");
  assert.equal(investments.parentId, "study.professional");

  assert.ok(diff.normalizedParentIds.some((row) => row.nodeId === "study.math.linearAlgebra" && row.from === "math" && row.to === "study.math"));

  const check = validateTaxonomyIntegrity(taxonomy);
  assert.equal(check.ok, true, `parentId integrity check must pass: ${check.errors.join("; ")}`);
});

test("mergeLiveTaxonomyWithCanonical: parentId fix is idempotent across two runs", () => {
  const first = mergeLiveTaxonomyWithCanonical({ liveTaxonomy: LEGACY_LIVE_FIXTURE, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  const second = mergeLiveTaxonomyWithCanonical({ liveTaxonomy: first.taxonomy, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  assert.deepEqual(second.taxonomy, first.taxonomy);
  const linearAlgebra2 = findNode(second.taxonomy, "study.math.linearAlgebra");
  assert.equal(linearAlgebra2.parentId, "study.math");
  assert.equal(second.diff.normalizedParentIds.length, 0, "nothing left to normalize on the second run");
});

test("validateTaxonomyIntegrity: catches a manually-injected stale parentId instead of being fooled by nesting", () => {
  const brokenTaxonomy = [
    { id: "study", name: "学习", children: [
      { id: "study.math", name: "数学", children: [
        { id: "study.math.linearAlgebra", name: "线性代数", parentId: "math" }, // stale on purpose
      ] },
    ] },
  ];
  const check = validateTaxonomyIntegrity(brokenTaxonomy);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((message) => message.includes("study.math.linearAlgebra")));
});

test("validateTaxonomyIntegrity: detects duplicate categoryIds", () => {
  const dupTaxonomy = [
    { id: "study", name: "学习", children: [
      { id: "study.math", name: "数学 A", children: [] },
      { id: "study.math", name: "数学 B（重复）", children: [] },
    ] },
  ];
  const check = validateTaxonomyIntegrity(dupTaxonomy);
  assert.equal(check.ok, false);
  assert.ok(check.duplicateIds.includes("study.math"));
});

test("validateTaxonomyIntegrity: expectedTotalNodeCount / legacy-absent / custom-present checks", () => {
  const { taxonomy } = mergeLiveTaxonomyWithCanonical({ liveTaxonomy: LEGACY_LIVE_FIXTURE, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  const okCheck = validateTaxonomyIntegrity(taxonomy, {
    expectedLegacyIdsAbsent: ["math", "english", "economics"],
    expectedTotalNodeCount: flattenTaxonomy(taxonomy).length,
  });
  assert.equal(okCheck.ok, true, okCheck.errors.join("; "));

  const failCheck = validateTaxonomyIntegrity(taxonomy, {
    expectedLegacyIdsAbsent: ["math"],
    expectedCustomIdsPresent: ["this-custom-id-does-not-exist"],
    expectedTotalNodeCount: 999999,
  });
  assert.equal(failCheck.ok, false);
  assert.ok(failCheck.errors.some((message) => message.includes("this-custom-id-does-not-exist")));
  assert.ok(failCheck.errors.some((message) => message.includes("999999")));
});

test("normalizeCategoryId: legacy math -> study.math", () => {
  assert.equal(normalizeCategoryId("math"), "study.math");
});

test("normalizeCategoryId: legacy english -> study.english", () => {
  assert.equal(normalizeCategoryId("english"), "study.english");
});

test("normalizeCategoryId: legacy reading -> study.reading", () => {
  assert.equal(normalizeCategoryId("reading"), "study.reading");
});

test("normalizeCategoryId: study.math.linear -> study.math.linearAlgebra", () => {
  assert.equal(normalizeCategoryId("study.math.linear"), "study.math.linearAlgebra");
});

test("normalizeCategoryId: kebab-case ielts legacy ids -> camelCase canonical ids", () => {
  assert.equal(normalizeCategoryId("study.english.ielts-writing"), "study.english.ieltsWriting");
  assert.equal(normalizeCategoryId("study.english.ielts-reading"), "study.english.ieltsReading");
  assert.equal(normalizeCategoryId("study.english.ielts-listening"), "study.english.ieltsListening");
  assert.equal(normalizeCategoryId("study.english.ielts-speaking"), "study.english.ieltsSpeaking");
});

test("normalizeCategoryId: unrecognized/custom ids pass through unchanged", () => {
  assert.equal(normalizeCategoryId("my-own-custom-category"), "my-own-custom-category");
  assert.equal(normalizeCategoryId(""), "");
  assert.equal(normalizeCategoryId(undefined), "");
});

test("mergeLiveTaxonomyWithCanonical: preserves user-customized name/color/keywords/order on matched nodes", () => {
  const liveTaxonomy = [
    { id: "study", name: "学习", color: "#111111", order: 5, children: [
      { id: "math", name: "我的数学", color: "#222222", keywords: "自定义关键词", order: 3, children: [] },
    ] },
  ];
  const { taxonomy } = mergeLiveTaxonomyWithCanonical({ liveTaxonomy, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  const study = taxonomy.find((node) => node.id === "study");
  assert.equal(study.name, "学习");
  assert.equal(study.color, "#111111");
  const math = study.children.find((node) => node.id === "study.math");
  assert.ok(math, "legacy 'math' node id must be normalized to study.math");
  assert.equal(math.name, "我的数学", "user-customized name must be preserved, not overwritten by canonical default");
  assert.equal(math.color, "#222222", "user-customized color must be preserved");
  assert.equal(math.keywords, "自定义关键词", "user-customized keywords must be preserved");
});

test("mergeLiveTaxonomyWithCanonical: keeps unrecognized custom nodes instead of deleting them", () => {
  const liveTaxonomy = [
    { id: "study", name: "学习", children: [
      { id: "my-totally-custom-subject", name: "我自己发明的学科", keywords: "custom", children: [] },
    ] },
  ];
  const { taxonomy, diff } = mergeLiveTaxonomyWithCanonical({ liveTaxonomy, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  const study = taxonomy.find((node) => node.id === "study");
  const custom = study.children.find((node) => node.id === "my-totally-custom-subject");
  assert.ok(custom, "unrecognized custom node must be preserved, never deleted");
  assert.equal(custom.name, "我自己发明的学科");
  assert.ok(diff.unknownLiveNodes.some((row) => row.id === "my-totally-custom-subject"));
});

test("mergeLiveTaxonomyWithCanonical: adds missing v3 nodes (hobby, work, project, family, misc, social, study.japanese)", () => {
  const { taxonomy } = mergeLiveTaxonomyWithCanonical({ liveTaxonomy: [], canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  const ids = flattenTaxonomy(taxonomy).map((row) => row.id);
  ["hobby", "hobby.creativeWriting", "hobby.music.singing", "hobby.music.guitar", "hobby.crafts.perlerBeads", "work", "work.redCross", "work.partyYouth", "project", "project.personalManagement", "family", "misc", "misc.diary", "social", "study.japanese"].forEach((id) => {
    assert.ok(ids.includes(id), `expected canonical id ${id} to be present after merge`);
  });
});

test("mergeLiveTaxonomyWithCanonical: is idempotent — merging the output again changes nothing further", () => {
  const liveTaxonomy = [
    { id: "study", name: "学习", children: [
      { id: "math", name: "我的数学", keywords: "自定义", children: [
        { id: "study.math.linear", name: "线代", keywords: "" },
      ] },
    ] },
  ];
  const first = mergeLiveTaxonomyWithCanonical({ liveTaxonomy, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  const second = mergeLiveTaxonomyWithCanonical({ liveTaxonomy: first.taxonomy, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  assert.deepEqual(second.taxonomy, first.taxonomy);
  assert.equal(second.diff.addedNodes.length, 0, "second run should add nothing new");
  assert.equal(second.diff.normalizedIds.length, 0, "second run should find nothing left to normalize");
});

test("mergeLiveTaxonomyWithCanonical: never mutates its input arguments", () => {
  const liveTaxonomy = [{ id: "math", name: "数学", children: [] }];
  const snapshot = JSON.parse(JSON.stringify(liveTaxonomy));
  mergeLiveTaxonomyWithCanonical({ liveTaxonomy, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  assert.deepEqual(liveTaxonomy, snapshot, "merge must be a pure function, never mutating its inputs");
});

test("buildThreeWayTaxonomyDiff: reports live-only, canonical-new, and legacy-id findings without writing anything (pure computation, no I/O)", () => {
  const liveTaxonomy = [{ id: "math", name: "数学", children: [] }];
  const diff = buildThreeWayTaxonomyDiff({ liveTaxonomy, defaultTaxonomy: [], canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });
  assert.ok(diff.legacyIdsFoundInLive.some((row) => row.from === "math" && row.to === "study.math"));
  assert.ok(diff.canonicalNodesMissingFromLive.some((row) => row.id === "hobby"));
  assert.equal(typeof diff.generatedAt, "string");
});

test("LEGACY_CATEGORY_ALIASES does not include entertainment.creativeWriting (superseded by hobby.creativeWriting, not aliased)", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_ALIASES, "entertainment.creative-writing"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_ALIASES, "entertainment.creativeWriting"), false);
});

test("CANONICAL_TAXONOMY_V3: 写小说 lives under hobby, 看小说 under entertainment — never merged", () => {
  const ids = flattenTaxonomy(CANONICAL_TAXONOMY_V3).map((row) => row.id);
  assert.ok(ids.includes("hobby.creativeWriting"));
  assert.ok(ids.includes("entertainment.novel"));
  assert.equal(ids.includes("entertainment.creativeWriting"), false, "entertainment.creativeWriting must not exist in v3");
});

test("CANONICAL_TAXONOMY_V3: social exists as an empty placeholder primary", () => {
  const social = CANONICAL_TAXONOMY_V3.find((node) => node.id === "social");
  assert.ok(social);
  assert.deepEqual(social.children, []);
});

test("end-to-end migration-apply pipeline: mergeDiff-derived expectations pass validateTaxonomyIntegrity on the merge output, exactly as TaxonomyMigrationPanel does before showing 'verified'", () => {
  // Representative fixture (not Claire's real data — this session has no Firestore
  // access) exercising the same expectation-derivation the panel performs:
  // expectedLegacyIdsAbsent from mergeDiff.normalizedIds, expectedCustomIdsPresent
  // from mergeDiff.unknownLiveNodes, expectedTotalNodeCount from the merged tree.
  const customNodes = Array.from({ length: 4 }, (_, index) => ({ id: `my-custom-${index}`, name: `自定义 ${index}`, children: [] }));
  const liveTaxonomy = [
    { id: "study", name: "学习", children: [
      { id: "math", name: "数学", children: [] }, // legacy
      { id: "reading", name: "阅读", children: [] }, // legacy
      ...customNodes,
    ] },
  ];

  const { taxonomy: mergedTaxonomy, diff: mergeDiff } = mergeLiveTaxonomyWithCanonical({ liveTaxonomy, canonicalTaxonomy: CANONICAL_TAXONOMY_V3 });

  const expectations = {
    expectedLegacyIdsAbsent: [...new Set(mergeDiff.normalizedIds.map((row) => row.from))],
    expectedCustomIdsPresent: mergeDiff.unknownLiveNodes.map((row) => row.normalizedId),
    expectedTotalNodeCount: flattenTaxonomy(mergedTaxonomy).length,
  };

  assert.deepEqual(expectations.expectedLegacyIdsAbsent.sort(), ["math", "reading"]);
  assert.equal(expectations.expectedCustomIdsPresent.length, 4);

  // The successful case: verifying the actual merge output against its own
  // derived expectations must pass.
  const okCheck = validateTaxonomyIntegrity(mergedTaxonomy, expectations);
  assert.equal(okCheck.ok, true, okCheck.errors.join("; "));

  // The failure case: verifying a tree that lost a custom node (simulating a bad
  // write) against the SAME expectations must be caught, never silently pass.
  const corrupted = mergedTaxonomy.map((primary) => primary.id === "study"
    ? { ...primary, children: primary.children.filter((node) => node.id !== "my-custom-0") }
    : primary);
  const failCheck = validateTaxonomyIntegrity(corrupted, expectations);
  assert.equal(failCheck.ok, false);
  assert.ok(failCheck.errors.some((message) => message.includes("my-custom-0")));
});

test("isLeafTaxonomyNode treats missing children and empty children arrays as leaves, non-empty children as not", () => {
  assert.equal(isLeafTaxonomyNode({ id: "family" }), true);
  assert.equal(isLeafTaxonomyNode({ id: "family", children: [] }), true);
  assert.equal(isLeafTaxonomyNode({ id: "study", children: [{ id: "study.math" }] }), false);
});

test("inferReviewConfigFromBinding derives enabled/recordDuration/recordProgress/recordAdjustment from an existing REVIEW_BINDINGS entry", () => {
  const withProgress = inferReviewConfigFromBinding("study.math.linearAlgebra");
  assert.equal(withProgress.enabled, true);
  assert.equal(withProgress.recordDuration, true);
  assert.equal(withProgress.recordProgress, true);
  assert.equal(withProgress.recordAdjustment, false);

  const withAdjustment = inferReviewConfigFromBinding("work.redCross");
  assert.equal(withAdjustment.recordAdjustment, true);

  assert.deepEqual(inferReviewConfigFromBinding("no.such.category"), defaultReviewConfig());
});

test("normalizeReviewConfig sanitizes an existing reviewConfig without inventing new true flags, and is idempotent", () => {
  const node = { id: "custom.leaf", reviewConfig: { enabled: true, recordDuration: "yes", defaultMinutes: "45" } };
  const normalized = normalizeReviewConfig(node);
  assert.deepEqual(normalized, { enabled: true, recordDuration: false, recordProgress: false, recordAdjustment: false, defaultMinutes: 45 });
  const again = normalizeReviewConfig({ ...node, reviewConfig: normalized });
  assert.deepEqual(again, normalized);
});

test("normalizeReviewConfig falls back to binding inference when the node has no reviewConfig at all (pre-migration nodes)", () => {
  assert.deepEqual(normalizeReviewConfig({ id: "study.math.calculus" }), inferReviewConfigFromBinding("study.math.calculus"));
  assert.deepEqual(normalizeReviewConfig({ id: "brand.new.custom" }), defaultReviewConfig());
});

test("shouldShowTaxonomyNode hides archived nodes for new dates, but keeps showing them on historical dates that already have a record", () => {
  const archivedNode = { id: "work.redCross", archived: true };
  assert.equal(shouldShowTaxonomyNode({ node: archivedNode, isHistoricalDate: false, hasCurrentRecord: false }), false);
  assert.equal(shouldShowTaxonomyNode({ node: archivedNode, isHistoricalDate: true, hasCurrentRecord: false }), false);
  assert.equal(shouldShowTaxonomyNode({ node: archivedNode, isHistoricalDate: true, hasCurrentRecord: true }), true);
  assert.equal(shouldShowTaxonomyNode({ node: { id: "work.redCross", archived: false } }), true);
});

test("migrateLegacyReviewUiIntoTaxonomy converts archivedWorkGroups (by title) into archived:true on the matching work.* node by stable categoryId, never by fuzzy match", () => {
  const taxonomy = [
    { id: "work", name: "工作", children: [
      { id: "work.redCross", name: "红会", children: [] },
      { id: "work.partyYouth", name: "党团", children: [] },
    ] },
  ];
  const migrated = migrateLegacyReviewUiIntoTaxonomy({ taxonomy, archivedWorkGroups: ["红会"] });
  const redCross = migrated[0].children.find((node) => node.id === "work.redCross");
  const partyYouth = migrated[0].children.find((node) => node.id === "work.partyYouth");
  assert.equal(redCross.archived, true);
  assert.equal(redCross.enabled, false);
  assert.notEqual(partyYouth.archived, true); // untouched — not in archivedWorkGroups
});

test("migrateLegacyReviewUiIntoTaxonomy converts studyLeafDefaults (by leafKey) into reviewConfig.defaultMinutes on the matching study.* leaf by stable categoryId", () => {
  const taxonomy = [
    { id: "study", name: "学习", children: [
      { id: "study.math", name: "数学", children: [
        { id: "study.math.linearAlgebra", name: "线性代数" },
      ] },
    ] },
  ];
  const migrated = migrateLegacyReviewUiIntoTaxonomy({ taxonomy, studyLeafDefaults: { "math.linearAlgebra": { defaultMinutes: 30 } } });
  const leaf = migrated[0].children[0].children[0];
  assert.equal(leaf.reviewConfig.defaultMinutes, 30);
  assert.equal(leaf.reviewConfig.enabled, true); // inferred from REVIEW_BINDINGS, not clobbered
});

test("migrateLegacyReviewUiIntoTaxonomy is idempotent: running it twice (feeding its own output back in) produces an identical result", () => {
  const taxonomy = [
    { id: "work", name: "工作", children: [{ id: "work.redCross", name: "红会", children: [] }] },
    { id: "study", name: "学习", children: [{ id: "study.math", name: "数学", children: [{ id: "study.math.linearAlgebra", name: "线性代数" }] }] },
  ];
  const options = { archivedWorkGroups: ["红会"], studyLeafDefaults: { "math.linearAlgebra": { defaultMinutes: 30 } } };
  const once = migrateLegacyReviewUiIntoTaxonomy({ taxonomy, ...options });
  const twice = migrateLegacyReviewUiIntoTaxonomy({ taxonomy: once, ...options });
  assert.deepEqual(once, twice);
});

test("migrateLegacyReviewUiIntoTaxonomy never deletes or renames any node, and leaves nodes it doesn't recognize untouched", () => {
  const taxonomy = [{ id: "misc", name: "杂项", children: [{ id: "misc.diary", name: "写日记", children: [] }] }];
  const migrated = migrateLegacyReviewUiIntoTaxonomy({ taxonomy, archivedWorkGroups: ["红会"], studyLeafDefaults: {} });
  assert.deepEqual(migrated, taxonomy);
});
