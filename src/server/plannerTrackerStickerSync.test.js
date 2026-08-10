import assert from "node:assert/strict";
import test from "node:test";
import { syncTrackerStickersIntoDraft } from "./plannerTrackerStickerSync.js";

function tracker() {
  return {
    id: "tracker-a",
    title: "示例追踪",
    schedule: { kind: "interval", every: 3, unit: "day" },
    goal: { aggregation: "occurrence", target: 1, unit: "times" },
    evidenceBindings: [{ type: "manualReviewField", fieldId: "fixture" }],
    stickerSettings: { enabled: true, emoji: "🧴", title: "今晚记得处理", placementMode: "timeline", time: "21:30", type: "reminder" },
  };
}

test("server sync creates the same due tracker sticker without a mounted planner page", () => {
  const result = syncTrackerStickersIntoDraft({
    draft: { stickers: [], suppressedStickerGenerationKeys: [] },
    trackers: [tracker()],
    trackerFacts: [{ trackerId: "tracker-a", scheduleStatus: "due_today", todayReviewStatus: "not_saved" }],
    localDate: "2026-08-11",
  });
  assert.equal(result.changed, true);
  assert.equal(result.actions[0].action, "create");
  assert.equal(result.draft.stickers.length, 1);
  assert.equal(result.draft.stickers[0].origin, "tracker");
  assert.equal(result.draft.stickers[0].anchorMinute, 21 * 60 + 30);
});

test("manual same-day suppression is respected server-side too", () => {
  const result = syncTrackerStickersIntoDraft({
    draft: { stickers: [], suppressedStickerGenerationKeys: ["tracker-a:2026-08-11"] },
    trackers: [tracker()],
    trackerFacts: [{ trackerId: "tracker-a", scheduleStatus: "overdue", todayReviewStatus: "not_saved" }],
    localDate: "2026-08-11",
  });
  assert.equal(result.changed, false);
  assert.deepEqual(result.actions, []);
});
