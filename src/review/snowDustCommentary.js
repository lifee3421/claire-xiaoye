// Dedicated read/write helpers for draft.fields["snowDust.note"] — kept
// SEPARATE from the generic change()/onChange path (DailyReviewWorkbench.jsx),
// which always stamps manuallyEdited:true/source:"manual" — a real 雪尘
// commentary must never look like a manual edit, or a later manual-wins
// precedence check (effectiveReviewValue.js) would treat it as something
// the user typed.

export function applySnowDustCommentaryToDraft(draft, { commentary, generatedAt, inputRevision }) {
  const previous = draft.fields?.["snowDust.note"] || {};
  return {
    ...draft,
    status: draft.status === "not_generated" ? "auto_draft" : draft.status,
    updatedAt: new Date().toISOString(),
    fields: {
      ...draft.fields,
      "snowDust.note": {
        ...previous,
        value: commentary,
        autoValue: commentary,
        source: "snowdust",
        manuallyEdited: false,
        generatedAt,
        updatedAt: generatedAt,
        inputRevision,
      },
    },
  };
}

// A pre-"发给雪尘" note (source: "manual", or any note with no
// generatedAt/inputRevision at all — i.e. written before this feature
// existed) is real content the user typed by hand and must keep displaying
// normally, just labeled as historical rather than a real 雪尘 commentary.
export function isLegacyManualSnowDustNote(state) {
  const hasContent = Boolean(String(state?.value ?? state?.autoValue ?? "").trim());
  return hasContent && state?.source !== "snowdust";
}

export function snowDustNoteText(state) {
  return String(state?.value ?? state?.autoValue ?? "").trim();
}

// True once the review facts have changed since the currently-displayed
// commentary was generated — the card should invite (never force) a fresh
// "发给雪尘", and must never silently discard the still-valid old text.
export function isSnowDustCommentaryStale(state, currentInputRevision) {
  if (!state?.inputRevision) return false; // legacy/manual notes have no revision to compare against
  return state.inputRevision !== currentInputRevision;
}
