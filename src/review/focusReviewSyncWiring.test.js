import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CATKEEPER_CATEGORY_CATALOG_SCHEMA_VERSION } from "../agent/buildCategoryCatalog.js";

function readSource(relativePath) {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), relativePath), "utf8");
}

test("31. Category Catalog stays schemaVersion 2 — this round did not upgrade it to v3", () => {
  assert.equal(CATKEEPER_CATEGORY_CATALOG_SCHEMA_VERSION, 2);
});

test("DailyReviewWorkbench.jsx wires a Focus-sync-specific revision marker (independent of clientRevision) and calls mergeRemoteFocusProjection, never full-replacing the draft for a Focus-only update", () => {
  const source = readSource("DailyReviewWorkbench.jsx");
  assert.match(source, /import \{ mergeRemoteFocusProjection \} from "\.\/mergeRemoteFocusProjection\.js"/);
  assert.match(source, /lastAcceptedFocusRevisionRef/);
  assert.match(source, /lastFocusFieldProjectionRef/);
  assert.match(source, /remoteFocusSync\.sourceRevision !== lastAcceptedFocusRevisionRef\.current/);
  assert.match(source, /mergeRemoteFocusProjection\(current, savedDraft, \{ previousFieldProjection \}\)/);
});

test("29. the top-of-page Focus sync status line is a single compact <p>, not a large card, and reads from draft.focusSync/focusSummary", () => {
  const source = readSource("DailyReviewWorkbench.jsx");
  assert.match(source, /draft\.focusSync && \(/);
  assert.match(source, /<p className="review-focus-sync-status">/);
  assert.match(source, /focusSyncStatusText\(draft\.focusSync, draft\.focusSummary\)/);
});

test("a settled-day sync surfaces the exact required revision-prompt copy", () => {
  const source = readSource("DailyReviewWorkbench.jsx");
  assert.match(source, /结算后 Focus 数据有变化，请修订复盘/);
});
