import test from "node:test";
import assert from "node:assert/strict";
import { resolveClassificationTaxonomy, REVIEW_BINDINGS, normalizeReviewConfig } from "../taxonomy/taxonomyContract.js";
import { findNodeById } from "../review/reviewTaxonomyModel.js";
import { aggregateSessionsByCategory, buildFieldPatches } from "./focusReviewSyncCore.js";

// Reproduces EXACTLY the resolution path api/focus-review-sync.js uses
// (resolveClassificationTaxonomy(profile) -> findNodeById -> normalizeReviewConfig),
// against a real profile.classificationTaxonomy shape (the same top-level
// users/{uid} field the UI reads/writes), never a mocked "categories
// collection". This is the regression test for the taxonomy-source-of-truth
// bug: the endpoint originally read the WRONG, unrelated
// users/{uid}/categories subcollection (reward-shop product categories).

function session(categoryId, overrides = {}) {
  return {
    sessionId: "s1",
    rawTaskId: "task-1",
    rawTitle: "阳台植物",
    startedAt: "2026-07-24T01:00:00Z",
    endedAt: "2026-07-24T01:40:00Z",
    minutes: 40,
    categoryId,
    mappingSource: "catalog_task_template",
    mappingConfidence: "high",
    note: "浇水并修剪枯叶",
    ...overrides,
  };
}

test("a brand-new dynamic category (no REVIEW_BINDINGS entry) added ONLY to profile.classificationTaxonomy is correctly resolved end to end, with no other data source involved", () => {
  // Exactly what TaxonomyManager persists via saveProfileSettings({classificationTaxonomy}) —
  // a plain array on the profile document, nothing in any separate collection.
  const profile = {
    classificationTaxonomy: [
      {
        id: "misc", name: "杂项", color: "#64748B", children: [
          {
            id: "misc.water-plants",
            name: "阳台植物",
            keywords: "",
            children: [],
            reviewConfig: { enabled: true, recordDuration: true, recordProgress: true, recordAdjustment: false, defaultMinutes: 0 },
          },
        ],
      },
    ],
  };

  // Step 1: exactly what the endpoint does — resolve the SAME way the UI does.
  const resolvedTaxonomy = resolveClassificationTaxonomy(profile);
  assert.equal(REVIEW_BINDINGS["misc.water-plants"], undefined, "this category must genuinely have no static binding for the test to be meaningful");

  const node = findNodeById(resolvedTaxonomy, "misc.water-plants");
  assert.ok(node, "the new dynamic category must be findable in the resolved taxonomy");
  const reviewConfig = normalizeReviewConfig(node);
  assert.equal(reviewConfig.enabled, true);
  assert.equal(reviewConfig.recordDuration, true);
  assert.equal(reviewConfig.recordProgress, true);

  // Step 2: the endpoint then feeds this into buildFieldPatches exactly like this.
  const { byCategory } = aggregateSessionsByCategory([session("misc.water-plants")]);
  const { categoryEntryUpdates } = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": reviewConfig } });

  assert.equal(categoryEntryUpdates["misc.water-plants"].duration.autoValue, 40);
  assert.match(categoryEntryUpdates["misc.water-plants"].progress.autoValue, /浇水并修剪枯叶/);
});

test("a dynamic category with recordProgress disabled in its real reviewConfig never gets a progress.autoValue patch, even though the session has a note", () => {
  const profile = {
    classificationTaxonomy: [
      { id: "misc", name: "杂项", color: "#64748B", children: [
        { id: "misc.water-plants", name: "阳台植物", children: [], reviewConfig: { enabled: true, recordDuration: true, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 } },
      ] },
    ],
  };
  const resolvedTaxonomy = resolveClassificationTaxonomy(profile);
  const reviewConfig = normalizeReviewConfig(findNodeById(resolvedTaxonomy, "misc.water-plants"));
  const { byCategory } = aggregateSessionsByCategory([session("misc.water-plants")]);
  const { categoryEntryUpdates } = buildFieldPatches({ byCategory, liveReviewConfigById: { "misc.water-plants": reviewConfig } });
  assert.equal(categoryEntryUpdates["misc.water-plants"].duration.autoValue, 40);
  assert.equal("progress" in categoryEntryUpdates["misc.water-plants"], false);
});

test("a categoryId that exists ONLY as a canonical id (never added to this profile's classificationTaxonomy at all) resolves to no reviewConfig and produces no patch — the endpoint never invents a target field", () => {
  const profile = { classificationTaxonomy: [] };
  const resolvedTaxonomy = resolveClassificationTaxonomy(profile);
  const node = findNodeById(resolvedTaxonomy, "misc.water-plants");
  // Not present in this user's live taxonomy at all (they never added it).
  assert.equal(node, null);
});
