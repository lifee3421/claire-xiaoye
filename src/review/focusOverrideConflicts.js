// Detects fields where a manual edit is silently hiding a real, non-zero
// Focus autoValue — and provides the pure patch to restore just those
// fields. A field only counts as a conflict when ALL of:
//   - autoValueSource === "ticktick_focus" (a real Focus write, not some
//     other default/legacy source)
//   - autoValue > 0 (an empty/zero autoValue has nothing to restore to)
//   - manuallyEdited === true (a GENUINE manual edit, not just a stray
//     stored value — see effectiveReviewValue.js/InlineDurationInput's
//     commit-guard, which is what keeps this flag honest)
//   - the field's effective (displayed) value differs from autoValue —
//     once they match there's nothing to warn about, even if
//     manuallyEdited is still (harmlessly) true
import { resolveEffectiveReviewValue } from "./effectiveReviewValue.js";
import { reviewSections, otherSections } from "./dailyReviewSchema.js";

let fieldLabelIndex = null;
function getFieldLabelIndex() {
  if (!fieldLabelIndex) {
    fieldLabelIndex = new Map();
    [...reviewSections.flatMap((section) => section.groups), ...otherSections].forEach((group) => {
      (group.fields || []).forEach((field) => {
        if (field.label) fieldLabelIndex.set(field.id, field.label);
      });
    });
  }
  return fieldLabelIndex;
}

export function findFocusOverrideConflicts(draft) {
  const labels = getFieldLabelIndex();
  const conflicts = [];
  for (const [fieldId, state] of Object.entries(draft?.fields || {})) {
    if (!state || state.autoValueSource !== "ticktick_focus" || state.manuallyEdited !== true) continue;
    const autoValue = Number(state.autoValue);
    if (!(autoValue > 0)) continue;
    const effective = Number(resolveEffectiveReviewValue(state));
    if (effective === autoValue) continue;
    conflicts.push({ fieldId, label: labels.get(fieldId) || fieldId, value: effective, autoValue });
  }
  return conflicts;
}

// Restores exactly the given field ids to their Focus autoValue by clearing
// the manual override — value: "", manuallyEdited: false, source: "default".
// autoValue/autoValueSource are left completely untouched (they're already
// correct — the field just wasn't reading from them). Every OTHER field,
// draft.ui, clientRevision, and every other top-level key is left alone.
export function restoreFocusOverrideValues(draft, fieldIds) {
  const idsToRestore = new Set(fieldIds);
  const fields = { ...draft.fields };
  for (const fieldId of idsToRestore) {
    const state = fields[fieldId];
    if (!state) continue;
    fields[fieldId] = { ...state, value: "", manuallyEdited: false, source: "default" };
  }
  return { ...draft, fields };
}
