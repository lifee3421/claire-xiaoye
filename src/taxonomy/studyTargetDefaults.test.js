import test from "node:test";
import assert from "node:assert/strict";
import {
  listStudyTargetCategories,
  normalizeStudyTargetDefaults,
  resolveStudyTargetDefaultsForTree,
  totalEnabledMinutes,
} from "./studyTargetDefaults.js";
import { normalizeClassificationTaxonomy } from "./taxonomyContract.js";

const tree = normalizeClassificationTaxonomy();

test("listStudyTargetCategories includes study and reading, excludes other statGroups", () => {
  const categories = listStudyTargetCategories(tree);
  const ids = categories.map((c) => c.categoryId);
  assert.ok(ids.includes("study.math"));
  assert.ok(ids.includes("study.english"));
  assert.ok(ids.includes("study.reading"));
  assert.ok(!ids.includes("personal"));
  assert.ok(!ids.includes("exercise"));
});

test("listStudyTargetCategories excludes archived categories", () => {
  const archivedTree = normalizeClassificationTaxonomy([
    { id: "study", name: "学习", children: [
      { id: "study.math", name: "数学", statGroup: "study", archived: true, children: [] },
    ] },
  ]);
  const ids = listStudyTargetCategories(archivedTree).map((c) => c.categoryId);
  assert.ok(!ids.includes("study.math"));
});

test("normalizeStudyTargetDefaults safely defaults missing/legacy input", () => {
  assert.deepEqual(normalizeStudyTargetDefaults(undefined), { schemaVersion: 1, entries: {} });
  assert.deepEqual(normalizeStudyTargetDefaults(null), { schemaVersion: 1, entries: {} });
  const normalized = normalizeStudyTargetDefaults({ entries: { math: { enabled: true, minutes: 240 } } });
  // legacy bare id "math" normalizes to "study.math"
  assert.deepEqual(normalized.entries["study.math"], { enabled: true, minutes: 240 });
});

test("normalizeStudyTargetDefaults allows 0 minutes and rejects negative", () => {
  const normalized = normalizeStudyTargetDefaults({ entries: { "study.math": { enabled: true, minutes: 0 }, "study.english": { enabled: true, minutes: -5 } } });
  assert.equal(normalized.entries["study.math"].minutes, 0);
  assert.equal(normalized.entries["study.english"].minutes, 0);
});

test("resolveStudyTargetDefaultsForTree fills unset eligible categories with enabled:false minutes:0", () => {
  const resolved = resolveStudyTargetDefaultsForTree({
    defaults: { entries: { "study.math": { enabled: true, minutes: 240 } } },
    categoryTree: tree,
  });
  const math = resolved.find((c) => c.categoryId === "study.math");
  const english = resolved.find((c) => c.categoryId === "study.english");
  assert.deepEqual(math, { categoryId: "study.math", label: "数学", statGroup: "study", enabled: true, minutes: 240 });
  assert.equal(english.enabled, false);
  assert.equal(english.minutes, 0);
});

test("totalEnabledMinutes sums only enabled entries", () => {
  const resolved = resolveStudyTargetDefaultsForTree({
    defaults: { entries: { "study.math": { enabled: true, minutes: 240 }, "study.english": { enabled: false, minutes: 999 }, "study.reading": { enabled: true, minutes: 60 } } },
    categoryTree: tree,
  });
  assert.equal(totalEnabledMinutes(resolved), 300);
});

test("does not hardcode a fixed default total across all categories", () => {
  const resolved = resolveStudyTargetDefaultsForTree({ defaults: undefined, categoryTree: tree });
  assert.equal(totalEnabledMinutes(resolved), 0);
});
