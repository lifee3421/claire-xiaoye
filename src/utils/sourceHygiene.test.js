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
  assert.match(source, /resolveClassificationTaxonomy,[\s\S]{0,80}?\} from "\.\/taxonomy\/taxonomyContract"/, "resolveClassificationTaxonomy must be imported from the single shared taxonomy module, not redefined locally");
  assert.match(source, /taxonomy=\{resolveClassificationTaxonomy\(data\.profile\)\}/, "DailyReviewWorkbench must read taxonomy through the migration wrapper");
  assert.match(source, /useMemo\(\(\) => resolveClassificationTaxonomy\(data\.profile\)/, "scheduler's classificationTaxonomy memo must read through the migration wrapper");
  assert.match(source, /classificationTaxonomy: resolveClassificationTaxonomy\(profile\),/, "SettingsPage's form init must read through the migration wrapper");
  assert.match(source, /const taxonomy = migrateLegacyReviewUiIntoTaxonomy\(\{/, "submitSettings must persist the migrated taxonomy on save");
});

test("App.jsx's TaxonomyManager updateNode uses a spread-patch merge ({...node, ...patch}) for the actual tree write, matching the merge-safety pattern verified in profileSubstructureMerge.test.js — the duplicate-name check that now precedes it only ever returns early, never alters the merge itself", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(source, /updateTree\(\(nodes\) => mapTaxonomyNodes\(nodes, \(node\) => node\.id === id \? \{ \.\.\.node, \.\.\.patch \} : node\)\);/);
});

test("DailyReviewWorkbench.jsx's saveDailyReviewUi spreads the full previous dailyReviewUi before applying a partial patch, matching the merge-safety pattern verified in profileSubstructureMerge.test.js", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(source, /const next = \{ \.\.\.previous, \.\.\.partial \};/);
});

test("DailyReviewWorkbench.jsx decouples background autosave from the toolbar/settlement-bar buttons: buttons use isSubmitting (formal submit only), not the shared saveState-based `saving` that also flips on every autosave tick", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(source, /const \[isSubmitting, setIsSubmitting\] = useState\(false\);/);
  assert.match(source, /saving=\{isSubmitting \|\| !loaded\}/, "toolbar buttons must not disable/relabel on every autosave tick");
  assert.match(source, /saving=\{isSubmitting \|\| !loaded \|\| legacyReadOnly\}/, "settlement bar button must not disable/relabel on every autosave tick");
});

test("TaxonomyFocusAliasFields: add rejects empty/whitespace-only input, trims before storing, and dedupes by normalized text (not exact string)", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function TaxonomyFocusAliasFields(");
  const end = source.indexOf("function FocusSyncSettingsPanel(", start);
  assert.ok(start >= 0 && end > start, "TaxonomyFocusAliasFields must exist, immediately followed by FocusSyncSettingsPanel");
  const body = source.slice(start, end);
  assert.match(body, /const value = draft\.trim\(\);/, "input must be trimmed before use");
  assert.match(body, /if \(!value\) return;/, "empty/whitespace-only input must be rejected, not saved as a blank alias");
  assert.match(body, /normalizeFocusMatchTextForUi\(existing\) === normalized/, "dedupe must compare NORMALIZED text, not the raw string (so '线代' and '线代 ' don't both get saved)");
  assert.match(body, /onChange\(\{ focusAliases: \[\.\.\.aliases, value\] \}\)/, "the alias is stored with its original (trimmed) casing/width, only the comparison is normalized");
  assert.doesNotMatch(body, /\.taskId\b/, "the alias editor must never read or display node.taskId — users maintain aliases by name only");
});

test("TaxonomyFocusAliasFields writes only node.focusAliases via the leaf onChange patch, never touching name/color/order/reviewConfig", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function TaxonomyFocusAliasFields(");
  const end = source.indexOf("function FocusSyncSettingsPanel(", start);
  const body = source.slice(start, end);
  const onChangeCalls = [...body.matchAll(/onChange\(\{([^}]*)\}\)/g)].map((m) => m[1]);
  assert.ok(onChangeCalls.length > 0, "must call onChange at least once (add + remove)");
  for (const patchBody of onChangeCalls) {
    assert.match(patchBody.trim(), /^focusAliases:/, `onChange patch must only ever set focusAliases, got: ${patchBody}`);
  }
});

test("buildReferencedCategoryTokens no longer scans settlements (history is frozen/self-contained via taxonomySnapshot and must never block deleting a current category); it scans current unsettled dailyReviewDrafts + schedule instead", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(source, /function buildReferencedCategoryTokens\(\{ dailyReviewDrafts = \[\], profile = \{\} \} = \{\}\) \{/);
  const start = source.indexOf("function buildReferencedCategoryTokens(");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  const stringifyLine = body.split("\n").find((line) => line.includes("JSON.stringify"));
  assert.match(stringifyLine, /dailyReviewDrafts, scheduleAssistantDraft: profile\.scheduleAssistantDraft/);
  assert.doesNotMatch(stringifyLine, /\bsettlements\b/, "settlements must never feed the delete-blocking token set again");
  assert.match(source, /referencedTokens=\{buildReferencedCategoryTokens\(\{ dailyReviewDrafts, profile \}\)\}/);
  assert.match(source, /dailyReviewDrafts=\{data\.dailyReviewDrafts \|\| \[\]\}\s*\n\s*agentSnapshot=\{agentDaySnapshot\}/, "SettingsPage must actually receive dailyReviewDrafts so the reference check has current-draft data to scan");
});

