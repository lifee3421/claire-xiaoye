// Pure decision logic for DailyReviewWorkbench's local-draft-vs-remote-echo
// stability problem — extracted out of the component so it's unit-testable
// without React. See the comment above localRevisionRef in
// DailyReviewWorkbench.jsx for the full story: Firestore's live subscription
// fires on every write to the dailyReviewDrafts collection, including the
// echo of this same client's own just-completed autosave, and naively
// re-hydrating the local draft on every such fire causes rows to flicker,
// revert to an older value, or disappear mid-edit.
//
// clientRevision is a purely client-side, monotonically increasing
// (Date.now()-based) marker stamped on every local edit and carried through
// the save payload. An echo of our own write always carries a revision
// <= what we already have locally; only a genuinely newer remote draft
// (e.g. edited from another device) should ever replace local state.

export function stampClientRevision(draft, now = Date.now()) {
  return { ...draft, clientRevision: now };
}

/**
 * Whether a remote draft update (from the Firestore subscription) should be
 * accepted and replace the local draft. False for: no draft, no fields,
 * or a revision that isn't strictly newer than what's already local (this
 * covers both "echo of our own write" and "genuinely stale/older data").
 */
export function shouldAcceptRemoteDraft({ remoteDraft, localRevision }) {
  if (!remoteDraft?.fields) return false;
  const remoteRevision = Number(remoteDraft.clientRevision) || 0;
  return remoteRevision > (Number(localRevision) || 0);
}
