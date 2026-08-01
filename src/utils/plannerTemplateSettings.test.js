import test from "node:test";
import assert from "node:assert/strict";
import { coercePlannerTemplateShape, resolvePersistedDefaultDayTemplateId, plannerValuesDeepEqual } from "./plannerTemplateSettings.js";

// --- coercePlannerTemplateShape: shape migration only, never injects -----

test("coercePlannerTemplateShape: a saved list missing some factory templates is returned as-is, nothing is injected", () => {
  const saved = [{ id: "custom-1", systemKey: undefined, content: { wakeUpTime: "07:00" }, revision: 2 }];
  const result = coercePlannerTemplateShape(saved, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "custom-1");
});

test("coercePlannerTemplateShape: an empty saved list stays empty — no factory seeds get manufactured", () => {
  assert.deepEqual(coercePlannerTemplateShape([], []), []);
  assert.deepEqual(coercePlannerTemplateShape(undefined, []), []);
});

test("coercePlannerTemplateShape: filters out templates whose systemKey was explicitly deleted", () => {
  const saved = [
    { id: "a", systemKey: "builtin-standard", content: {} },
    { id: "b", systemKey: "builtin-commute", content: {} },
  ];
  const result = coercePlannerTemplateShape(saved, ["builtin-commute"]);
  assert.deepEqual(result.map((t) => t.id), ["a"]);
});

test("coercePlannerTemplateShape: legacy (no-content) templates are migrated via the injected createTemplateFromLegacy", () => {
  const legacy = { id: "legacy-1", wakeUpTime: "06:30" };
  const migrated = { id: "legacy-1", content: { wakeUpTime: "06:30" } };
  const result = coercePlannerTemplateShape([legacy], [], { createTemplateFromLegacy: () => migrated });
  assert.deepEqual(result, [migrated]);
});

// --- resolvePersistedDefaultDayTemplateId: never auto-repaired -----------

test("resolvePersistedDefaultDayTemplateId: a saved id pointing at nothing currently valid is kept as-is, not repointed", () => {
  assert.equal(resolvePersistedDefaultDayTemplateId("template-that-no-longer-exists"), "template-that-no-longer-exists");
});

test("resolvePersistedDefaultDayTemplateId: no saved id at all -> empty string, not a silently-chosen first template", () => {
  assert.equal(resolvePersistedDefaultDayTemplateId(undefined), "");
  assert.equal(resolvePersistedDefaultDayTemplateId(""), "");
});

// --- plannerValuesDeepEqual: the guard behind "no autosave on plain load" ---

test("plannerValuesDeepEqual: identical content in two different object references is equal", () => {
  const a = { dayTemplates: [{ id: "x", content: { wakeUpTime: "07:00" } }] };
  const b = { dayTemplates: [{ id: "x", content: { wakeUpTime: "07:00" } }] };
  assert.equal(plannerValuesDeepEqual(a, b), true);
});

test("plannerValuesDeepEqual: a real content difference is not equal", () => {
  const a = { dayTemplates: [{ id: "x", content: { wakeUpTime: "07:00" } }] };
  const b = { dayTemplates: [{ id: "x", content: { wakeUpTime: "08:00" } }] };
  assert.equal(plannerValuesDeepEqual(a, b), false);
});

test("plannerValuesDeepEqual: same reference short-circuits to true", () => {
  const a = { anything: "at-all" };
  assert.equal(plannerValuesDeepEqual(a, a), true);
});
