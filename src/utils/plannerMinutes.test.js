import assert from "node:assert/strict";
import test from "node:test";

import {
  getBlockActiveMinutes,
  getBlockBreakMinutes,
  getPureStudyMinutesFromBlock,
  summarizePlannerMinutes,
} from "./plannerMinutes.js";

const isStudyBlock = (block) =>
  block.categoryId === "math";

test("50+10 learning block counts only 50 study minutes", () => {
  const block = {
    kind: "task",
    categoryId: "math",
    start: 600,
    end: 660,
    studyMinutes: 50,
    breakMinutes: 10,
  };

  assert.equal(
    getBlockActiveMinutes(block),
    50,
  );

  assert.equal(
    getBlockBreakMinutes(block),
    10,
  );

  assert.equal(
    getPureStudyMinutesFromBlock(
      block,
      { isStudyBlock },
    ),
    50,
  );
});

test("preserves an explicit zero instead of falling back to footprint", () => {
  const block = {
    kind: "task",
    categoryId: "math",
    start: 600,
    end: 610,
    studyMinutes: 0,
    breakMinutes: 10,
  };

  assert.equal(
    getBlockActiveMinutes(block),
    0,
  );
});

test("falls back to footprint minus break when work minutes are absent", () => {
  const block = {
    kind: "task",
    categoryId: "math",
    start: 600,
    end: 660,
    breakMinutes: 10,
  };

  assert.equal(
    getBlockActiveMinutes(block),
    50,
  );
});

test("non-study task does not count as pure study", () => {
  const block = {
    kind: "task",
    categoryId: "exercise",
    start: 600,
    end: 650,
    studyMinutes: 40,
    breakMinutes: 10,
  };

  assert.equal(
    getPureStudyMinutesFromBlock(
      block,
      { isStudyBlock },
    ),
    0,
  );
});

test("summarizes pure study, breaks and non-study separately", () => {
  const result = summarizePlannerMinutes(
    [
      {
        kind: "task",
        categoryId: "math",
        start: 600,
        end: 660,
        studyMinutes: 50,
        breakMinutes: 10,
      },
      {
        kind: "task",
        categoryId: "exercise",
        start: 660,
        end: 710,
        studyMinutes: 40,
        breakMinutes: 10,
      },
    ],
    { isStudyBlock },
  );

  assert.deepEqual(result, {
    taskFootprintMinutes: 110,
    activeTaskMinutes: 90,
    pureStudyMinutes: 50,
    nonStudyActiveMinutes: 40,
    breakMinutes: 20,
  });
});
