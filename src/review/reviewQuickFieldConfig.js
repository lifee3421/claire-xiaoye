// UI-only preference layer: which duration fields a card shows directly on
// the main page vs. tucked away behind "更多". This never touches
// draft.fields or canonical schema ids — it only decides what renders where.
// Charts and points always read every field regardless of this config.
export const DEFAULT_QUICK_DURATION_FIELDS = {
  entertainment: [
    "entertainment.today.wenyou.duration",
    "entertainment.today.game.duration",
    "entertainment.today.video.duration",
    "entertainment.today.shortVideo.duration",
    "entertainment.today.novel.duration",
    "entertainment.today.other.duration",
  ],
  family: [
    "family.contact.grandmother.duration",
    "family.contact.parent.duration",
    "family.contact.trip.duration",
  ],
  misc: [
    "misc.today.tidying.duration",
    "misc.today.temporary.duration",
    "misc.today.review.duration",
    "misc.today.diary.duration",
    "misc.today.other.duration",
  ],
  hobby: [
    "hobby.creativeWriting.duration",
    "hobby.music.singing.duration",
    "hobby.music.guitar.duration",
    "hobby.crafts.perlerBeads.duration",
  ],
};

// Keeps only ids that are actually part of this card's available fields,
// dedupes, preserves the given order. Never lets a user-typed/unknown id
// through.
export function validateQuickDurationConfig(ids, availableIds) {
  const known = new Set(availableIds || []);
  const seen = new Set();

  return (Array.isArray(ids) ? ids : []).filter(
    (id) => known.has(id) && !seen.has(id) && (seen.add(id) || true)
  );
}

// availableFields: [{ id, label }] for this card, taken straight from the
// canonical schema group (plus, for sections that support it, dynamic
// taxonomy leaves as `category:<id>` tokens — see reviewTaxonomyModel.js's
// listDynamicDurationLeaves). profileConfig: the user's saved
// { [sectionId]: string[] } preference (may be absent/partial/stale).
// migrationFallbackIds: `category:<id>` tokens derived from the now-removed
// taxonomy "常驻显示" pin, used ONLY as part of the computed default when
// this section has genuinely never been configured — never overrides an
// explicit (even empty) saved preference.
//
// `configured.length === 0` is a real, meaningful preference — "the user
// hid every quick field" — and must be preserved exactly as saved. Only the
// KEY being absent (profileConfig has no entry for this sectionId at all)
// means "never configured, use the computed default".
export function getQuickDurationFieldIds(
  sectionId,
  availableFields,
  profileConfig,
  migrationFallbackIds = []
) {
  const availableIds = (availableFields || []).map((field) => field.id);
  const staticDefaults = validateQuickDurationConfig(
    DEFAULT_QUICK_DURATION_FIELDS[sectionId] || [],
    availableIds
  );
  const migratedDefaults = validateQuickDurationConfig(migrationFallbackIds, availableIds);
  const combinedDefaults = [...new Set([...staticDefaults, ...migratedDefaults])];
  const defaults = combinedDefaults.length ? combinedDefaults : validateQuickDurationConfig(availableIds, availableIds);
  const fallback = defaults.length ? defaults : availableIds;

  const configured = profileConfig?.[sectionId];
  if (!Array.isArray(configured)) {
    return fallback;
  }
  if (configured.length === 0) {
    return []; // explicit "hide every quick field" — never resurrected into a default
  }

  // A non-empty saved config that validates down to nothing (every
  // previously-picked id has since become unavailable, e.g. a field was
  // removed) is stale configuration, not an intentional "hide all" — that
  // case still falls back to the computed default.
  const cleaned = validateQuickDurationConfig(configured, availableIds);
  return cleaned.length ? cleaned : fallback;
}
