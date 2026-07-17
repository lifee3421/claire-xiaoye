import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviewProgressText } from "./mathProgress.js";
import { extractProfessionalProgressFromReview } from "./professionalProgress.js";

test("review progress accepts arrays, objects, strings, and blank values", () => {
  assert.equal(normalizeReviewProgressText(["线性代数：习题"]), "线性代数：习题");
  assert.equal(normalizeReviewProgressText({ 线性代数: "习题" }), "线性代数：习题");
  assert.equal(normalizeReviewProgressText("线性代数：习题"), "线性代数：习题");
  assert.equal(normalizeReviewProgressText(null), "");
});

test("professional review extraction tolerates non-array progress", () => {
  assert.deepEqual(extractProfessionalProgressFromReview({ subjects: { economy: { progress: null } } }), []);
  assert.deepEqual(extractProfessionalProgressFromReview({ subjects: { economy: { progress: {} } } }), []);
});
