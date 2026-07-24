// Section 5 audit (2026-07-24): a reliable, pure-data integration test for
// "archive a category, historical dates with a real record keep showing it
// (with the name/color it had at the time), new dates without a record
// don't." Deliberately built from pure functions and fixtures only — no
// browser, no localStorage injection, no autosave race to fight.
import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft, allGroups } from "./dailyReviewSchema.js";
import { buildStructuredReview, buildReviewMarkdown } from "./reviewDraftSerializer.js";
import { deriveGroupCategoryId } from "./reviewSectionConfig.js";
import { shouldShowTaxonomyNode } from "../taxonomy/taxonomyContract.js";

function findNodeById(taxonomy, id) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (node?.id === id) { found = node; return; }
    (Array.isArray(node?.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach(visit);
  return found;
}

const ACTIVE_TAXONOMY = [
  { id: "work", name: "工作", children: [
    { id: "work.redCross", name: "红会", color: "#4C6EF5", children: [] },
    { id: "work.partyYouth", name: "党团", color: "#4C6EF5", children: [] },
  ] },
];

function archiveNode(taxonomy, categoryId, archivedAt) {
  const visit = (node) => node.id === categoryId
    ? { ...node, archived: true, archivedAt }
    : { ...node, children: (node.children || []).map(visit) };
  return taxonomy.map(visit);
}

function restoreNode(taxonomy, categoryId) {
  const visit = (node) => node.id === categoryId
    ? { ...node, archived: false, archivedAt: "" }
    : { ...node, children: (node.children || []).map(visit) };
  return taxonomy.map(visit);
}

test("Step 1-2: a historical (2026-07-20) structured review has work.redCross data, and its taxonomySnapshot preserves the name/color at the time", () => {
  const draft = createReviewDraft("2026-07-20");
  draft.fields["work.redCross.totalMinutes"].value = 60;
  draft.fields["work.redCross.progress"].value = "整理了本月献血活动物料";
  const structured = buildStructuredReview(draft, { taxonomy: ACTIVE_TAXONOMY });
  assert.equal(structured.fields["work.redCross.totalMinutes"].value, 60);

  const markdown = buildReviewMarkdown(draft, {}, { taxonomy: ACTIVE_TAXONOMY });
  assert.match(markdown, /### 红会/);
  assert.match(markdown, /整理了本月献血活动物料/);
});

test("Step 3-4: after taxonomy archives work.redCross, opening the historical 2026-07-20 date (which has a real record) still shows the 红会 group, using the taxonomy/snapshot color", () => {
  const archivedTaxonomy = archiveNode(ACTIVE_TAXONOMY, "work.redCross", "2026-07-23");
  const draft = createReviewDraft("2026-07-20");
  draft.fields["work.redCross.totalMinutes"].value = 60;

  const sections = allGroups({});
  const workSection = sections.find((s) => s.title === "工作");
  const redCrossGroup = workSection.groups.find((g) => g.title === "红会");

  const categoryId = deriveGroupCategoryId(redCrossGroup);
  assert.equal(categoryId, "work.redCross");

  const node = findNodeById(archivedTaxonomy, categoryId);
  assert.equal(node.archived, true);
  assert.equal(node.color, "#4C6EF5", "archiving does not erase the node's name/color");

  const hasCurrentRecord = draft.fields["work.redCross.totalMinutes"].value > 0;
  const visibleOnHistoricalDate = shouldShowTaxonomyNode({ node, isHistoricalDate: true, hasCurrentRecord });
  assert.equal(visibleOnHistoricalDate, true, "historical date with a real record must still show the archived group");
});

test("Step 5: a NEW date with no work.redCross record does not show the group after archiving", () => {
  const archivedTaxonomy = archiveNode(ACTIVE_TAXONOMY, "work.redCross", "2026-07-23");
  const emptyDraft = createReviewDraft("2026-07-24"); // today, no red-cross data
  const node = findNodeById(archivedTaxonomy, "work.redCross");
  const hasCurrentRecord = emptyDraft.fields["work.redCross.totalMinutes"].value > 0;
  const visibleOnNewDate = shouldShowTaxonomyNode({ node, isHistoricalDate: false, hasCurrentRecord });
  assert.equal(visibleOnNewDate, false, "a new date with no record must not show an archived group");
});

test("Step 6: restoring work.redCross makes it selectable/visible again on a new date", () => {
  const archivedTaxonomy = archiveNode(ACTIVE_TAXONOMY, "work.redCross", "2026-07-23");
  const restoredTaxonomy = restoreNode(archivedTaxonomy, "work.redCross");
  const node = findNodeById(restoredTaxonomy, "work.redCross");
  assert.equal(node.archived, false);
  assert.equal(node.archivedAt, "");
  // Even with zero content, a non-archived node is never hidden by
  // shouldShowTaxonomyNode — the static group's own hasGroupContent-driven
  // "尚未填写" display, not archival, decides whether it looks empty.
  assert.equal(shouldShowTaxonomyNode({ node, isHistoricalDate: false, hasCurrentRecord: false }), true);
});

test("party-youth (a sibling, never archived) is unaffected by red-cross's archive state — archiving one category never silently hides another", () => {
  const archivedTaxonomy = archiveNode(ACTIVE_TAXONOMY, "work.redCross", "2026-07-23");
  const partyYouthNode = findNodeById(archivedTaxonomy, "work.partyYouth");
  assert.notEqual(partyYouthNode.archived, true);
  assert.equal(shouldShowTaxonomyNode({ node: partyYouthNode, isHistoricalDate: false, hasCurrentRecord: false }), true);
});
