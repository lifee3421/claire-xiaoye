// Pure merge logic for applying a remote Focus->Daily Review sync update
// (written server-side by api/focus-review-sync.js) onto the actively-edited
// local draft, WITHOUT disturbing anything the user is doing.
//
// This is deliberately a SEPARATE mechanism from clientRevision/
// shouldAcceptRemoteDraft (reviewDraftSync.js): clientRevision tracks the
// browser's OWN local edits and is what protects against autosave-echo
// overwriting an in-progress edit. A Focus sync is a genuine external server
// write that never touches clientRevision at all (the endpoint only patches
// autoValue/focusSummary/focusSync), so gating it on clientRevision would
// mean it's silently ignored forever. It needs its own revision marker:
// focusSync.sourceRevision, tracked independently by the caller.
//
// Only ever merges in:
//   - remote.focusSummary (server-computed, safe to always take verbatim)
//   - remote.focusSync (ditto)
//   - the `autoValue` and its dedicated provenance marker `autoValueSource`
//     (the server tags every value it writes "ticktick_focus", distinct
//     from the schema's own `.source` — that field means "how did `.value`
//     get set" (manual/default) and is NEVER touched here, exactly like
//     `.value`/`.manuallyEdited`) of fields/categoryReviewEntries the LAST
//     TWO Focus syncs targeted (current + previous, so a category that
//     dropped out of today's projection gets its old autoValue cleared too,
//     not just left stale)
//
// Always preserves local: `value`, `manuallyEdited`, `source` (the manual/
// default marker), any other key on each field/entry, draft.ui,
// clientRevision, and every field this mechanism never targets. Never
// full-replaces the draft.

export function mergeRemoteFocusProjection(localDraft, remoteDraft, { previousFieldProjection } = {}) {
  if (!remoteDraft) return localDraft;

  const nextFieldProjection = remoteDraft.focusSync?.fieldProjection || { fieldTargets: [], categoryEntryTargets: [] };
  const fieldTargets = new Set([...(previousFieldProjection?.fieldTargets || []), ...(nextFieldProjection.fieldTargets || [])]);
  const categoryEntryTargets = new Set([...(previousFieldProjection?.categoryEntryTargets || []), ...(nextFieldProjection.categoryEntryTargets || [])]);

  let fields = localDraft.fields;
  let fieldsChanged = false;
  for (const fieldId of fieldTargets) {
    const remoteField = remoteDraft.fields?.[fieldId];
    const localField = localDraft.fields?.[fieldId];
    if (!remoteField || !localField) continue;
    if (localField.autoValue === remoteField.autoValue && localField.autoValueSource === remoteField.autoValueSource) continue;
    if (!fieldsChanged) { fields = { ...fields }; fieldsChanged = true; }
    fields[fieldId] = { ...localField, autoValue: remoteField.autoValue, autoValueSource: remoteField.autoValueSource ?? localField.autoValueSource };
  }

  let categoryReviewEntries = localDraft.categoryReviewEntries;
  let entriesChanged = false;
  for (const target of categoryEntryTargets) {
    const lastDot = target.lastIndexOf(".");
    const categoryId = target.slice(0, lastDot);
    const field = target.slice(lastDot + 1);
    const remoteEntry = remoteDraft.categoryReviewEntries?.[categoryId]?.[field];
    const localEntry = localDraft.categoryReviewEntries?.[categoryId]?.[field];
    if (!remoteEntry || !localEntry) continue;
    if (localEntry.autoValue === remoteEntry.autoValue && localEntry.autoValueSource === remoteEntry.autoValueSource) continue;
    if (!entriesChanged) { categoryReviewEntries = { ...categoryReviewEntries }; entriesChanged = true; }
    categoryReviewEntries[categoryId] = { ...categoryReviewEntries[categoryId], [field]: { ...localEntry, autoValue: remoteEntry.autoValue, autoValueSource: remoteEntry.autoValueSource ?? localEntry.autoValueSource } };
  }

  const summaryChanged = remoteDraft.focusSummary !== undefined && remoteDraft.focusSummary !== localDraft.focusSummary;
  const syncChanged = remoteDraft.focusSync !== undefined && remoteDraft.focusSync !== localDraft.focusSync;

  if (!fieldsChanged && !entriesChanged && !summaryChanged && !syncChanged) return localDraft;

  return {
    ...localDraft,
    fields,
    categoryReviewEntries,
    ...(remoteDraft.focusSummary !== undefined ? { focusSummary: remoteDraft.focusSummary } : {}),
    ...(remoteDraft.focusSync !== undefined ? { focusSync: remoteDraft.focusSync } : {}),
  };
}
