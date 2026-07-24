import test from "node:test";
import assert from "node:assert/strict";
import { mergeRemoteFocusProjection } from "./mergeRemoteFocusProjection.js";

function localDraft(overrides = {}) {
  return {
    clientRevision: 12345,
    ui: { studyLeafVisibility: { added: ["study.math.linearAlgebra"], hidden: [] } },
    fields: {
      "study.math.linearAlgebra.duration": { value: "", autoValue: 0, autoValueSource: "default", manuallyEdited: false, source: "default" },
      "study.math.linearAlgebra.progress": { value: "", autoValue: "", autoValueSource: "default", manuallyEdited: false, source: "default" },
    },
    categoryReviewEntries: {
      "misc.water-plants": { duration: { value: "", autoValue: 0, autoValueSource: "default", manuallyEdited: false, source: "default" } },
    },
    ...overrides,
  };
}

function remoteDraft(overrides = {}) {
  return {
    clientRevision: 12345, // unchanged by a Focus sync write
    fields: {
      "study.math.linearAlgebra.duration": { value: "", autoValue: 40, autoValueSource: "ticktick_focus", manuallyEdited: false, source: "default" },
      "study.math.linearAlgebra.progress": { value: "", autoValue: "09:20–10:10 完成第三章习题", autoValueSource: "ticktick_focus", manuallyEdited: false, source: "default" },
    },
    categoryReviewEntries: {
      "misc.water-plants": { duration: { value: "", autoValue: 25, autoValueSource: "ticktick_focus", manuallyEdited: false, source: "default" } },
    },
    focusSummary: { totalMinutes: 65, sessionCount: 2 },
    focusSync: { sourceRevision: "rev-1", fieldProjection: { fieldTargets: ["study.math.linearAlgebra.duration", "study.math.linearAlgebra.progress"], categoryEntryTargets: ["misc.water-plants.duration"] } },
    ...overrides,
  };
}

test("27. merges remote autoValue for targeted fields, never overwriting local value/manuallyEdited/source", () => {
  const merged = mergeRemoteFocusProjection(localDraft(), remoteDraft());
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].autoValue, 40);
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].value, "");
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].manuallyEdited, false);
  assert.match(merged.fields["study.math.linearAlgebra.progress"].autoValue, /完成第三章习题/);
});

test("27. a manually-edited field's `value`/`manuallyEdited`/`source` survive a Focus merge untouched, even though autoValue and autoValueSource update", () => {
  const local = localDraft({
    fields: {
      "study.math.linearAlgebra.duration": { value: 90, autoValue: 0, autoValueSource: "default", manuallyEdited: true, source: "manual" },
      "study.math.linearAlgebra.progress": { value: "", autoValue: "", autoValueSource: "default", manuallyEdited: false, source: "default" },
    },
  });
  const merged = mergeRemoteFocusProjection(local, remoteDraft());
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].value, 90, "manual value must survive");
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].manuallyEdited, true, "manuallyEdited flag must survive");
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].source, "manual", "the value/manual source marker must never be touched by a Focus merge");
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].autoValue, 40, "autoValue still updates from the Focus projection");
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].autoValueSource, "ticktick_focus", "autoValueSource is a separate, distinct provenance marker that DOES update");
});

test("28. a Focus merge never changes clientRevision (that stays purely a local-edit marker)", () => {
  const local = localDraft({ clientRevision: 999 });
  const merged = mergeRemoteFocusProjection(local, remoteDraft({ clientRevision: 5 }));
  assert.equal(merged.clientRevision, 999);
});

test("29. focusSummary and focusSync are taken verbatim from remote so charts/summary read the synced data", () => {
  const merged = mergeRemoteFocusProjection(localDraft(), remoteDraft());
  assert.equal(merged.focusSummary.totalMinutes, 65);
  assert.equal(merged.focusSync.sourceRevision, "rev-1");
});

test("draft.ui and every non-targeted field/entry survive completely untouched", () => {
  const local = localDraft();
  const merged = mergeRemoteFocusProjection(local, remoteDraft());
  assert.equal(merged.ui, local.ui);
});

test("20. dynamic categoryReviewEntries autoValue merges the same way as static fields", () => {
  const merged = mergeRemoteFocusProjection(localDraft(), remoteDraft());
  assert.equal(merged.categoryReviewEntries["misc.water-plants"].duration.autoValue, 25);
});

test("returns the SAME object reference (no-op) when there is nothing new to merge, to avoid an unnecessary re-render", () => {
  const local = localDraft();
  const remote = remoteDraft({
    fields: local.fields, // identical autoValue already
    categoryReviewEntries: local.categoryReviewEntries,
    focusSummary: undefined,
    focusSync: undefined,
  });
  const merged = mergeRemoteFocusProjection(local, remote);
  assert.equal(merged, local);
});

test("null/undefined remoteDraft is a safe no-op", () => {
  const local = localDraft();
  assert.equal(mergeRemoteFocusProjection(local, null), local);
  assert.equal(mergeRemoteFocusProjection(local, undefined), local);
});

test("22. a field that was targeted by the PREVIOUS sync but not the current one (rolled back) still gets its cleared autoValue picked up, via previousFieldProjection", () => {
  const local = localDraft({
    fields: {
      "study.math.linearAlgebra.duration": { value: "", autoValue: 40, manuallyEdited: false, source: "default" },
      "study.math.linearAlgebra.progress": { value: "", autoValue: "旧的自动推进", manuallyEdited: false, source: "default" },
    },
  });
  // This sync run no longer targets linearAlgebra at all (the test session was removed) —
  // server already reset remote.fields[...].autoValue to 0/"" via its own rollback patch.
  const remote = remoteDraft({
    fields: {
      "study.math.linearAlgebra.duration": { value: "", autoValue: 0, manuallyEdited: false, source: "default" },
      "study.math.linearAlgebra.progress": { value: "", autoValue: "", manuallyEdited: false, source: "default" },
    },
    focusSync: { sourceRevision: "rev-2", fieldProjection: { fieldTargets: [], categoryEntryTargets: [] } },
  });
  const merged = mergeRemoteFocusProjection(local, remote, {
    previousFieldProjection: { fieldTargets: ["study.math.linearAlgebra.duration", "study.math.linearAlgebra.progress"], categoryEntryTargets: [] },
  });
  assert.equal(merged.fields["study.math.linearAlgebra.duration"].autoValue, 0);
  assert.equal(merged.fields["study.math.linearAlgebra.progress"].autoValue, "");
});
