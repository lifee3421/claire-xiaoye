// Pure helpers for InlineDurationInput's commit-guard, kept in a plain .js
// file (not the .jsx component) so they're importable from plain `node
// --test` without a JSX transform.

export function normalizeCommittedDurationValue(raw) {
  return raw === "" || raw === null || raw === undefined ? "" : raw;
}

// Pure decision: given the just-parsed text and the last value this input
// actually committed (or, before any real edit, the value it started with),
// should onCommit fire? Only when they genuinely differ — a plain focus/
// blur with no edit, retyping the same number, or Enter immediately
// followed by blur (which re-parses the SAME unchanged text) must all be
// no-ops, never marking the field manuallyEdited for something the user
// never actually changed.
export function shouldCommitDurationInput(parsedValue, committedValue) {
  return parsedValue !== committedValue;
}
