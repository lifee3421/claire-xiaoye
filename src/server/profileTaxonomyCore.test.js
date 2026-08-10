import test from "node:test";
import assert from "node:assert/strict";
import { validateClassificationTaxonomy } from "./profileTaxonomyCore.js";

test("accepts a normal nested classification taxonomy", () => {
  const result = validateClassificationTaxonomy([
    { id: "life", name: "生活", children: [
      { id: "life.nap", name: "午睡", color: "#ddd", children: [] },
    ] },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.nodeCount, 2);
  assert.notEqual(result.taxonomy, undefined);
});

test("rejects malformed taxonomy nodes", () => {
  assert.equal(validateClassificationTaxonomy({}).ok, false);
  assert.equal(validateClassificationTaxonomy([{ id: "life", name: "" }]).ok, false);
  assert.equal(validateClassificationTaxonomy([{ id: "life", name: "生活", children: {} }]).ok, false);
});
