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
