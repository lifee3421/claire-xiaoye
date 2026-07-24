import test from "node:test";
import assert from "node:assert/strict";
import { stampClientRevision, shouldAcceptRemoteDraft } from "./reviewDraftSync.js";
import { createReviewDraft } from "./dailyReviewSchema.js";

test("stampClientRevision sets clientRevision to a monotonically increasing (Date.now()-based) value, without touching any other field", () => {
  const draft = createReviewDraft("2026-07-24");
  const stamped = stampClientRevision(draft, 1000);
  assert.equal(stamped.clientRevision, 1000);
  assert.equal(stamped.date, draft.date);
  assert.deepEqual(stamped.fields, draft.fields);
});

test("shouldAcceptRemoteDraft rejects an echo of our own write (remote revision equal to local)", () => {
  const remoteDraft = { ...createReviewDraft("2026-07-24"), clientRevision: 1000 };
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft, localRevision: 1000 }), false);
});

test("shouldAcceptRemoteDraft rejects a remote draft older than local (e.g. a delayed/out-of-order snapshot)", () => {
  const remoteDraft = { ...createReviewDraft("2026-07-24"), clientRevision: 500 };
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft, localRevision: 1000 }), false);
});

test("shouldAcceptRemoteDraft accepts a remote draft genuinely newer than local (e.g. edited from another device)", () => {
  const remoteDraft = { ...createReviewDraft("2026-07-24"), clientRevision: 2000 };
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft, localRevision: 1000 }), true);
});

test("shouldAcceptRemoteDraft rejects a draft with no fields (not a real structured draft)", () => {
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft: { clientRevision: 9999 }, localRevision: 0 }), false);
});

test("shouldAcceptRemoteDraft rejects null/undefined remote draft", () => {
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft: null, localRevision: 0 }), false);
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft: undefined, localRevision: 0 }), false);
});

test("shouldAcceptRemoteDraft treats a missing/non-numeric localRevision as 0, so the very first real remote draft (revision > 0) is accepted", () => {
  const remoteDraft = { ...createReviewDraft("2026-07-24"), clientRevision: 1 };
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft, localRevision: undefined }), true);
});

test("end-to-end simulation: local edit -> autosave -> snapshot echo (same revision) is ignored; a later edit from another device (higher revision) is accepted", () => {
  let draft = createReviewDraft("2026-07-24");
  let localRevision = 0;

  // 1. Local edit: user fills in 高等数学 40min.
  draft = stampClientRevision({ ...draft, fields: { ...draft.fields, "study.math.calculus.duration": { ...draft.fields["study.math.calculus.duration"], value: 40 } } }, 1000);
  localRevision = draft.clientRevision;

  // 2. Autosave fires, Firestore echoes the SAME draft back (same clientRevision).
  const echo = { ...draft };
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft: echo, localRevision }), false, "echo of our own write must not be re-applied");

  // 3. Meanwhile the user keeps editing locally (progress note), bumping local revision further.
  draft = stampClientRevision({ ...draft, fields: { ...draft.fields, "study.math.calculus.progress": { ...draft.fields["study.math.calculus.progress"], value: "复习完成" } } }, 1500);
  localRevision = draft.clientRevision;

  // The stale echo from step 2 (revision 1000) must still be rejected even after further local edits.
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft: echo, localRevision }), false);

  // 4. A genuinely newer edit arrives from another device (revision 2000 > 1500).
  const fromAnotherDevice = { ...draft, fields: { ...draft.fields, "study.math.linearAlgebra.duration": { ...draft.fields["study.math.linearAlgebra.duration"], value: 25 } }, clientRevision: 2000 };
  assert.equal(shouldAcceptRemoteDraft({ remoteDraft: fromAnotherDevice, localRevision }), true, "a genuinely newer remote edit must be accepted");
});
