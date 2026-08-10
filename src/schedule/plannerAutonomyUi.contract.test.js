import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

test("planner advanced settings exposes persistent Snow-dust planning rules", () => {
  assert.match(appSource, /雪尘排程规则/);
  assert.match(appSource, /snowdustPlannerRules/);
  assert.match(appSource, /雪尘排程规则已保存/);
});
