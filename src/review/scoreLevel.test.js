import test from "node:test";
import assert from "node:assert/strict";
import { LEVEL_TO_SCORE, scoreToLevel } from "./scoreLevel.js";

test("scoreToLevel maps the 0-10 schema score onto a 1-5 UI level", () => {
  assert.equal(scoreToLevel(""), 0);
  assert.equal(scoreToLevel(undefined), 0);
  assert.equal(scoreToLevel(0), 0);
  assert.equal(scoreToLevel(1), 1);
  assert.equal(scoreToLevel(2), 1);
  assert.equal(scoreToLevel(3), 2);
  assert.equal(scoreToLevel(4), 2);
  assert.equal(scoreToLevel(6), 3);
  assert.equal(scoreToLevel(8), 4);
  assert.equal(scoreToLevel(10), 5);
  assert.equal(scoreToLevel(11), 5);
});

test("LEVEL_TO_SCORE round-trips back through scoreToLevel", () => {
  for (const level of [1, 2, 3, 4, 5]) {
    assert.equal(scoreToLevel(LEVEL_TO_SCORE[level]), level);
  }
});
