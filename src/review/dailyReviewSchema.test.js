import test from "node:test";
import assert from "node:assert/strict";
import { reviewSections, otherSections, createReviewDraft } from "./dailyReviewSchema.js";

function findSection(title) {
  return reviewSections.find((section) => section.title === title);
}

function allFieldIds() {
  return [...reviewSections.flatMap((section) => section.groups.flatMap((group) => group.fields.map((field) => field.id))), ...otherSections.flatMap((section) => section.fields.map((field) => field.id))];
}

test("Hobby section exists with hobby.totalMinutes aggregating the four hobby duration fields", () => {
  const hobbySection = findSection("兴趣");
  assert.ok(hobbySection, "兴趣 section must exist");
  const totalField = hobbySection.groups[0].fields.find((field) => field.id === "hobby.totalMinutes");
  assert.ok(totalField);
  assert.deepEqual(totalField.parts, [
    "hobby.creativeWriting.duration",
    "hobby.music.singing.duration",
    "hobby.music.guitar.duration",
    "hobby.crafts.perlerBeads.duration",
  ]);
});

test("Hobby fields present: creativeWriting/music.singing/music.guitar/crafts.perlerBeads duration + progress", () => {
  const ids = allFieldIds();
  [
    "hobby.creativeWriting.duration", "hobby.creativeWriting.progress",
    "hobby.music.singing.duration", "hobby.music.singing.progress",
    "hobby.music.guitar.duration", "hobby.music.guitar.progress",
    "hobby.crafts.perlerBeads.duration", "hobby.crafts.perlerBeads.progress",
  ].forEach((id) => assert.ok(ids.includes(id), `expected field ${id}`));
});

test("entertainment.today.creativeWriting.duration must NOT exist — 写小说 belongs to hobby, not entertainment", () => {
  assert.equal(allFieldIds().includes("entertainment.today.creativeWriting.duration"), false);
});

test("misc.today.diary.duration exists and is a distinct field from misc.today.review.duration", () => {
  const ids = allFieldIds();
  assert.ok(ids.includes("misc.today.diary.duration"));
  assert.ok(ids.includes("misc.today.review.duration"));
  assert.notEqual("misc.today.diary.duration", "misc.today.review.duration");
});

test("misc.today.totalMinutes aggregates diary alongside the other misc parts", () => {
  const miscSection = findSection("杂项");
  const totalField = miscSection.groups[0].fields.find((field) => field.id === "misc.today.totalMinutes");
  assert.ok(totalField.parts.includes("misc.today.diary.duration"));
  assert.ok(totalField.parts.includes("misc.today.review.duration"));
});

test("createReviewDraft initializes hobby and diary fields to empty state (not pre-filled)", () => {
  const draft = createReviewDraft("2026-07-23", {});
  assert.equal(draft.fields["hobby.totalMinutes"].value, "");
  assert.equal(draft.fields["misc.today.diary.duration"].value, "");
  assert.equal(draft.fields["hobby.creativeWriting.progress"].value, "");
});

test("state.today.moodTag and state.today.bodyCondition are new tag-style fields, additive alongside the old 0-10 score fields", () => {
  const stateSection = otherSections.find((section) => section.title === "状态");
  const moodTag = stateSection.fields.find((field) => field.id === "state.today.moodTag");
  const bodyCondition = stateSection.fields.find((field) => field.id === "state.today.bodyCondition");
  const oldMood = stateSection.fields.find((field) => field.id === "state.today.mood");
  const oldBody = stateSection.fields.find((field) => field.id === "state.today.body");

  assert.ok(moodTag, "state.today.moodTag must exist");
  assert.equal(moodTag.kind, "select");
  assert.deepEqual(moodTag.options, ["开心", "平静", "放松", "期待", "焦虑", "烦躁", "低落", "麻木", "复杂"]);

  assert.ok(bodyCondition, "state.today.bodyCondition must exist");
  assert.equal(bodyCondition.kind, "select");
  assert.deepEqual(bodyCondition.options, ["很好", "正常", "疲惫", "乏力", "不舒服", "疼痛", "生病"]);

  assert.ok(oldMood, "old state.today.mood score field must still exist for backward compatibility");
  assert.equal(oldMood.kind, "score");
  assert.ok(oldBody, "old state.today.body score field must still exist for backward compatibility");
  assert.equal(oldBody.kind, "score");
});