test("DailyReviewWorkbench.jsx wires the Focus-override-conflict banner and restore button to the pure focusOverrideConflicts helpers, not an ad-hoc inline implementation", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(source, /findFocusOverrideConflicts, restoreFocusOverrideValues \} from "\.\/focusOverrideConflicts\.js"/);
  assert.match(source, /const focusOverrideConflicts = useMemo\(\(\) => findFocusOverrideConflicts\(draft\), \[draft\]\);/);
  assert.match(source, /restoreFocusOverrideValues\(current, focusOverrideConflicts\.map\(\(item\) => item\.fieldId\)\)/);
  assert.match(source, /恢复 Focus 值/);
});

test("dataService.saveProfileSettings only writes focusSyncSettings when its VALUE is a real object, never defaulting a missing/null value to {} (that would wrongly mark an untouched user as having explicitly cleared their config)", () => {
  const source = fs.readFileSync(new URL("../services/dataService.js", import.meta.url), "utf8");
  assert.match(source, /if \(settings\.focusSyncSettings && typeof settings\.focusSyncSettings === "object"\) payload\.focusSyncSettings = settings\.focusSyncSettings;/);
  assert.doesNotMatch(source, /payload\.focusSyncSettings = settings\.focusSyncSettings \|\| \{\}/, "must never coerce a missing focusSyncSettings into an empty object before writing");
});

test("SettingsPage's form.focusSyncSettings defaults to null (not { projectBucketMap: {} }) when profile.focusSyncSettings is absent", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(source, /focusSyncSettings: profile\.focusSyncSettings && typeof profile\.focusSyncSettings === "object" \? profile\.focusSyncSettings : null,/);
});

test("FocusSyncSettingsPanel spreads the full previous focusSyncSettings before patching projectBucketMap, matching the dailyReviewUi merge-safety pattern", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function FocusSyncSettingsPanel(");
  const end = source.indexOf("function TaxonomyDetail(", start);
  assert.ok(start >= 0 && end > start, "FocusSyncSettingsPanel must exist, immediately followed by TaxonomyDetail");
  const body = source.slice(start, end);
  assert.match(body, /onChange\(\{ \.\.\.\(focusSyncSettings \|\| \{\}\), projectBucketMap: nextMap \}\)/, "must spread the previous focusSyncSettings object before overwriting projectBucketMap, so sibling settings fields survive a save");
  assert.match(body, /const listKey = normalizeFocusMatchTextForUi\(listDraft\);/, "list names must be stored normalized (matching Cyberboss's own lookup key)");
});

test("no review component uses an unstable React key (bare index, or a key baking in saving/value state) that would remount controls on every autosave tick or edit", () => {
  const reviewDir = new URL("../review/", import.meta.url);
  const files = fs.readdirSync(reviewDir).filter((name) => name.endsWith(".jsx"));
  const badKeyPattern = /key=\{`[^`]*(saving|value)[^`]*`\}|key=\{index\}/;
  const offenders = [];
  files.forEach((name) => {
    const content = fs.readFileSync(new URL(name, reviewDir), "utf8");
    if (badKeyPattern.test(content)) offenders.push(name);
  });
  assert.deepEqual(offenders, []);
});

test("TaxonomyManager's updateNode rejects a duplicate sibling name (via findDuplicateSiblingName) before ever calling updateTree/onChange", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function TaxonomyManager(");
  const end = source.indexOf("function TaxonomyTreeNode(", start);
  assert.ok(start >= 0 && end > start, "TaxonomyManager must exist, immediately followed by TaxonomyTreeNode");
  const body = source.slice(start, end);
  assert.match(body, /const duplicate = findDuplicateSiblingName\(siblings, patch\.name, id\);/);
  assert.match(body, /if \(duplicate\) \{[\s\S]{0,200}?return;\s*\}/, "must return WITHOUT calling updateTree when a duplicate is found");
});

test("TaxonomyManager's deleteOrArchive uses evaluateDeleteEligibility (never a silent archive fallback) and confirms with the real category name before either action", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("const deleteOrArchive = (node) => {");
  const end = source.indexOf("const moveNode = (node, direction)", start);
  assert.ok(start >= 0 && end > start, "deleteOrArchive must exist, immediately followed by moveNode");
  const body = source.slice(start, end);
  assert.match(body, /evaluateDeleteEligibility\(\{ node, isCanonicalId, referencedTokens \}\)/);
  assert.match(body, /window\.confirm\(`确认彻底删除"\$\{taxonomyNodeLabel\(node\)\}/, "the permanent-delete path must confirm with the real category name");
  assert.match(body, /window\.confirm\(`"\$\{taxonomyNodeLabel\(node\)\}"无法彻底删除：\$\{eligibility\.reason\}/, "the blocked (archive-only) path must tell the user WHY, with the real category name, before archiving");
});
