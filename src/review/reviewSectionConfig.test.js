import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft } from "./dailyReviewSchema.js";
import {
  STUDY_SUMMARY_CONFIG,
  buildStudyDurationSummary,
  buildStudyProgressSummary,
  getStudyCompletion,
  summarizeGroup,
} from "./reviewSectionConfig.js";

function mathConfig() {
  return STUDY_SUMMARY_CONFIG.find((item) => item.id === "math");
}

function setField(draft, id, value) {
  draft.fields[id] = { ...draft.fields[id], value, autoValue: value };
}

test("buildStudyDurationSummary lists only non-zero duration fields, joined by ·, and falls back to a placeholder when empty", () => {
  const draft = createReviewDraft("2026-07-23", {});
  const config = mathConfig();

  assert.equal(buildStudyDurationSummary(config, draft), "尚未记录分项");

  setField(draft, "study.math.calculus.duration", 40);
  setField(draft, "study.math.linearAlgebra.duration", 20);

  assert.equal(
    buildStudyDurationSummary(config, draft),
    "高等数学 40min · 线性代数 20min"
  );
});

test("buildStudyProgressSummary lists only non-empty progress fields, joined by ；, and falls back to a placeholder when empty", () => {
  const draft = createReviewDraft("2026-07-23", {});
  const config = mathConfig();

  assert.equal(buildStudyProgressSummary(config, draft), "尚未填写推进");

  setField(draft, "study.math.calculus.progress", "第18讲微分中值定理部分");

  assert.equal(
    buildStudyProgressSummary(config, draft),
    "高等数学：第18讲微分中值定理部分"
  );
});

test("getStudyCompletion walks empty -> warning -> partial -> complete as fields fill in", () => {
  const draft = createReviewDraft("2026-07-23", {});
  const config = mathConfig();

  assert.equal(getStudyCompletion(config, draft).level, "empty");

  setField(draft, "study.math.calculus.duration", 40);
  assert.equal(getStudyCompletion(config, draft).level, "warning");

  setField(draft, "study.math.calculus.progress", "推进中");
  assert.equal(getStudyCompletion(config, draft).level, "partial");

  setField(draft, "study.math.adjustment", "明天继续");
  assert.equal(getStudyCompletion(config, draft).level, "complete");
});

test("summarizeGroup returns an empty-state shape for a missing group", () => {
  const summary = summarizeGroup(null, createReviewDraft("2026-07-23", {}));

  assert.deepEqual(summary, {
    total: 0,
    durationText: "0min",
    chips: [],
    narrative: "尚未填写",
  });
});

test("summarizeGroup builds chips from non-total duration fields and picks the first non-empty narrative field", () => {
  const draft = createReviewDraft("2026-07-23", {});
  setField(draft, "entertainment.today.wenyou.duration", 20);
  setField(draft, "entertainment.today.game.duration", 10);
  setField(draft, "entertainment.today.feeling", "放松");

  const group = {
    title: "今日娱乐",
    fields: [
      { id: "entertainment.today.totalMinutes", kind: "duration", label: "总时长" },
      { id: "entertainment.today.wenyou.duration", kind: "duration", label: "文游" },
      { id: "entertainment.today.game.duration", kind: "duration", label: "游戏" },
      { id: "entertainment.today.feeling", kind: "select", label: "娱乐感受" },
      { id: "entertainment.today.adjustment", kind: "text", label: "调整" },
    ],
  };

  const summary = summarizeGroup(group, draft);

  assert.deepEqual(
    summary.chips.map((chip) => [chip.label, chip.value]),
    [
      ["文游", "20min"],
      ["游戏", "10min"],
    ]
  );
  assert.equal(summary.narrative, "尚未填写");
});
