import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("daily tracker sidebar is wired to unified effective trackers and opens monthly overview", async () => {
  const [app, summary] = await Promise.all([
    readFile(new URL("../App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./TrackerDailySummary.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /onLoadTrackerFacts/);
  assert.match(app, /trackers=\{effectiveTrackers\}/);
  assert.match(app, /onOpenTrackerOverview=/);
  assert.match(app, /initialOverviewTrackerId=\{trackerOverviewTrackerId\}/);
  assert.doesNotMatch(app, /trackers=\{reviewTrackerSummaries\}/);
  assert.match(summary, /projectTrackerDailyOverview/);
  assert.match(summary, /onOpenOverview\?\.\(tracker\.id\)/);
});
