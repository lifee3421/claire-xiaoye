import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EXPORT_DAYS,
  normalizeStoredExerciseRecord,
  validateExerciseExportRange,
} from "./exerciseRecordExportCore.js";

test("exercise export range accepts bounded real dates", () => {
  const range = validateExerciseExportRange({ from: "2026-08-01", to: "2026-09-07" });
  assert.equal(range.valid, true);
  assert.equal(range.days, 38);
  assert.equal(range.dates[0], "2026-08-01");
  assert.equal(range.dates.at(-1), "2026-09-07");
});

test("exercise export range rejects invalid, reversed, and overlong ranges", () => {
  assert.equal(validateExerciseExportRange({ from: "2026-02-30", to: "2026-03-01" }).valid, false);
  assert.equal(validateExerciseExportRange({ from: "2026-09-08", to: "2026-09-07" }).valid, false);
  const start = "2026-01-01";
  const tooLong = new Date(Date.parse(`${start}T00:00:00Z`) + MAX_EXPORT_DAYS * 86400000)
    .toISOString().slice(0, 10);
  assert.equal(validateExerciseExportRange({ from: start, to: tooLong }).valid, false);
});
test("stored Keep record is normalized to the narrow Health projection shape", () => {
  const record = normalizeStoredExerciseRecord({
    date: "2026-08-04",
    timezone: "Asia/Shanghai",
    summary: { sourceDisplayedMinutes: 36, calories: 250, durationSeconds: 2215 },
    sessions: [{ title: "燃脂派对", durationSeconds: 2215, calories: 250, displayTime: "18:21" }],
    source: { sourceSnapshotHash: "real-hash", extractedAt: "2026-08-04T10:30:00.000Z", receivedAt: "server-only" },
    createdAt: "server-only",
    updatedAt: "server-only",
    arbitraryPrivateField: "must-not-leak",
  });
  assert.equal(record.date, "2026-08-04");
  assert.equal(record.summary.sourceDisplayedMinutes, 36);
  assert.equal(record.source.sourceSnapshotHash, "real-hash");
  assert.equal(record.source.extractedAt, "2026-08-04T10:30:00.000Z");
  assert.equal("createdAt" in record, false);
  assert.equal("updatedAt" in record, false);
  assert.equal("arbitraryPrivateField" in record, false);
  assert.equal("receivedAt" in record.source, false);
});

test("malformed legacy records are omitted instead of guessed", () => {
  assert.equal(normalizeStoredExerciseRecord({ date: "2026-08-04", sessions: [] }), null);
});
