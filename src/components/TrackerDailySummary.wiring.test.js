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

/**
 * df030198 renamed the migration flag prop across four components at once and
 * got one leg wrong: PlannerOverview passed `hasMigratableHistoryMap` while
 * TrackerDailySummary still destructured `migratableHistoryById`. React does
 * not warn about that - the child just silently receives undefined, so every
 * tracker resolved to hasMigratableHistory=false and 历史尚未迁移 could never
 * render. The old assertions in this file are all loose string matches and
 * sailed straight past it. This one checks the actual prop contract.
 */
test("every prop PlannerOverview passes to TrackerDailySummary is actually destructured by it", async () => {
  const [app, summary] = await Promise.all([
    readFile(new URL("../App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./TrackerDailySummary.jsx", import.meta.url), "utf8"),
  ]);

  const usage = app.match(/<TrackerDailySummary\s([^>]*?)\/>/);
  assert.ok(usage, "TrackerDailySummary must be rendered in App.jsx");
  const passedProps = [...usage[1].matchAll(/(\w+)=\{/g)].map((match) => match[1]);
  assert.ok(passedProps.length > 0, "expected to parse at least one passed prop");

  const signature = summary.match(/export default function TrackerDailySummary\(\{([^}]*)\}/);
  assert.ok(signature, "TrackerDailySummary must destructure its props object");
  const acceptedProps = signature[1]
    .split(",")
    .map((part) => part.trim().split("=")[0].trim())
    .filter(Boolean);

  const dropped = passedProps.filter((prop) => !acceptedProps.includes(prop));
  assert.deepEqual(dropped, [], `TrackerDailySummary silently ignores props: ${dropped.join(", ")}`);
});
