const ALLOWED_LIFE_CARD_IDS = new Set(["lunch", "dinner", "nap", "startup"]);

export function applyPlannerLifeCardCompletion(draft = {}, { date = "", cardId = "", completed = true, now = new Date() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "invalid_date" };
  if (!ALLOWED_LIFE_CARD_IDS.has(cardId)) return { ok: false, reason: "unsupported_life_card" };
  if (draft?.targetDate !== date) return { ok: false, reason: "wrong_date", currentDate: draft?.targetDate || "" };

  const previous = draft.todaySegmentOverrides?.[cardId] || {};
  const status = completed ? "completed" : "pending";
  if (previous.status === status) return { ok: true, noop: true, nextDraft: draft, cardId, status };

  const nextDraft = {
    ...draft,
    todaySegmentOverrides: {
      ...(draft.todaySegmentOverrides || {}),
      [cardId]: {
        ...previous,
        status,
        completionSource: "snowdust_user_statement",
        completionUpdatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
      },
    },
  };
  return { ok: true, noop: false, nextDraft, cardId, status };
}

export { ALLOWED_LIFE_CARD_IDS };
