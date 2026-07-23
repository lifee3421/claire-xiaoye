import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_TAXONOMY_V3,
  LEGACY_CATEGORY_ALIASES,
  normalizeCategoryId,
  mergeLiveTaxonomyWithCanonical,
  buildThreeWayTaxonomyDiff,
  flattenTaxonomy,
} from "./taxonomyContract.js";

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
