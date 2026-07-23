import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { buildLegacyReviewValues, buildReviewMarkdown, buildStructuredReview } from "./reviewDraftSerializer.js";

test("Phase 1 structured draft preserves field state and generates compatibility values", () => {
  const draft = createReviewDraft("2026-07-23");
  draft.fields["study.math.总时长"].value = 120;
  draft.fields["study.english.总时长"].value = 60;
  draft.fields["work.redcross.总时长"].value = 50;
  draft.fields["entertainment.总时长"].value = 30;
  draft.fields["sleep.入睡时间"].value = "23:00";
  draft.fields["diary.正文"].value = "今天完成了复盘。";
  const legacy = buildLegacyReviewValues(draft);
  assert.equal(legacy.studyMinutes, 180);
  assert.equal(legacy.workMinutes, 50);
  assert.equal(legacy.totalEntertainmentMinutes, 30);
  assert.match(buildReviewMarkdown(draft), /今天完成了复盘/);
  assert.deepEqual(buildStructuredReview(draft).manualOverridePaths, []);
});
