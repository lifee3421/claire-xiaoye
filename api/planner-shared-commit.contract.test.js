import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("direct edit and proposal apply both delegate final schedule commit to canonicalPlannerCommit", () => {
  const direct = source("./planner-direct-edit.js");
  const apply = source("./planner-apply.js");

  assert.match(direct, /commitCanonicalDailyPlannerMutation/);
  assert.match(apply, /commitCanonicalDailyPlannerMutation/);
  assert.doesNotMatch(direct, /transaction\.set\(userRef/);
  assert.doesNotMatch(apply, /transaction\.set\(userRef/);
});
