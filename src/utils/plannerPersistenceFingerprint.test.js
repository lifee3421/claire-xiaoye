import test from "node:test";
import assert from "node:assert/strict";
import { fingerprintPlannerPersistencePayload } from "./plannerPersistenceFingerprint.js";

test("fingerprintPlannerPersistencePayload: identical content but different draft updatedAt timestamps fingerprints the same", () => {
  const base = {
    scheduleAssistantSettings: { dayTemplates: [] },
    scheduleAssistantDraft: { targetDate: "2026-08-01", todayCustomBlocks: [{ id: "a" }], updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [],
    scheduleSegmentGoals: {},
  };
  const later = {
    ...base,
    scheduleAssistantDraft: { ...base.scheduleAssistantDraft, updatedAt: "2026-08-01T00:05:00.000Z" },
  };
  assert.equal(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(later));
});

test("fingerprintPlannerPersistencePayload: a real content difference (new task block) changes the fingerprint", () => {
  const base = {
    scheduleAssistantSettings: { dayTemplates: [] },
    scheduleAssistantDraft: { targetDate: "2026-08-01", todayCustomBlocks: [{ id: "a" }], updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [],
    scheduleSegmentGoals: {},
  };
  const edited = {
    ...base,
    scheduleAssistantDraft: { ...base.scheduleAssistantDraft, todayCustomBlocks: [{ id: "a" }, { id: "b" }], updatedAt: "2026-08-01T00:05:00.000Z" },
  };
  assert.notEqual(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(edited));
});

test("fingerprintPlannerPersistencePayload: a new saved template changes the fingerprint", () => {
  const base = {
    scheduleAssistantSettings: { dayTemplates: [] },
    scheduleAssistantDraft: { targetDate: "2026-08-01", updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [],
    scheduleSegmentGoals: {},
  };
  const withTemplate = {
    ...base,
    scheduleAssistantSettings: { dayTemplates: [{ id: "template-1", content: {} }] },
  };
  assert.notEqual(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(withTemplate));
});

test("fingerprintPlannerPersistencePayload: a changed study target default changes the fingerprint", () => {
  const base = {
    scheduleAssistantSettings: { studyTargetDefaults: { math: 60 } },
    scheduleAssistantDraft: { targetDate: "2026-08-01", updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [],
    scheduleSegmentGoals: {},
  };
  const changed = {
    ...base,
    scheduleAssistantSettings: { studyTargetDefaults: { math: 90 } },
  };
  assert.notEqual(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(changed));
});

test("fingerprintPlannerPersistencePayload: a changed today-override study target changes the fingerprint", () => {
  const base = {
    scheduleAssistantSettings: {},
    scheduleAssistantDraft: { targetDate: "2026-08-01", studyTargetOverrides: { math: 60 }, updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [],
    scheduleSegmentGoals: {},
  };
  const changed = {
    ...base,
    scheduleAssistantDraft: { ...base.scheduleAssistantDraft, studyTargetOverrides: { math: 45 } },
  };
  assert.notEqual(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(changed));
});

test("fingerprintPlannerPersistencePayload: missing/undefined draft is handled without throwing", () => {
  assert.doesNotThrow(() => fingerprintPlannerPersistencePayload({}));
  assert.doesNotThrow(() => fingerprintPlannerPersistencePayload({ scheduleAssistantDraft: null }));
});

test("fingerprintPlannerPersistencePayload: a re-archived snapshot with identical content but a fresh archivedAt fingerprints the same", () => {
  // Regression: archivePlannerDraft re-stamps archivedAt every time the
  // "does this saved draft need archiving" check re-runs (e.g. a saved
  // draft whose targetDate has fallen behind the real current day) even
  // when the archived snapshot's real content is unchanged.
  const base = {
    scheduleAssistantSettings: {},
    scheduleAssistantDraft: { targetDate: "2026-08-02", updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [{ targetDate: "2026-08-02", archivedOn: "2026-08-01", archivedAt: "2026-08-01T00:00:00.000Z", todayCustomBlocks: [{ id: "a" }] }],
    scheduleSegmentGoals: {},
  };
  const reArchived = {
    ...base,
    scheduleAssistantDraftArchive: [{ ...base.scheduleAssistantDraftArchive[0], archivedAt: "2026-08-01T00:05:00.000Z" }],
  };
  assert.equal(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(reArchived));
});

test("fingerprintPlannerPersistencePayload: a real difference in archived content (not just archivedAt) still changes the fingerprint", () => {
  const base = {
    scheduleAssistantSettings: {},
    scheduleAssistantDraft: { targetDate: "2026-08-02", updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [{ targetDate: "2026-08-02", archivedAt: "2026-08-01T00:00:00.000Z", todayCustomBlocks: [{ id: "a" }] }],
    scheduleSegmentGoals: {},
  };
  const changed = {
    ...base,
    scheduleAssistantDraftArchive: [{ ...base.scheduleAssistantDraftArchive[0], todayCustomBlocks: [{ id: "a" }, { id: "b" }] }],
  };
  assert.notEqual(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(changed));
});

test("fingerprintPlannerPersistencePayload: scheduleSegmentGoals[date].updatedAt re-stamping alone doesn't count as a change", () => {
  // Regression: upsertScheduleSegmentGoalEntry re-stamps this on every
  // recompute (called from buildPlannerPersistencePayload every render),
  // millisecond-precision, so two computations within the same commit could
  // differ by 1-2ms with zero real content change.
  const base = {
    scheduleAssistantSettings: {},
    scheduleAssistantDraft: { targetDate: "2026-08-01", updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [],
    scheduleSegmentGoals: { "2026-08-01": { date: "2026-08-01", targets: { morning: { targetMinutes: 80 } }, completed: {}, updatedAt: "2026-08-01T00:00:00.000Z" } },
  };
  const recomputed = {
    ...base,
    scheduleSegmentGoals: { "2026-08-01": { ...base.scheduleSegmentGoals["2026-08-01"], updatedAt: "2026-08-01T00:00:00.002Z" } },
  };
  assert.equal(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(recomputed));
});

test("fingerprintPlannerPersistencePayload: a real change to scheduleSegmentGoals targets still changes the fingerprint", () => {
  const base = {
    scheduleAssistantSettings: {},
    scheduleAssistantDraft: { targetDate: "2026-08-01", updatedAt: "2026-08-01T00:00:00.000Z" },
    scheduleAssistantDraftArchive: [],
    scheduleSegmentGoals: { "2026-08-01": { date: "2026-08-01", targets: { morning: { targetMinutes: 80 } }, completed: {}, updatedAt: "2026-08-01T00:00:00.000Z" } },
  };
  const changed = {
    ...base,
    scheduleSegmentGoals: { "2026-08-01": { ...base.scheduleSegmentGoals["2026-08-01"], targets: { morning: { targetMinutes: 120 } } } },
  };
  assert.notEqual(fingerprintPlannerPersistencePayload(base), fingerprintPlannerPersistencePayload(changed));
});
