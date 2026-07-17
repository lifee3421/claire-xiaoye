import assert from "node:assert/strict";
import test from "node:test";
import { reviewValueLines, reviewValueText } from "./reviewValue.js";

test("normalizes review display values at rendering boundaries", () => {
  assert.deepEqual(reviewValueLines(["数学：极限", "线代：矩阵"]), ["数学：极限", "线代：矩阵"]);
  assert.deepEqual(reviewValueLines({ 高等数学: "极限", 线性代数: "矩阵" }), ["高等数学：极限", "线性代数：矩阵"]);
  assert.deepEqual(reviewValueLines("雅思写作"), ["雅思写作"]);
  assert.deepEqual(reviewValueLines(null), []);
  assert.equal(reviewValueText({ 公司金融: "净现值法" }), "公司金融：净现值法");
});
