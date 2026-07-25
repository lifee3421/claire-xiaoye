import test from "node:test";
import assert from "node:assert/strict";
import { buildCatkeeperCategoryCatalog } from "./buildCategoryCatalog.js";
import { CANONICAL_TAXONOMY_V3, LEGACY_CATEGORY_ALIASES } from "../taxonomy/taxonomyContract.js";

test("builds a public category catalog with full level 1/2/3 tree, keeping custom/unrecognized categories intact", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: [{
      id: "study",
      name: "Study",
      children: [{ id: "development", name: "Development", color: "#123456", keywords: "personal alias" }],
    }],
    scheduleSettings: {
      commonTasks: [{ id: "task-1", title: "Build project", categoryId: "development" }],
      dayTemplates: [{ content: { defaultTaskGroups: [{ templateItemId: "task-2", title: "Review code", categoryId: "development" }] } }],
    },
  });
  assert.deepEqual(catalog, {
    schemaVersion: 2,
    generatedAt: "2026-07-17T01:02:03.000Z",
    categories: [
      { categoryId: "study", name: "Study", level: 1, parentId: null, keywords: "", legacyAliases: [], reviewBinding: null, reviewConfig: null, archived: false, archivedAt: "", focusAliases: [] },
      { categoryId: "development", name: "Development", level: 2, parentId: "study", keywords: "personal alias", legacyAliases: [], reviewBinding: null, reviewConfig: { enabled: false, recordDuration: false, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 }, archived: false, archivedAt: "", focusAliases: [] },
    ],
    taskTemplates: [
      { taskId: "task-1", title: "Build project", categoryId: "development" },
      { taskId: "task-2", title: "Review code", categoryId: "development" },
    ],
    legacyAliases: { ...LEGACY_CATEGORY_ALIASES },
  });
  assert.equal("focusSyncSettings" in catalog, false, "must be OMITTED (not sent as an empty object) when the caller passes no focusSyncSettings at all — Cyberboss relies on this absence to fall back to its local JSON config");
});

test("focusSyncSettings.projectBucketMap is emitted verbatim (trimmed, non-empty entries only) so Cyberboss can prefer it over its local JSON fallback", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: [{ id: "misc", name: "杂项" }],
    focusSyncSettings: { projectBucketMap: { personal: "misc", " others ": " misc ", "": "misc", blank: "" } },
  });
  assert.deepEqual(catalog.focusSyncSettings, { projectBucketMap: { personal: "misc", others: "misc" } });
});

test("focusSyncSettings is omitted (not defaulted to {}) when the caller sends nothing at all", () => {
  const catalog = buildCatkeeperCategoryCatalog({ now: new Date("2026-07-17T01:02:03.000Z"), taxonomy: [] });
  assert.equal(catalog.focusSyncSettings, undefined);
});

test("focusSyncSettings IS included, even as an explicitly empty projectBucketMap, when the caller passes a real (if empty) object — the user has configured this and cleared it, not never touched it", () => {
  const catalog = buildCatkeeperCategoryCatalog({ now: new Date("2026-07-17T01:02:03.000Z"), taxonomy: [], focusSyncSettings: { projectBucketMap: {} } });
  assert.deepEqual(catalog.focusSyncSettings, { projectBucketMap: {} });
});

