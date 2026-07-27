import test from "node:test";
import assert from "node:assert/strict";
import { applySnowDustCommentaryToDraft, isLegacyManualSnowDustNote, snowDustNoteText, isSnowDustCommentaryStale } from "./snowDustCommentary.js";
import { createReviewDraft } from "./dailyReviewSchema.js";

test("9. applySnowDustCommentaryToDraft sets source=snowdust, manuallyEdited=false — never routes through the manual-edit shape", () => {
  const draft = createReviewDraft("2026-07-24", {});
  const next = applySnowDustCommentaryToDraft(draft, { commentary: "今天数学推进不错。", generatedAt: "2026-07-24T10:00:00.000Z", inputRevision: "abc123" });
  const state = next.fields["snowDust.note"];
  assert.equal(state.value, "今天数学推进不错。");
  assert.equal(state.autoValue, "今天数学推进不错。");
  assert.equal(state.source, "snowdust");
  assert.equal(state.manuallyEdited, false);
  assert.equal(state.generatedAt, "2026-07-24T10:00:00.000Z");
  assert.equal(state.inputRevision, "abc123");
});

test("applySnowDustCommentaryToDraft never touches any other field", () => {
  const draft = createReviewDraft("2026-07-24", {});
  draft.fields["study.math.linearAlgebra.duration"] = { value: 40, autoValue: 40, source: "manual", manuallyEdited: true };
  const next = applySnowDustCommentaryToDraft(draft, { commentary: "x", generatedAt: "2026-07-24T10:00:00.000Z", inputRevision: "r1" });
  assert.deepEqual(next.fields["study.math.linearAlgebra.duration"], draft.fields["study.math.linearAlgebra.duration"]);
});

test("14. a legacy manual note (source: manual, only value, no generatedAt/inputRevision) is recognized as legacy content, not a real 雪尘 commentary", () => {
  const legacy = { value: "手写的旧批注", source: "manual" };
  assert.equal(isLegacyManualSnowDustNote(legacy), true);
  assert.equal(snowDustNoteText(legacy), "手写的旧批注");
});

test("a real snowdust-sourced note is NOT flagged as legacy", () => {
  const real = { value: "雪尘写的", source: "snowdust", generatedAt: "2026-07-24T10:00:00.000Z", inputRevision: "r1" };
  assert.equal(isLegacyManualSnowDustNote(real), false);
});

test("an empty note (no content at all) is not flagged as legacy — nothing to label as historical", () => {
  assert.equal(isLegacyManualSnowDustNote({}), false);
  assert.equal(isLegacyManualSnowDustNote({ value: "  " }), false);
});

test("11. isSnowDustCommentaryStale is true once inputRevision no longer matches the current review facts' revision", () => {
  const state = { value: "旧批注", source: "snowdust", inputRevision: "rev-1" };
  assert.equal(isSnowDustCommentaryStale(state, "rev-1"), false);
  assert.equal(isSnowDustCommentaryStale(state, "rev-2"), true);
});

test("a legacy note with no inputRevision at all is never flagged stale — there's nothing to compare", () => {
  assert.equal(isSnowDustCommentaryStale({ value: "手写", source: "manual" }, "rev-1"), false);
});

test("12. a real 雪尘 commentary round-trips through migrateFeatureDraft (the same autosave/restore path every other field uses) — reopening a historical date still shows the commentary generated that day", async () => {
  const { migrateFeatureDraft, createReviewDraft } = await import("./dailyReviewSchema.js");
  const draft = createReviewDraft("2026-07-20", {});
  const withCommentary = applySnowDustCommentaryToDraft(draft, { commentary: "那天数学推进很扎实。", generatedAt: "2026-07-20T20:00:00.000Z", inputRevision: "rev-old" });
  const restored = migrateFeatureDraft(withCommentary, {});
  const state = restored.fields["snowDust.note"];
  assert.equal(state.value, "那天数学推进很扎实。");
  assert.equal(state.source, "snowdust");
  assert.equal(state.inputRevision, "rev-old");
});
