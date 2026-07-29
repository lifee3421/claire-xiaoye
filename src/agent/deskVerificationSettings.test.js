import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDeskVerificationSettings } from "./deskVerificationSettings.js";

test("uses safe persisted-settings defaults for legacy profiles", () => {
  assert.deepEqual(normalizeDeskVerificationSettings(), { morning: { enabled: true }, afternoon: { enabled: true }, evening: { enabled: true }, defaultAdvanceMinutes: 5, firstFollowUpMinutes: 10, reminderIntervalMinutes: 20 });
});

test("preserves configurable phases but keeps afternoon locked on", () => {
  const settings = normalizeDeskVerificationSettings({ morning: { enabled: false }, afternoon: { enabled: false }, evening: { enabled: false }, firstFollowUpMinutes: 3, reminderIntervalMinutes: 8 });
  assert.equal(settings.morning.enabled, false);
  assert.equal(settings.afternoon.enabled, true);
  assert.equal(settings.evening.enabled, false);
  assert.equal(settings.firstFollowUpMinutes, 3);
  assert.equal(settings.reminderIntervalMinutes, 8);
});
