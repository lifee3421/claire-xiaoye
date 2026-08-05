// Single shared rule for resolving a review field/category-entry's
// DISPLAYED value from its {value, autoValue, manuallyEdited,
// autoValueSource} state — used identically by draft.fields (schema-bound
// leaves) and draft.categoryReviewEntries (dynamic taxonomy-only leaves).
//
// The bug this exists to fix: numeric 0 is a legitimate value ("value !==
// undefined/null/''" checks treat it as present), so a field whose `value`
// happened to be 0 (e.g. a controlled input round-tripping its own display
// value on an unrelated save) would permanently mask a real, non-zero
// `autoValue` written by the Focus sync — even though the user never
// actually typed anything. The fix is NOT "prefer autoValue whenever it's
// bigger" (that would make a genuine manual "0" un-settable); it is:
// manuallyEdited is the ONLY thing that lets a stored `value` (including a
// literal 0) win over a real ticktick_focus autoValue.

export function isEmptyReviewValue(value) {
  return value === "" || value === null || value === undefined;
}

const FOCUS_SOURCE = "ticktick_focus";
const KEEP_EXERCISE_SOURCE = "keep_exercise";

// Sources whose autoValue is trusted enough to win over a stray `value` even
// without manuallyEdited=true — see the FOCUS_SOURCE comment above for why
// this can't just be "autoValue wins whenever it's non-empty". keep_exercise
// gets the same trust as ticktick_focus: both are server-projected facts a
// user never types into `value` themselves except via a deliberate edit
// (which sets manuallyEdited=true and is handled by the branch above).
const TRUSTED_AUTO_SOURCES = new Set([FOCUS_SOURCE, KEEP_EXERCISE_SOURCE]);

/**
 * state: { value, autoValue, manuallyEdited, autoValueSource }
 * Returns the value that should actually be displayed/summed.
 */
export function resolveEffectiveReviewValue(state = {}) {
  const { value, autoValue, manuallyEdited, autoValueSource } = state || {};

  // A genuine manual edit always wins, even when the user's manual value is
  // literally 0 — that is a deliberate "I did zero of this today", not an
  // absence of data.
  if (manuallyEdited === true) {
    return isEmptyReviewValue(value) ? (isEmptyReviewValue(autoValue) ? "" : autoValue) : value;
  }

  // Not manually edited: a real Focus- or Keep-sourced autoValue always wins
  // over whatever `value` happens to hold (including a stray 0), because
  // without manuallyEdited=true, `value` was never an intentional override.
  if (TRUSTED_AUTO_SOURCES.has(autoValueSource) && !isEmptyReviewValue(autoValue)) {
    return autoValue;
  }

  // Non-Focus fields (or Focus fields with no autoValue yet): unchanged
  // pre-existing semantics — value if present, else autoValue.
  if (!isEmptyReviewValue(value)) return value;
  return isEmptyReviewValue(autoValue) ? "" : autoValue;
}

export function resolveEffectiveReviewNumericValue(state) {
  const value = Number(resolveEffectiveReviewValue(state));
  return Number.isFinite(value) ? value : 0;
}
