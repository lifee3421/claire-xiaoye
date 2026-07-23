import test from "node:test";
import assert from "node:assert/strict";
import { REVIEW_SCHEMA, reviewSchemaFields } from "./reviewSchema.js";

function ids() {
  return REVIEW_SCHEMA.map((field) => field.id);
}

test("reviewSchema.js also carries the new hobby aggregate + misc diary field (two catalogs stay in sync, neither is the sole source)", () => {
  const list = ids();
  assert.ok(list.includes("hobby.totalMinutes"));
  assert.ok(list.includes("misc.today.diary.duration"));
});

test("reviewSchema.js hobby.totalMinutes is marked as an aggregate field", () => {
  const field = REVIEW_SCHEMA.find((row) => row.id === "hobby.totalMinutes");
  assert.equal(field.aggregate, true);
});

test("reviewSchema.js does not define entertainment.today.creativeWriting.duration", () => {
  assert.equal(ids().includes("entertainment.today.creativeWriting.duration"), false);
});

test("reviewSchemaFields({trackableOnly:true}) still returns a usable, non-empty list after the additions", () => {
  const fields = reviewSchemaFields({ trackableOnly: true });
  assert.ok(fields.length > 0);
});
