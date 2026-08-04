// Guards for the settings form's save payload.
//
// `saveProfileSettings` (services/dataService.js) is a ~50-field allow-list
// where **key presence alone** decides whether a field is overwritten:
//
//   if ("dailyReviewUi" in settings) payload.dailyReviewUi = settings.dailyReviewUi || {};
//   if ("classificationTaxonomy" in settings) payload.classificationTaxonomy = ...;
//
// Combined with `setDoc(..., { merge: true })`, that means any key the
// settings form merely *carries* — even one it filled in from a read-time
// default rather than from user input — is written back over whatever is
// stored. Two concrete regressions came out of this:
//
//   1. `dailyReviewUi.pinnedCategoryIds` — the form never seeded
//      `dailyReviewUi`, so reading `form.dailyReviewUi?.pinnedCategoryIds || []`
//      always produced `[]`. Archiving any category then saved that `[]` over
//      the user's real pinned list, and `pinnedCategoryIds` is exactly what
//      decides which entries show up in the daily review form.
//   2. `classificationTaxonomy` — the form seeded from
//      `resolveClassificationTaxonomy(profile)`, which injects code-side
//      defaults (`ensureLifeCategories`, `CANONICAL_TAXONOMY_V3`) whenever the
//      stored tree lacks them. A plain "保存设置" then persisted those injected
//      defaults, resurrecting categories the user had deleted — and doing so
//      with whatever defaults *the currently deployed bundle* happens to
//      define, which is why the symptom tracked version switches.
//
// These helpers keep the decision in one importable place so the rule is
// testable without mounting the 13k-line settings component.

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Key-order-insensitive deep equality. The taxonomy pipeline rebuilds node
// objects on every resolve, so reference equality and plain JSON.stringify
// are both too strict to answer "did the user actually change anything?".
export function taxonomyPayloadEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

// The settings form deliberately does not seed `dailyReviewUi` with the whole
// stored object (that would make every plain save rewrite it wholesale), so
// the pinned list has to fall back to the profile until the user edits it.
// Returning the profile's list — not `[]` — is the entire fix for regression 1.
export function resolvePinnedCategoryIds(form, profile) {
  const fromForm = form?.dailyReviewUi?.pinnedCategoryIds;
  if (Array.isArray(fromForm)) return fromForm;
  const fromProfile = profile?.dailyReviewUi?.pinnedCategoryIds;
  return Array.isArray(fromProfile) ? fromProfile : [];
}

// Merge a pinned-list edit back into the form while keeping every sibling key
// of `dailyReviewUi` (archivedWorkGroups, studyLeafDefaults, ...) intact —
// dataService replaces the whole `dailyReviewUi` map, so dropping a sibling
// here would delete it in Firestore.
export function mergePinnedCategoryIdsIntoForm(form, profile, pinnedCategoryIds) {
  return {
    ...form,
    dailyReviewUi: {
      ...(profile?.dailyReviewUi || {}),
      ...(form?.dailyReviewUi || {}),
      pinnedCategoryIds: Array.isArray(pinnedCategoryIds) ? pinnedCategoryIds : [],
    },
  };
}

// Build the object handed to `onSave`, dropping every field the user did not
// actually touch so `saveProfileSettings`'s key-presence checks cannot write
// a read-time default back over stored data.
//
// - `dailyReviewUi` is omitted entirely unless the form holds a real object
//   (i.e. the user edited the pinned list this session). Note it must be
//   *deleted*, not set to null: `"dailyReviewUi" in settings` is true for a
//   null value too, and dataService would then store `{}` and wipe it.
// - `classificationTaxonomy` (and the colours derived from it) is omitted when
//   the outgoing tree is identical to the one resolved at mount, which is the
//   case for any save where the user never opened the taxonomy editor.
export function buildSettingsSavePayload({ form = {}, taxonomy = [], pristineTaxonomy = null, taxonomyColors = {} }) {
  const payload = { ...form };
  const taxonomyChanged = pristineTaxonomy === null || !taxonomyPayloadEqual(taxonomy, pristineTaxonomy);
  if (taxonomyChanged) {
    payload.classificationTaxonomy = taxonomy;
    payload.plannerCategoryColors = { ...(form.plannerCategoryColors || {}), ...taxonomyColors };
  } else {
    delete payload.classificationTaxonomy;
  }
  if (!payload.dailyReviewUi || typeof payload.dailyReviewUi !== "object") delete payload.dailyReviewUi;
  return payload;
}
