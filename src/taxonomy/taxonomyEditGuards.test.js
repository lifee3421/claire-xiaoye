import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaxonomyNameForDuplicateCheck, findDuplicateSiblingName, hasChildren, evaluateDeleteEligibility } from "./taxonomyEditGuards.js";

test("normalizeTaxonomyNameForDuplicateCheck folds case/full-width/whitespace, never substrings", () => {
  assert.equal(normalizeTaxonomyNameForDuplicateCheck("  做饭  "), "做饭");
  assert.equal(normalizeTaxonomyNameForDuplicateCheck("ＬＩＮＥＡＲ"), normalizeTaxonomyNameForDuplicateCheck("linear"), "full-width ASCII must fold to the same key as half-width, case-insensitively");
  assert.equal(normalizeTaxonomyNameForDuplicateCheck("Linear  Algebra"), "linear algebra");
  assert.notEqual(normalizeTaxonomyNameForDuplicateCheck("线代"), normalizeTaxonomyNameForDuplicateCheck("线性代数"), "must never treat a substring as a duplicate");
});

test("findDuplicateSiblingName detects a normalized-equal name among siblings, ignores the node itself when excludeId matches", () => {
  const siblings = [
    { id: "a", name: "做饭" },
    { id: "b", name: " 做饭 " },
  ];
  assert.equal(findDuplicateSiblingName(siblings, "做饭", null)?.id, "a", "must find the first matching sibling");
  assert.equal(findDuplicateSiblingName(siblings, "做饭", "a")?.id, "b", "excluding 'a' (e.g. renaming it) still finds 'b' as a real duplicate");
  assert.equal(findDuplicateSiblingName(siblings, "做饭", "b")?.id, "a", "excluding 'b' still finds 'a'");
});

test("findDuplicateSiblingName returns null for an empty name or no conflict", () => {
  assert.equal(findDuplicateSiblingName([{ id: "a", name: "做饭" }], "", null), null);
  assert.equal(findDuplicateSiblingName([{ id: "a", name: "做饭" }], "打扫", null), null);
});

test("hasChildren", () => {
  assert.equal(hasChildren({ children: [] }), false);
  assert.equal(hasChildren({ children: [{ id: "x" }] }), true);
  assert.equal(hasChildren({}), false);
});

test("evaluateDeleteEligibility: canonical categories are always archive-only", () => {
  const result = evaluateDeleteEligibility({ node: { id: "study", name: "学习", children: [] }, isCanonicalId: true, referencedTokens: new Set() });
  assert.equal(result.mode, "blocked_canonical");
});

test("evaluateDeleteEligibility: a node with children cannot be deleted, even if custom and unreferenced", () => {
  const result = evaluateDeleteEligibility({ node: { id: "custom.parent", name: "自定义父", children: [{ id: "custom.child" }] }, isCanonicalId: false, referencedTokens: new Set() });
  assert.equal(result.mode, "blocked_children");
});

test("evaluateDeleteEligibility: a referenced custom leaf is archive-only, not silently deleted", () => {
  const result = evaluateDeleteEligibility({ node: { id: "misc.cooking", name: "做饭", children: [] }, isCanonicalId: false, referencedTokens: new Set(["misc.cooking"]) });
  assert.equal(result.mode, "blocked_referenced");
});

test("evaluateDeleteEligibility: an unreferenced, childless, non-canonical leaf is safe to delete", () => {
  const result = evaluateDeleteEligibility({ node: { id: "misc.cooking2", name: "做饭2", children: [] }, isCanonicalId: false, referencedTokens: new Set(["misc.cooking"]) });
  assert.equal(result.mode, "delete");
});

test("evaluateDeleteEligibility: referencedTokens also matches by node.name, not just id", () => {
  const result = evaluateDeleteEligibility({ node: { id: "misc.cooking2", name: "做饭2", children: [] }, isCanonicalId: false, referencedTokens: new Set(["做饭2"]) });
  assert.equal(result.mode, "blocked_referenced");
});
