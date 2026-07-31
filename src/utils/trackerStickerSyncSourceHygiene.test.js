// Source-text regression tests for the "Uncaught (in promise) ReferenceError:
// beijingDay is not defined" production hotfix. App.jsx has no React
// component test harness in this repo (no jsdom/React Testing Library), so
// the actual render-order bug (a useState const declared AFTER the
// component's `if (loading || (user && !data)) return <...>` early-return
// gate, read from inside a useEffect promise chain whose closure was
// captured on an early-returning render) can't be reproduced by executing
// the component. These assertions instead pin down, at the source-text
// level, the exact patterns that caused and then fixed the bug — matching
// the existing convention in sourceHygiene.test.js for properties that can
// only be verified by reading App.jsx's source, not running it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("no tracker-sync call site references the bare `beijingDay` identifier — every date argument is beijingIsoDate() or a real settlement.reviewDate", () => {
  // The exact broken pattern that shipped: closures created inside
  // useEffect/handlers that read the outer `beijingDay` const, which — on
  // a render that exits early via the loading-screen gate before reaching
  // `const [beijingDay] = useState(...)` further down the component — was
  // never initialized in that particular closure's scope.
  assert.doesNotMatch(appSource, /syncTrackerStickersForDate\(beijingDay\)/);
  assert.doesNotMatch(appSource, /suppressTrackerStickerOnDelete\([^)]*,\s*beijingDay\)/);

  // The fix: every one of the 5 real call sites uses either a fresh
  // beijingIsoDate() call (safe from anywhere, no ordering dependency —
  // it's a plain module-level function, not component state) or the
  // settlement's own reviewDate parameter (never the outer const).
  const syncCallPattern = /syncTrackerStickersForDate\((date|beijingIsoDate\(\)|settlement\.reviewDate)\)/g;
  const syncCalls = [...appSource.matchAll(syncCallPattern)];
  assert.ok(syncCalls.length >= 4, `expected at least 4 well-formed syncTrackerStickersForDate(...) call sites (date param / beijingIsoDate() / settlement.reviewDate), found ${syncCalls.length}`);
  // Every actual call — matched loosely — must be one of the well-formed
  // ones above; a stray call with any other argument (e.g. the bare
  // `beijingDay` const) would show up here as extra, unmatched calls.
  const allCalls = [...appSource.matchAll(/syncTrackerStickersForDate\([^()]*(?:\([^()]*\)[^()]*)*\)/g)];
  assert.equal(allCalls.length, syncCalls.length, "found a syncTrackerStickersForDate(...) call whose argument is not date / beijingIsoDate() / settlement.reviewDate");

  const suppressCalls = [...appSource.matchAll(/suppressTrackerStickerOnDelete\([^()]*(?:\([^()]*\)[^()]*)*\)/g)];
  assert.ok(suppressCalls.length >= 1);
  for (const [call] of suppressCalls) {
    assert.match(call, /beijingIsoDate\(\)\)$/, `suppressTrackerStickerOnDelete's date argument must be a fresh beijingIsoDate() call: got "${call}"`);
  }
});

test("applyTrackerStickerSync never reads the outer `draft` binding directly — only via commitDraftChange's `current` updater parameter", () => {
  // The second latent bug of the identical class: `draft` (like
  // `beijingDay`) is declared well after the loading-screen early-return
  // gate. The pre-fix code had `if (!trackers.length || draft.targetDate
  // !== reviewDate) return;` right before commitDraftChange — reading
  // `draft` directly would throw the same ReferenceError once the
  // beijingDay bug was fixed and this code path could actually be reached.
  const fnMatch = appSource.match(/function applyTrackerStickerSync\(trackerFactsList, reviewDate\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(fnMatch, "applyTrackerStickerSync function body not found");
  const body = fnMatch[1];
  assert.doesNotMatch(body, /\bdraft\.targetDate\b/, "must not read the outer `draft` const directly — use commitDraftChange's `current` parameter instead");
  assert.match(body, /commitDraftChange\(\(current\) => \{/);
  assert.match(body, /if \(current\.targetDate !== reviewDate\) return current;/);
});

test("the app-startup unified-tracker effect gates on loading/data before running, so its promise chain is never scheduled from an early-returning render", () => {
  const effectMatch = appSource.match(/\/\/ Entry point 1\/4:[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\}, \[enableUnifiedTracker, isFirebaseConfigured, user\?\.uid, loading, data\]\);/);
  assert.ok(effectMatch, "entry point 1 effect (with loading/data in its dependency array) not found");
  assert.match(effectMatch[1], /if \(loading \|\| \(user && !data\)\) return;/);
});

test("every unified-tracker sync promise chain (.finally after a retry/reconcile call) ends in its own .catch — no chain can produce an Uncaught (in promise)", () => {
  const chains = [...appSource.matchAll(/\.finally\(\(\) => syncTrackerStickersForDate\([^;]*?\)\)\s*\n?\s*(\.catch\(\(\) => \{\}\))?;/g)];
  assert.ok(chains.length >= 4, `expected at least 4 .finally(syncTrackerStickersForDate) chains, found ${chains.length}`);
  for (const [whole, trailingCatch] of chains) {
    assert.ok(trailingCatch, `chain must end with .catch(() => {}) after its .finally — got: "${whole.trim()}"`);
  }
});
