import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

test("planner refreshes the Beijing day immediately when an overnight tab becomes active", () => {
  assert.match(appSource, /refreshClock\(\);/);
  assert.match(appSource, /window\.addEventListener\("focus", refreshClock\)/);
  assert.match(appSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
});

test("midday life cards contain a dedicated nap and a separate startup buffer", () => {
  assert.match(appSource, /add\("nap", "午睡", napStart, napEnd/);
  assert.match(appSource, /categoryId: LIFE_CATEGORY_IDS\.nap/);
  assert.match(appSource, /add\("startup", "午间启动缓冲", startupStart/);
  assert.doesNotMatch(appSource, /add\("startup", "午休与启动缓冲"/);
});
