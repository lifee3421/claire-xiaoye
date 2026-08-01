import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("TrackerManager UI wiring saves only profile.trackers and receives every migration callback through props", async () => {
  const [component, app, migrationPanel] = await Promise.all([
    readFile(new URL("./TrackerManager.jsx", import.meta.url), "utf8"),
    readFile(new URL("../App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./TrackerMigrationPanel.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /resolveEffectiveTrackers\(profile\)/);
  assert.match(component, /await onSave\(\{ trackers \}\)/);
  assert.match(component, /await onSyncToday\?\.\(\)/);
  assert.match(component, /role="alert"/);
  assert.match(component, /顶部贴纸栏/);
  assert.match(component, /时间轴贴纸必须设置合法 HH:mm/);
  assert.match(component, /completion 型贴纸暂未支持/);
  assert.match(app, /<TrackerManager key=\{trackerOverviewTrackerId \|\| "tracker-list"\} profile=\{data\.profile\}/);
  assert.match(app, /onSave=\{onSaveProfile\} onSyncToday=\{onSyncTrackersToday\}/);
  assert.match(app, /onSyncTrackersToday=\{\(\) => syncTrackerStickersForDate\(beijingIsoDate\(\)\)\}/);
  assert.match(app, /function ScheduleAssistant\([^)]*onWriteTrackerMigrationEvents/);
  assert.match(app, /onWriteMigrationEvents=\{onWriteTrackerMigrationEvents\}/);
  assert.match(component, /onLoadMigrationSnapshot, onWriteMigrationEvents/);
  assert.match(component, /const result = await onWriteMigrationEvents\(events\)/);
  assert.match(component, /<TrackerMigrationPanel[^>]*onLoadSnapshot=\{onLoadMigrationSnapshot\}[^>]*onConfirm=\{confirmMigration\}/);
  assert.match(migrationPanel, /const result = await onConfirm\(/);
  assert.doesNotMatch(migrationPanel, /onWriteMigrationEvents/);
  assert.doesNotMatch(component, /healthMaintenanceItems:\s*form|reviewTrackers:\s*form/);
});
