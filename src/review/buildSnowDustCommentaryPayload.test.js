import test from "node:test";
import assert from "node:assert/strict";
import { buildSnowDustCommentaryPayload } from "./buildSnowDustCommentaryPayload.js";
import { createReviewDraft } from "./dailyReviewSchema.js";
import { CANONICAL_TAXONOMY_V3 } from "../taxonomy/taxonomyContract.js";

function focusField(autoValue) {
  return { value: "", autoValue, autoValueSource: "ticktick_focus", source: "default", manuallyEdited: false };
}

test("3. payload uses the effective value resolver — a Focus autoValue (never typed into value) is included, not read as 0/empty", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.math.linearAlgebra.duration"] = focusField(242);

  const { review } = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: {} });
  const leaf = review.study.find((item) => item.label === "线性代数");
  assert.ok(leaf, "线性代数 must be included");
  assert.equal(leaf.minutes, 242);
});

test("4. a dynamic (taxonomy-only) category — e.g. 做饭 under 生活 — is included in review.life", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const life = taxonomy.find((node) => node.id === "life");
  life.children.push({ id: "secondary-1784951587521", name: "做饭", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 } });
  const draft = createReviewDraft("2026-07-24", {});
  draft.categoryReviewEntries = { "secondary-1784951587521": { duration: focusField(16) } };

  const { review } = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: {} });
  const leaf = review.life.find((item) => item.label === "做饭");
  assert.ok(leaf, "做饭 must appear in review.life");
  assert.equal(leaf.minutes, 16);
});

test("a manually-edited field (value=0, real manual override) is respected — the payload never silently substitutes a stale autoValue for a genuine manual 0", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.english.ieltsWriting.duration"] = { value: 0, autoValue: 56, autoValueSource: "ticktick_focus", source: "manual", manuallyEdited: true };

  const { review } = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: {} });
  const leaf = review.study.find((item) => item.label === "雅思写作");
  assert.equal(leaf, undefined, "a genuine manual 0 must not appear as a positive-minutes study item");
});

test("payload never includes any profile/identity/points fields — only draft/taxonomy/settlement are ever read", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  const { review } = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: { pointsAdded: 999 } });
  const json = JSON.stringify(review);
  assert.doesNotMatch(json, /uid|email|points|token|secret/i);
});

test("long free-text fields are truncated, and the same review facts always produce the same inputRevision (deterministic, no randomness/timestamps baked in)", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["diary.content"] = { value: "x".repeat(1000), autoValue: "", source: "manual", manuallyEdited: true };

  const first = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: {} });
  assert.ok(first.review.diary.content.length <= 301);

  const second = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: {} });
  assert.equal(first.inputRevision, second.inputRevision, "identical facts must produce the identical inputRevision");
});

test("changing a review fact changes inputRevision", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  const before = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: {} });

  draft.fields["study.math.linearAlgebra.duration"] = focusField(242);
  const after = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement: {} });

  assert.notEqual(before.inputRevision, after.inputRevision);
});

// Regression guard for the "九段、540分钟" bug: this payload must stay
// isolated from timeline/planned-minutes data no matter what's scheduled —
// commentary is built exclusively from the submitted review draft/settlement.
test("payload never includes timeline/plan fields — scheduledStudyMinutes-shaped data cannot leak into commentary", () => {
  const taxonomy = JSON.parse(JSON.stringify(CANONICAL_TAXONOMY_V3));
  const draft = createReviewDraft("2026-07-24", {});
  // Even if a caller mistakenly stuffs plan-shaped data onto the draft or
  // settlement object, buildSnowDustCommentaryPayload must not read it —
  // it only ever reads through value()/numberValue() against known review
  // field ids, never a raw pass-through of arbitrary settlement keys.
  draft.timeline = [{ id: "b1", plannedMinutes: 540, status: "pending" }];
  draft.progress = { totalPlannedMinutes: 540, totalBlocks: 9 };
  const settlement = { scheduledStudyMinutes: 540, totalPlannedMinutes: 540, studyMinutes: 60 };

  const { review } = buildSnowDustCommentaryPayload({ date: "2026-07-24", draft, taxonomy, settlement });
  const json = JSON.stringify(review);
  assert.doesNotMatch(json, /scheduledStudyMinutes|totalPlannedMinutes|totalBlocks|plannedMinutes/i);
  // settlement.studyMinutes (the authoritative final-review total) is not
  // part of this payload's schema either — the review's own per-leaf
  // `study[].minutes` (draft-sourced) is what commentary reads, not a
  // dailyFacts-shaped settlement total.
  assert.doesNotMatch(json, /"studyMinutes"/);
});
