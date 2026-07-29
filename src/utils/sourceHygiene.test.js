import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("App.jsx does not contain JSX-visible CJK unicode escape text", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const jsxVisibleEscape = />[^<{}]*\\u(?:3[0-9a-fA-F]{3}|[4-9a-fA-F][0-9a-fA-F]{3})|\\u(?:3[0-9a-fA-F]{3}|[4-9a-fA-F][0-9a-fA-F]{3})[^<{}]*</;
  assert.equal(jsxVisibleEscape.test(source), false);
});

test("Reminder Plan sending reuses the one browser-local Cyberboss connection and never calls the Vercel proxy", () => {
  const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const senderSource = fs.readFileSync(new URL("../agent/catkeeperSnapshotSender.js", import.meta.url), "utf8");
  assert.match(appSource, /sendReminderPlan\(plan\)/);
  assert.doesNotMatch(appSource, /\/api\/reminder-plan-sync/);
  assert.match(senderSource, /\$\{normalized\.baseUrl\}\/events\/catkeeper\/reminder-plan/);
  assert.match(senderSource, /Authorization: `Bearer \$\{normalized\.token\}`/);
  assert.equal(fs.existsSync(new URL("../../api/reminder-plan-sync.js", import.meta.url)), false);
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

test("DailyReviewWorkbench.jsx fires the once-per-mount, never-awaited autoRequestYesterdaySyncIfDue() background request, and ReviewToolbar.jsx renders the current-date FocusSyncDateButton next to the date picker", () => {
  const workbenchSource = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(workbenchSource, /autoRequestYesterdaySyncIfDue \} from "\.\.\/agent\/catkeeperSnapshotSender\.js"/);
  assert.match(workbenchSource, /useEffect\(\(\) => \{\s*autoRequestYesterdaySyncIfDue\(\)\.catch\(\(\) => \{\}\);\s*\}, \[\]\);/, "must fire once on mount, never awaited, with an empty dependency array so it never re-fires on date switches");

  const toolbarSource = fs.readFileSync(new URL("../review/ReviewToolbar.jsx", import.meta.url), "utf8");
  assert.match(toolbarSource, /import FocusSyncDateButton from "\.\/FocusSyncDateButton\.jsx"/);
  assert.match(toolbarSource, /<FocusSyncDateButton date=\{date\} \/>/, "the button must use the currently-viewed date, not a hardcoded today");
});

test("FocusSyncDateButton.jsx prevents a double-submit while syncing and never reloads the page — the real Firestore subscription is what updates the UI after a successful sync", () => {
  const source = fs.readFileSync(new URL("../review/FocusSyncDateButton.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(phase === "syncing"\) return;/, "must ignore a click that arrives while already syncing");
  assert.match(source, /disabled=\{phase === "syncing"\}/);
  assert.doesNotMatch(source, /window\.location\.reload|location\.href\s*=/, "must never do a full page reload — updates come from the Firestore subscription");
});

test("DailyReviewWorkbench.jsx's change()/restore() parent-total recompute uses resolveEffectiveReviewNumericValue on each part, never a raw child.value sum — a Focus-only child (never typed, only autoValue) must still count toward the recomputed parent total", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(source, /resolveEffectiveReviewNumericValue \} from "\.\/effectiveReviewValue\.js"/);
  assert.match(source, /total\.parts\.reduce\(\(sum, part\) => sum \+ resolveEffectiveReviewNumericValue\(next\.fields\[part\]\), 0\)/, "change()'s parent-total recompute must sum effective values");
  assert.match(source, /field\.parts\.reduce\(\(sum, part\) => sum \+ resolveEffectiveReviewNumericValue\(current\.fields\[part\]\), 0\)/, "restore()'s recompute must also sum effective values");
  assert.doesNotMatch(source, /Number\(next\.fields\[part\]\?\.value \|\| 0\)|Number\(current\.fields\[part\]\?\.value \|\| 0\)/, "must never fall back to reading raw child.value for a parts recompute");
});

test("7. points breakdown labels distinguish minutes-equivalent credit (学习价值分钟/运动价值分钟, shown with 'min') from genuine already-converted points (shown with '分') — avoids the unit confusion that made studyCredit=0 read as a points bug", () => {
  const preview = fs.readFileSync(new URL("../review/PointsSettlementPreview.jsx", import.meta.url), "utf8");
  assert.match(preview, /\["学习价值分钟", "studyCredit", "min"\]/);
  assert.match(preview, /\["运动价值分钟", "exerciseCredit", "min"\]/);
  assert.match(preview, /\["时间价值转分", "bankPointsAdded", "分"\]/);
  const previewRowsLine = preview.split("\n").find((line) => line.includes("学习价值分钟"));
  assert.doesNotMatch(previewRowsLine, /学习入账/);

  const overview = fs.readFileSync(new URL("../review/DailyReviewOverview.jsx", import.meta.url), "utf8");
  assert.match(overview, /\["学习价值分钟", "studyCredit", "min"\]/);
  assert.match(overview, /\["运动价值分钟", "exerciseCredit", "min"\]/);
  const overviewRowsLine = overview.split("\n").find((line) => line.includes("学习价值分钟"));
  assert.doesNotMatch(overviewRowsLine, /学习入账/);
});

test("1/2. SnowDustCard (DailyReviewOverview.jsx) always shows a single '发给雪尘' button — no '编辑'/textarea manual-entry path, no 未来由Cyberboss自动填入 placeholder text", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewOverview.jsx", import.meta.url), "utf8");
  assert.match(source, /\{phase === "sending" \? "雪尘正在看…" : "发给雪尘"\}/);
  assert.doesNotMatch(source, /<textarea/, "the manual-edit textarea must be removed entirely");
  assert.doesNotMatch(source, /"编辑"|"完成"/);
  assert.doesNotMatch(source, /未来由 ?Cyberboss ?自动填入/);
});

