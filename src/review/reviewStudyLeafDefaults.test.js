import test from "node:test";
import assert from "node:assert/strict";
import { resolveDefaultMinutesForAdd } from "./reviewStudyLeafDefaults.js";

test("resolveDefaultMinutesForAdd returns null with no configured default", () => {
  assert.equal(resolveDefaultMinutesForAdd("math.linearAlgebra", undefined, ""), null);
  assert.equal(resolveDefaultMinutesForAdd("math.linearAlgebra", {}, ""), null);
});

test("resolveDefaultMinutesForAdd only applies when the current value is empty", () => {
  const defaults = { "math.linearAlgebra": { defaultVisible: true, defaultMinutes: 80 } };
  assert.equal(resolveDefaultMinutesForAdd("math.linearAlgebra", defaults, ""), 80);
  assert.equal(resolveDefaultMinutesForAdd("math.linearAlgebra", defaults, 0), null);
  assert.equal(resolveDefaultMinutesForAdd("math.linearAlgebra", defaults, 30), null);
});

test("resolveDefaultMinutesForAdd does not apply to a leaf with no configured default even if others have one", () => {
  const defaults = { "math.linearAlgebra": { defaultMinutes: 80 } };
  assert.equal(resolveDefaultMinutesForAdd("english.vocabulary", defaults, ""), null);
});
