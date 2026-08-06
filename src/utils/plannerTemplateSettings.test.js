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

// --- content: null regression: new-shape template must not fall through to createTemplateFromLegacy ---

test("coercePlannerTemplateShape: content:null is treated as empty content, not as legacy shape", () => {
  // A new-shape template that was saved with content:null (e.g. after a bad write)
  // must be preserved as a template with empty content — NOT passed through
  // createTemplateFromLegacy, which would nest {content:null, id, name, ...} inside
  // a new content:{} wrapper and permanently corrupt user data.
  const nullContent = { id: "user-template-1", name: "我的模板", content: null, revision: 3 };
  const result = coercePlannerTemplateShape([nullContent], [], {
    normalizeTemplateContent: (c) => ({ ...c, _normalized: true }),
    createTemplateFromLegacy: () => { throw new Error("must not call createTemplateFromLegacy for new-shape templates"); },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "user-template-1");
  assert.equal(result[0].revision, 3);
  // content was normalized, not wrapped in another layer
  assert.equal(result[0].content._normalized, true);
  assert.ok(!("content" in (result[0].content || {})), "content must not be nested inside itself");
});

test("coercePlannerTemplateShape: idempotent — running twice on new-shape templates produces identical output", () => {
  const template = {
    id: "user-t", name: "用户模板", content: { wakeUpTime: "07:00", defaultTaskGroups: [] }, revision: 5,
  };
  const once = coercePlannerTemplateShape([template], []);
  const twice = coercePlannerTemplateShape(once, []);
  assert.deepEqual(once, twice, "coercePlannerTemplateShape must be idempotent for new-shape templates");
});

test("coercePlannerTemplateShape: user templates survive a no-op normalizeTemplateContent — key data is not lost", () => {
  const saved = [
    { id: "user-work", name: "工作日", content: { wakeUpTime: "06:30", defaultTaskGroups: [{ id: "g1", title: "数学" }] }, revision: 7 },
    { id: "user-rest", name: "休息日", content: { wakeUpTime: "08:00", defaultTaskGroups: [] }, revision: 2 },
  ];
  const result = coercePlannerTemplateShape(saved, []);
  assert.equal(result.length, 2);
  assert.equal(result[0].content.wakeUpTime, "06:30");
  assert.equal(result[0].content.defaultTaskGroups.length, 1);
  assert.equal(result[1].content.wakeUpTime, "08:00");
});