test("2. SnowDustCard uses the CURRENTLY VIEWED date prop, never a fixed today() — DailyReviewOverview receives `date` from DailyReviewWorkbench's own `date` state", () => {
  const overview = fs.readFileSync(new URL("../review/DailyReviewOverview.jsx", import.meta.url), "utf8");
  assert.match(overview, /function SnowDustCard\(\{ date, draft, taxonomy, settlement, onApplyCommentary, disabled \}\)/);
  assert.match(overview, /requestSnowDustCommentary\(date, inputRevision, review, loadConnectionSettings\(\)\)/);
  const workbench = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(workbench, /<DailyReviewOverview\s*\n\s*date=\{date\}/);
});

test("5/6/7. SnowDustCard ignores a click while already sending (no concurrent/duplicate requests) and shows a real window.confirm overwrite warning only when a commentary already exists", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewOverview.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(phase === "sending" \|\| disabled\) return;/);
  assert.match(source, /if \(noteText\) \{\s*const proceed = window\.confirm\("这会替换当前的雪尘批注，继续吗？"\);\s*if \(!proceed\) return;\s*\}/);
});

test("8. a failed/error commentary request never clears or overwrites the existing note text — only the error state changes, and onApplyCommentary is only ever called inside the success (result.status === 'generated') branch", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewOverview.jsx", import.meta.url), "utf8");
  assert.match(source, /setErrorMessage\(describeSnowDustCommentaryStatus\(result\.status, result\.reason\)\);\s*setPhase\("error"\);/);
  const onApplyCalls = [...source.matchAll(/onApplyCommentary\(/g)];
  assert.equal(onApplyCalls.length, 1, "onApplyCommentary must be called from exactly one place");
  const callIndex = onApplyCalls[0].index;
  const precedingContext = source.slice(Math.max(0, callIndex - 120), callIndex);
  assert.match(precedingContext, /result\.status === "generated"/, "the single onApplyCommentary call must be gated on the success status, never the error path");
});

