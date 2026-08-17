import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { todayV13StandalonePlugin } from "../scripts/todayV13StandalonePlugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function source(name) {
  return fs.readFileSync(join(here, name), "utf8");
}

test("Today v13 owns its presentation instead of mounting legacy planner surfaces", () => {
  const today = source("TodayV13Surface.jsx");
  assert.equal(today.includes("TimelinePreview"), false);
  assert.equal(today.includes("TaskPoolPreview"), false);
  assert.match(today, /function V13Timeline\(/);
  assert.match(today, /function V13TimelineBlock\(/);
  assert.match(today, /function V13TaskPool\(/);
  assert.match(today, /const PX_PER_MINUTE = 0\.7/);
});

test("build adapter keeps original desktop schedule return and adds Today before it", () => {
  const appSource = source("App.jsx");
  assert.match(appSource, /const PLANNER_PX_PER_MINUTE = 1\.5;/);
  assert.match(appSource, /<section className="schedule-layout">/);
  assert.equal(appSource.includes("TodayV13Surface"), false);

  const plugin = todayV13StandalonePlugin();
  const transformed = plugin.transform(appSource, "/repo/src/App.jsx");
  assert.ok(transformed?.code);
  const code = transformed.code;
  const todayIndex = code.indexOf("<TodayV13Surface");
  const desktopIndex = code.indexOf('<section className="schedule-layout">');
  assert.ok(todayIndex >= 0);
  assert.ok(desktopIndex > todayIndex);
  assert.match(code, /\? 0\.7 : 1\.5/);
});
