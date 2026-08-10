import { applyTrackerStickerPlan, planTrackerSticker } from "../utils/trackerStickers.js";
import {
  createTrackerSticker,
  completeStickerInstance,
  reopenStickerInstance,
  updateTrackerStickerInstance,
} from "../utils/plannerStickers.js";

/**
 * Server-safe counterpart of the browser tracker-sticker sync. It deliberately
 * reuses the exact same pure plannerStickers/trackerStickers primitives, so
 * opening the planner page and Snow-dust reading the planner cannot disagree
 * about which tracker deserves a sticker.
 */
export function syncTrackerStickersIntoDraft({ draft = {}, trackers = [], trackerFacts = [], localDate = "" } = {}) {
  if (!localDate || !Array.isArray(trackers) || !trackers.length) return { changed: false, draft, actions: [] };
  const factsById = new Map((Array.isArray(trackerFacts) ? trackerFacts : []).map((fact) => [fact.trackerId, fact]));
  let next = draft;
  const actions = [];

  for (const tracker of trackers) {
    const trackerFactsForOne = factsById.get(tracker.id);
    if (!trackerFactsForOne) continue;
    const generationKey = `${tracker.id}:${localDate}`;
    const existingSticker = (next.stickers || []).find((sticker) => sticker.generationKey === generationKey) || null;
    const plan = planTrackerSticker({
      tracker,
      trackerFacts: trackerFactsForOne,
      localDate,
      existingSticker,
      suppressedGenerationKeys: next.suppressedStickerGenerationKeys,
    });
    if (!plan || plan.action === "none") continue;
    const before = next;
    next = applyTrackerStickerPlan(plan, {
      draft: next,
      createSticker: createTrackerSticker,
      completeSticker: completeStickerInstance,
      reopenSticker: reopenStickerInstance,
      updateSticker: updateTrackerStickerInstance,
    });
    if (next !== before) actions.push({ action: plan.action, trackerId: tracker.id, generationKey });
  }

  return { changed: next !== draft, draft: next, actions };
}
