import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft, migrateFeatureDraft } from "./dailyReviewSchema.js";
import { applyAutomaticSleepDuration } from "./sleepDuration.js";
import { buildStructuredReview, buildReviewMarkdown } from "./reviewDraftSerializer.js";

test("sleep duration persists numeric and text values through structured review, markdown, and legacy reload", () => {
  let draft = createReviewDraft("2026-07-28");
  draft.fields["sleep.yesterday.bedtime"].value = "00:40";
  draft.fields["sleep.yesterday.wakeTime"].value = "08:10";
  draft = { ...draft, fields: applyAutomaticSleepDuration(draft.fields).fields };
  assert.equal(draft.fields["sleep.yesterday.durationMinutes"].value, 450);
  assert.equal(draft.fields["sleep.yesterday.durationText"].value, "7h30min");
  assert.match(buildReviewMarkdown(draft, {}), /睡眠时长：7h30min/);
  const structured = buildStructuredReview(draft, {});
  assert.equal(structured.fields["sleep.yesterday.durationMinutes"].value, 450);
  const reloaded = migrateFeatureDraft(JSON.parse(JSON.stringify(draft)));
  assert.equal(reloaded.fields["sleep.yesterday.durationMinutes"].value, 450);
  assert.equal(migrateFeatureDraft({ ...draft, fields: { ...draft.fields, "sleep.yesterday.durationMinutes": undefined, "sleep.yesterday.durationText": { value: "4h37min" } } }).fields["sleep.yesterday.durationText"].value, "4h37min");
});
