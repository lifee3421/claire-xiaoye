import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("App.jsx does not contain JSX-visible CJK unicode escape text", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const jsxVisibleEscape = />[^<{}]*\\u(?:3[0-9a-fA-F]{3}|[4-9a-fA-F][0-9a-fA-F]{3})|\\u(?:3[0-9a-fA-F]{3}|[4-9a-fA-F][0-9a-fA-F]{3})[^<{}]*</;
  assert.equal(jsxVisibleEscape.test(source), false);
});

test("App.jsx reads classificationTaxonomy through resolveClassificationTaxonomy (in-memory legacy migration) at every profile-read site, and re-migrates on save", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(source, /function resolveClassificationTaxonomy\(profile = \{\}\) \{/);
  assert.match(source, /taxonomy=\{resolveClassificationTaxonomy\(data\.profile\)\}/, "DailyReviewWorkbench must read taxonomy through the migration wrapper");
  assert.match(source, /useMemo\(\(\) => resolveClassificationTaxonomy\(data\.profile\)/, "scheduler's classificationTaxonomy memo must read through the migration wrapper");
  assert.match(source, /classificationTaxonomy: resolveClassificationTaxonomy\(profile\),/, "SettingsPage's form init must read through the migration wrapper");
  assert.match(source, /const taxonomy = migrateLegacyReviewUiIntoTaxonomy\(\{/, "submitSettings must persist the migrated taxonomy on save");
});

test("App.jsx's TaxonomyManager updateNode uses a spread-patch merge ({...node, ...patch}), matching the merge-safety pattern verified in profileSubstructureMerge.test.js", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(source, /const updateNode = \(id, patch\) => updateTree\(\(nodes\) => mapTaxonomyNodes\(nodes, \(node\) => node\.id === id \? \{ \.\.\.node, \.\.\.patch \} : node\)\);/);
});

test("DailyReviewWorkbench.jsx's saveDailyReviewUi spreads the full previous dailyReviewUi before applying a partial patch, matching the merge-safety pattern verified in profileSubstructureMerge.test.js", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(source, /const next = \{ \.\.\.previous, \.\.\.partial \};/);
});
