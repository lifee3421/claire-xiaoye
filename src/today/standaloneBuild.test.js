import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { approvedTodaySource, injectStandaloneRuntime } from "../../scripts/todayStandalonePagePlugin.mjs";

const APPROVED_SHA256 = "ae668159ec9a305e65fa44c1f9cef7a5703cebc55b082e1cabfefc413a422865";

test("standalone Today is built from the approved v17 source", () => {
  const source = approvedTodaySource(process.cwd());
  const digest = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  assert.equal(digest, APPROVED_SHA256);
  assert.match(source, /applyTodaySkin\('auto'\)/);
  assert.match(source, /dataset\.themeMode=mode/);
  assert.match(source, /id="timelineWindow"/);
  assert.match(source, /id="timelineTracks"/);
  assert.match(source, /data-content-goal-day/);
  assert.match(source, /data-delete-pool-seg/);
  assert.match(source, /poolGroups\.addEventListener\('click'/);
  assert.match(source, /contentGoalStart/);
  assert.match(source, /contentGoalDeadline/);
  assert.match(source, /content-date-summary/);
});

test("standalone Today boots directly without the old iframe/base64 runtime loader", () => {
  const output = injectStandaloneRuntime(approvedTodaySource(process.cwd()));
  assert.match(output, /<title>今日排程<\/title>/);
  assert.match(output, /today-standalone-bridge\.js/);
  assert.match(output, /today-projection-polish\.js/);
  assert.match(output, /today-template-scope-bridge\.js/);
  assert.match(output, /today-reminder-edit-bridge\.js/);
  assert.match(output, /src\/today\/standaloneRuntime\.js/);
  assert.doesNotMatch(output, /<iframe\b/i);
  assert.doesNotMatch(output, /\batob\s*\(/);
  assert.doesNotMatch(output, /TodayV14Frame|AppRuntime/);
});
