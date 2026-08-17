import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("daily tracker sidebar is wired to unified effective trackers and opens monthly overview", async () => {
  const [app, summary] = await Promise.all([
    readFile(new URL("../App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./TrackerDailySummary.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /onLoadTrackerFacts/);
  assert.match(app, /const loadTrackerFactsForSchedule = useCallback/);
  assert.match(app, /\[trackerOverview\]/);
  assert.match(app, /trackerFactsRequestRef/);
  assert.match(app, /\.finally\(\(\) =>/);
  assert.match(app, /trackers=\{effectiveTrackers\}/);
  assert.match(app, /onOpenTrackerOverview=/);
  assert.match(app, /initialOverviewTrackerId=\{trackerOverviewTrackerId\}/);
  assert.doesNotMatch(app, /trackers=\{reviewTrackerSummaries\}/);
  assert.match(summary, /projectTrackerDailyOverview/);
  assert.doesNotMatch(summary, /status !== "loading"/);
  assert.match(summary, /习惯状态读取失败/);
  assert.match(summary, /onRetry/);
  assert.match(summary, /onOpenOverview\?\.\(tracker\.id\)/);
});