test("catalog emits canonical categoryId, level, parentId, keywords, legacyAliases and reviewBinding for the full v3 tree, including level-3 nodes", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: CANONICAL_TAXONOMY_V3,
  });

  const calculus = catalog.categories.find((row) => row.categoryId === "study.math.calculus");
  assert.equal(calculus.level, 3);
  assert.equal(calculus.parentId, "study.math");
  assert.equal(calculus.keywords, "高数,高等数学,微积分");
  assert.deepEqual(calculus.reviewBinding, { duration: "study.math.calculus.duration", progress: "study.math.calculus.progress", adjustment: "study.math.calculus.adjustment", sources: ["reviewSchema.js", "dailyReviewSchema.js"] });

  const linearAlgebra = catalog.categories.find((row) => row.categoryId === "study.math.linearAlgebra");
  assert.deepEqual(linearAlgebra.legacyAliases, ["study.math.linear"]);

  const studyMath = catalog.categories.find((row) => row.categoryId === "study.math");
  assert.deepEqual(studyMath.legacyAliases, ["math"]);
  assert.equal(studyMath.level, 2);
  assert.equal(studyMath.parentId, "study");

  const hobby = catalog.categories.find((row) => row.categoryId === "hobby");
  assert.ok(hobby, "hobby primary category must be present");
  const creativeWriting = catalog.categories.find((row) => row.categoryId === "hobby.creativeWriting");
  assert.equal(creativeWriting.parentId, "hobby");
  assert.deepEqual(creativeWriting.reviewBinding, { duration: "hobby.creativeWriting.duration", progress: "hobby.creativeWriting.progress", sources: ["dailyReviewSchema.js (this phase)"] });

  const social = catalog.categories.find((row) => row.categoryId === "social");
  assert.ok(social, "social placeholder primary category must be present in the tree even though it has no children/fields");

  assert.deepEqual(catalog.legacyAliases, LEGACY_CATEGORY_ALIASES);
});

test("every non-root category's parentId in the catalog resolves to another categoryId actually present in the same catalog", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: CANONICAL_TAXONOMY_V3,
  });
  const ids = new Set(catalog.categories.map((row) => row.categoryId));
  catalog.categories.forEach((row) => {
    if (row.level === 1) {
      assert.equal(row.parentId, null, `level-1 category ${row.categoryId} must have null parentId`);
      return;
    }
    assert.ok(row.parentId, `non-root category ${row.categoryId} must have a parentId`);
    assert.ok(ids.has(row.parentId), `parentId "${row.parentId}" of ${row.categoryId} must resolve to a category present in this catalog`);
  });
});

test("task template categoryId is normalized from legacy to canonical form", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: CANONICAL_TAXONOMY_V3,
    scheduleSettings: {
      commonTasks: [{ id: "task-legacy", title: "背单词", categoryId: "study.english.ielts-writing" }],
    },
  });
  assert.deepEqual(catalog.taskTemplates, [
    { taskId: "task-legacy", title: "背单词", categoryId: "study.english.ieltsWriting" },
  ]);
});

test("catalog emits reviewConfig (leaves only, null for group headings), archived and archivedAt per category", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: [{
      id: "misc", name: "杂项", children: [
        { id: "misc.plantCare", name: "浇花", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 10 }, archived: true, archivedAt: "2026-07-20" },
      ],
    }],
  });
  const misc = catalog.categories.find((row) => row.categoryId === "misc");
  assert.equal(misc.reviewConfig, null, "group headings (nodes with children) must not carry reviewConfig");

  const plantCare = catalog.categories.find((row) => row.categoryId === "misc.plantCare");
  assert.deepEqual(plantCare.reviewConfig, { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 10 });
  assert.equal(plantCare.archived, true);
  assert.equal(plantCare.archivedAt, "2026-07-20");
});

test("archived categories are still emitted in the catalog (tagged, not filtered out) — Cyberboss needs to see them to avoid mapping new Focus entries to them", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: [{ id: "work", name: "工作", children: [{ id: "work.redCross", name: "红会", children: [], archived: true }] }],
  });
  const redCross = catalog.categories.find((row) => row.categoryId === "work.redCross");
  assert.ok(redCross, "archived category must still appear in the catalog");
  assert.equal(redCross.archived, true);
});

// ---------------------------------------------------------------------------
// Cyberboss v2 receiver compatibility (2026-07-24 audit; extended 2026-07-25
// as part of the Focus title/alias matching phase — this time as a genuinely
// coordinated cross-repo change, not a read-only mirror the receiver ignores).
//
// The live Cyberboss instance's SUPPORTED_SCHEMA_VERSIONS is Set([1, 2])
// (E:\Cyberboss\src\services\catkeeper-category-catalog-service.js) —
// anything else THROWS ERR_CATKEEPER_CATALOG_SCHEMA and is hard-rejected, not
// just ignored. This repo must never send schemaVersion !== 2 without also
// updating that receiver. These tests re-implement that receiver's exact v2
// validation/reconstruction logic (read-only reference, not imported across
// repos) so a regression here fails loudly instead of silently at delivery
// time in production. As of 2026-07-25 the receiver now ALSO picks up
// archived/reviewConfig/focusAliases (previously silently dropped) — Focus
// title matching needs archived state and focusAliases to work at all.
// ---------------------------------------------------------------------------

