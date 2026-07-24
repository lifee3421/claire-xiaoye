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
// canonical schema group. profileConfig: the user's saved
// { [sectionId]: string[] } preference (may be absent/partial/stale).
export function getQuickDurationFieldIds(
  sectionId,
  availableFields,
  profileConfig
) {
  const availableIds = (availableFields || []).map((field) => field.id);
  const defaults = validateQuickDurationConfig(
    DEFAULT_QUICK_DURATION_FIELDS[sectionId] || availableIds,
    availableIds
  );
  const fallback = defaults.length ? defaults : availableIds;

  const configured = profileConfig?.[sectionId];
  if (!Array.isArray(configured) || configured.length === 0) {
    return fallback;
  }

  const cleaned = validateQuickDurationConfig(configured, availableIds);
  return cleaned.length ? cleaned : fallback;
}