test("9/10. the real save path (applySnowDustCommentary in DailyReviewWorkbench.jsx) uses applySnowDustCommentaryToDraft, never the generic change()/onChange handler, and persists immediately even on an already-submitted day", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(source, /const applySnowDustCommentary = \(result\) => \{\s*const next = stampClientRevision\(applySnowDustCommentaryToDraft\(draft, result\)\);/);
  assert.doesNotMatch(source, /change\("snowDust\.note"/, "must never route a generated commentary through the manual-edit change() path");
  // The generic debounced autosave effect intentionally skips
  // draft.status === "submitted" days; applySnowDustCommentary must save
  // directly via runAutoDraftSave instead of relying on that effect, so a
  // commentary generated for an already-submitted (e.g. historical) day is
  // never silently lost on refresh.
  assert.match(source, /const applySnowDustCommentary = \(result\) => \{[\s\S]*?runAutoDraftSave\(\{[\s\S]*?\}\);\s*\};/);
});

test("dataService.saveProfileSettings only writes focusSyncSettings when its VALUE is a real object, never defaulting a missing/null value to {} (that would wrongly mark an untouched user as having explicitly cleared their config)", () => {
  const source = fs.readFileSync(new URL("../services/dataService.js", import.meta.url), "utf8");
  assert.match(source, /if \(settings\.focusSyncSettings && typeof settings\.focusSyncSettings === "object"\) payload\.focusSyncSettings = settings\.focusSyncSettings;/);
  assert.doesNotMatch(source, /payload\.focusSyncSettings = settings\.focusSyncSettings \|\| \{\}/, "must never coerce a missing focusSyncSettings into an empty object before writing");
});

test("desk verification settings are saved through the existing profile settings path", () => {
  const source = fs.readFileSync(new URL("../services/dataService.js", import.meta.url), "utf8");
  assert.match(source, /if \("snowdustDeskVerification" in settings\) payload\.snowdustDeskVerification = settings\.snowdustDeskVerification \|\| \{\};/);
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

test("the real category-management leaf editor only exposes enabled/recordDuration/recordProgress/recordAdjustment — the old 常驻显示 taxonomy-page pin is gone, cross-date visibility is now the card's own 快捷项设置", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("function TaxonomyReviewConfigFields(");
  const end = source.indexOf("function TaxonomyFocusAliasFields", start);
  const section = source.slice(start, end);
  assert.doesNotMatch(section, /显示方式/, "the removed 显示方式 dropdown must not come back");
  assert.doesNotMatch(section, /常驻显示/, "常驻显示 must be gone from taxonomy settings — quick-field settings owns cross-date visibility now");
  assert.match(section, /checked=\{config\.enabled === true\}/, "enabled must be a plain checkbox again, not tied to a display-mode select");
  assert.doesNotMatch(section, /\bpinned\b/, "TaxonomyReviewConfigFields must no longer accept/use a pinned prop");
  assert.doesNotMatch(source, /onDisplayModeChange/, "the display-mode setter/prop must be fully removed");
  // pinnedCategoryIds itself is still read (App.jsx's TaxonomyManager still
  // cleans up stale pins on archive, and DailyReviewWorkbench still reads it
  // for the one-time quickDurationFields migration) — only the UI that lets
  // a user SET a new pin is gone.
  assert.match(source, /pinnedCategoryIds/);
  assert.match(source, /pinnedCategoryIds\.filter\(\(id\) => id !== node\.id\)/, "delete/archive must still remove a stale pin");
});

test("the timeline editor writes smart start verification without a study kind", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /smart:study_ready/);
  assert.match(source, /value=\{form\.startVerificationMethod === "smart" \? "smart"/);
  assert.match(source, /form\.startVerificationMethod === "smart" \? \{\} : \{ kind: form\.startVerificationKind \}/);
});

test("DailyReviewWorkbench.jsx actually wires applyAutomaticSleepDuration into the input flow — recomputes on every bedtime/wakeTime edit and once on first load, never only leaving the pure helper unused", () => {
  const source = fs.readFileSync(new URL("../review/DailyReviewWorkbench.jsx", import.meta.url), "utf8");
  assert.match(source, /import \{ applyAutomaticSleepDuration \} from "\.\/sleepDuration\.js";/);
  assert.match(source, /if \(SLEEP_CLOCK_FIELD_IDS\.includes\(id\)\) \{\s*next\.fields = applyAutomaticSleepDuration\(next\.fields\)\.fields;/, "change() must recompute sleep duration whenever a sleep clock field changes");
  assert.match(source, /const nextDraft = \{ \.\.\.loadedDraft, fields: applyAutomaticSleepDuration\(loadedDraft\.fields\)\.fields \};/, "first hydration of a date must recompute once, in case an old draft never had this wiring");
  assert.match(source, /const restoreSleepAutomatic = \(\) => setDraftLocal/, "must expose a dedicated restore-to-automatic handler, not reuse the generic restore() (which would use a possibly-stale autoValue)");
  assert.match(source, /onRestoreSleepAutomatic=\{restoreSleepAutomatic\}/, "the handler must actually be passed down to the UI");
});