const CYBERBOSS_SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);

// Mirrors validateCatalogV2() in catkeeper-category-catalog-service.js.
function cyberbossValidateCatalogV2(value) {
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const categories = (Array.isArray(value.categories) ? value.categories : [])
    .map((row) => ({
      categoryId: text(row?.categoryId),
      name: text(row?.name),
      level: Number.isFinite(Number(row?.level)) ? Number(row.level) : null,
      parentId: row?.parentId == null ? null : text(row.parentId) || null,
      keywords: text(row?.keywords),
      legacyAliases: Array.isArray(row?.legacyAliases) ? row.legacyAliases.map(text).filter(Boolean) : [],
      reviewBinding: row?.reviewBinding && typeof row.reviewBinding === "object" ? row.reviewBinding : null,
      archived: row?.archived === true,
      reviewConfig: row?.reviewConfig && typeof row.reviewConfig === "object" ? row.reviewConfig : null,
      focusAliases: Array.isArray(row?.focusAliases) ? row.focusAliases.map(text).filter(Boolean) : [],
    }))
    .filter((row) => row.categoryId && row.name && Number.isFinite(row.level));
  return { schemaVersion: 2, categories };
}

function cyberbossValidateCatalog(value) {
  if (!value || !CYBERBOSS_SUPPORTED_SCHEMA_VERSIONS.has(value.schemaVersion) || !Number.isFinite(Date.parse(value.generatedAt))) {
    const err = new Error("schemaVersion must be one of [1, 2] and generatedAt is required");
    err.code = "ERR_CATKEEPER_CATALOG_SCHEMA";
    throw err;
  }
  if (value.schemaVersion === 2) return cyberbossValidateCatalogV2(value);
  return { schemaVersion: 1, categories: value.categories };
}

test("Cyberboss v2 compat: this repo sends schemaVersion 2, matching the live receiver's SUPPORTED_SCHEMA_VERSIONS — never 3", () => {
  const catalog = buildCatkeeperCategoryCatalog({ now: new Date("2026-07-24T00:00:00.000Z"), taxonomy: CANONICAL_TAXONOMY_V3 });
  assert.equal(catalog.schemaVersion, 2);
  assert.doesNotThrow(() => cyberbossValidateCatalog(catalog));
});

test("Cyberboss v2 compat: reviewConfig/archived/focusAliases are picked up by the (now updated) receiver, never dropped and never breaking any v2-required field", () => {
  const taxonomy = [{ id: "work", name: "工作", children: [{ id: "work.redCross", name: "红会", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: true, defaultMinutes: 0 }, archived: true, archivedAt: "2026-07-20", focusAliases: ["红十字会"] }] }];
  const catalog = buildCatkeeperCategoryCatalog({ now: new Date("2026-07-24T00:00:00.000Z"), taxonomy });
  const accepted = cyberbossValidateCatalog(catalog);
  const redCross = accepted.categories.find((row) => row.categoryId === "work.redCross");
  assert.ok(redCross, "the category must still be accepted");
  assert.equal(redCross.name, "红会");
  assert.equal(redCross.level, 2);
  assert.equal(redCross.parentId, "work");
  assert.equal(redCross.archived, true);
  assert.deepEqual(redCross.reviewConfig, { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: true, defaultMinutes: 0 });
  assert.deepEqual(redCross.focusAliases, ["红十字会"]);
});

test("Cyberboss v2 compat: a hypothetical schemaVersion 3 payload would be hard-rejected by the live receiver (documents why this repo must not send it)", () => {
  const catalog = buildCatkeeperCategoryCatalog({ now: new Date("2026-07-24T00:00:00.000Z"), taxonomy: CANONICAL_TAXONOMY_V3 });
  const wouldBeV3 = { ...catalog, schemaVersion: 3 };
  assert.throws(() => cyberbossValidateCatalog(wouldBeV3), { code: "ERR_CATKEEPER_CATALOG_SCHEMA" });
});
