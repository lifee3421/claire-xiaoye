import test from "node:test";
import assert from "node:assert/strict";
import { previewFocusMapping, normalizeFocusMatchTextForUi, flattenFocusMatchLeaves } from "./focusMappingPreview.js";

function taxonomy() {
  return [
    {
      id: "study",
      name: "学习",
      children: [
        { id: "study.japanese", name: "日语", focusAliases: [] },
        { id: "study.math.linearAlgebra", name: "线性代数", focusAliases: ["线代", "Linear Algebra"] },
      ],
    },
    // misc is a real-world TOP-LEVEL node WITH a child (写日记) — never a
    // leaf itself. Kept this way deliberately (not simplified to a childless
    // leaf) so tests catch bugs where a bucket lookup only searches leaves.
    { id: "misc", name: "杂项", children: [{ id: "misc.diary", name: "写日记" }] },
    { id: "entertainment", name: "娱乐", children: [{ id: "entertainment.game", name: "游戏" }] },
  ];
}

test("normalizeFocusMatchTextForUi does trim + NFKC + whitespace-collapse + lowercase only, no substring/fuzzy behavior", () => {
  assert.equal(normalizeFocusMatchTextForUi("  Linear  Algebra  "), "linear algebra");
  assert.equal(normalizeFocusMatchTextForUi("线代"), "线代");
  assert.notEqual(normalizeFocusMatchTextForUi("线代"), normalizeFocusMatchTextForUi("线性代数"), "must not fold '线代' and '线性代数' together — no substring guessing");
});

test("title_exact: an exact leaf name match resolves with no list name needed", () => {
  const result = previewFocusMapping({ title: "日语", listName: "", taxonomy: taxonomy(), projectBucketMap: {} });
  assert.deepEqual(result, { categoryId: "study.japanese", categoryName: "日语", mappingSource: "title_exact", ambiguous: false });
});

test("title_alias_exact: a focusAlias resolves to its leaf, and a mere substring ('线代' inside '线性代数') never falsely matches the OTHER direction", () => {
  const result = previewFocusMapping({ title: "线代", listName: "", taxonomy: taxonomy(), projectBucketMap: {} });
  assert.equal(result.categoryId, "study.math.linearAlgebra");
  assert.equal(result.mappingSource, "title_alias_exact");
  // '线代' itself must not match via substring against unrelated leaves that merely contain the string.
  const noSubstring = previewFocusMapping({ title: "线", listName: "", taxonomy: taxonomy(), projectBucketMap: {} });
  assert.equal(noSubstring.categoryId, null);
});

test("case/full-width normalization: 'linear algebra' (lowercase, half-width) still matches the 'Linear Algebra' alias", () => {
  const result = previewFocusMapping({ title: "linear algebra", listName: "", taxonomy: taxonomy(), projectBucketMap: {} });
  assert.equal(result.categoryId, "study.math.linearAlgebra");
  assert.equal(result.mappingSource, "title_alias_exact");
});

test("project_bucket: no title match at all falls back to the configured list bucket", () => {
  const result = previewFocusMapping({ title: "做饭", listName: "Personal", taxonomy: taxonomy(), projectBucketMap: { personal: "misc" } });
  assert.deepEqual(result, { categoryId: "misc", categoryName: "杂项", mappingSource: "project_bucket", ambiguous: false });
});

test("project_bucket result shows the bucket's real display NAME even when the bucket target is a non-leaf node with children (e.g. 杂项/misc, which has a 写日记 child) — never the raw canonical id", () => {
  const result = previewFocusMapping({ title: "完全没人认识的任务", listName: "Personal", taxonomy: taxonomy(), projectBucketMap: { personal: "misc" } });
  assert.equal(result.categoryId, "misc");
  assert.equal(result.categoryName, "杂项", "must resolve the display name from ANY node in the tree, not just flattenFocusMatchLeaves' leaf-only list — misc has children and would never appear there");
  assert.notEqual(result.categoryName, "misc", "must never fall back to showing the raw canonical id to the user");
});

test("project bucket never overrides a more specific exact title match", () => {
  const result = previewFocusMapping({ title: "日语", listName: "Personal", taxonomy: taxonomy(), projectBucketMap: { personal: "misc" } });
  assert.equal(result.categoryId, "study.japanese", "an exact title match must win even though the list bucket points elsewhere");
});

test("misc_unclassified: no title match and no configured bucket for the list still returns a real (non-null) preview, never crashes", () => {
  const result = previewFocusMapping({ title: "完全无法识别的任务", listName: "SomeUnknownList", taxonomy: taxonomy(), projectBucketMap: {} });
  assert.equal(result.categoryId, null);
  assert.equal(result.mappingSource, "misc_unclassified");
  assert.equal(result.ambiguous, false);
});

test("ambiguous_title: two leaves normalize to the same title, and the list bucket doesn't narrow it — never guessed, candidates surfaced by name only", () => {
  const dupTaxonomy = [
    { id: "study", name: "学习", children: [{ id: "study.a", name: "复习" }] },
    { id: "hobby", name: "爱好", children: [{ id: "hobby.a", name: "复习" }] },
  ];
  const result = previewFocusMapping({ title: "复习", listName: "", taxonomy: dupTaxonomy, projectBucketMap: {} });
  assert.equal(result.categoryId, null);
  assert.equal(result.mappingSource, "ambiguous_title");
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.ambiguousCandidateNames.sort(), ["复习", "复习"]);
});

test("ambiguous title IS resolved when the list bucket narrows it to exactly one top-level branch", () => {
  const dupTaxonomy = [
    { id: "study", name: "学习", children: [{ id: "study.a", name: "复习" }] },
    { id: "hobby", name: "爱好", children: [{ id: "hobby.a", name: "复习" }] },
  ];
  const result = previewFocusMapping({ title: "复习", listName: "StudyList", taxonomy: dupTaxonomy, projectBucketMap: { studylist: "study" } });
  assert.equal(result.categoryId, "study.a");
  assert.equal(result.ambiguous, false);
});

test("empty title returns null (no preview to show) rather than a misleading result", () => {
  assert.equal(previewFocusMapping({ title: "   ", listName: "Personal", taxonomy: taxonomy(), projectBucketMap: {} }), null);
});

test("flattenFocusMatchLeaves excludes archived leaves from ordinary title matching", () => {
  const archivedTaxonomy = [{ id: "study", name: "学习", children: [{ id: "study.old", name: "旧课程", archived: true }] }];
  const leaves = flattenFocusMatchLeaves(archivedTaxonomy);
  assert.equal(leaves.length, 0);
  const result = previewFocusMapping({ title: "旧课程", listName: "", taxonomy: archivedTaxonomy, projectBucketMap: {} });
  assert.equal(result.categoryId, null, "an archived leaf's name must not resolve via the preview, matching Cyberboss's real matching rule");
});

test("preview never exposes taskId or any field beyond categoryId/categoryName/mappingSource/ambiguous(CandidateNames)", () => {
  const result = previewFocusMapping({ title: "日语", listName: "", taxonomy: taxonomy(), projectBucketMap: {} });
  assert.deepEqual(Object.keys(result).sort(), ["ambiguous", "categoryId", "categoryName", "mappingSource"]);
});
