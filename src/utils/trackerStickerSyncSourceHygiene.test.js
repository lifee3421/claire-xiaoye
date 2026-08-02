// Source-text regression tests for the unified-tracker sync error-handling
// rewrite (structured recordTrackerSyncFailure diagnostics + retry-mode
// routing + phase-aware banner copy, replacing the old blind
// `.catch(() => setTrackerSyncStatus("sync_failed"))` /
// `.catch(() => {})` pattern that discarded the real error and made a
// genuine production failure indistinguishable from any other). Also still
// covers the earlier beijingDay/draft ReferenceError hotfix, which this
// rewrite touches the same code paths as.
// App.jsx has no React component test harness in this repo (no jsdom/RTL),
// so these properties — which can only be verified by reading the source,
// not running the component — follow the existing sourceHygiene.test.js
// convention.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("no tracker-sync call site references the bare `beijingDay` identifier — every date argument is beijingIsoDate(), `today`, `date`, or a real settlement.reviewDate", () => {
  assert.doesNotMatch(appSource, /syncTrackerStickersForDate\(beijingDay\)/);
  assert.doesNotMatch(appSource, /suppressTrackerStickerOnDelete\([^)]*,\s*beijingDay\)/);

  const wellFormed = /syncTrackerStickersForDate\((date|today|beijingIsoDate\(\)|settlement\.reviewDate)\)/g;
  const wellFormedCalls = [...appSource.matchAll(wellFormed)];
  assert.ok(wellFormedCalls.length >= 6, `expected at least 6 well-formed syncTrackerStickersForDate(...) call sites, found ${wellFormedCalls.length}`);

  const allCalls = [...appSource.matchAll(/syncTrackerStickersForDate\([^()]*(?:\([^()]*\)[^()]*)*\)/g)];
  assert.equal(allCalls.length, wellFormedCalls.length, "found a syncTrackerStickersForDate(...) call whose argument is not date/today/beijingIsoDate()/settlement.reviewDate");

  const suppressCalls = [...appSource.matchAll(/suppressTrackerStickerOnDelete\([^()]*(?:\([^()]*\)[^()]*)*\)/g)];
  assert.ok(suppressCalls.length >= 1);
  for (const [call] of suppressCalls) {
    assert.match(call, /beijingIsoDate\(\)\)$/, `suppressTrackerStickerOnDelete's date argument must be a fresh beijingIsoDate() call: got "${call}"`);
  }
});

test("App.jsx no longer defines its own applyTrackerStickerSync — it imports the dependency-injected version from utils/trackerStickers.js", () => {
  // The actual production "ReferenceError: commitDraftChange is not
  // defined" bug: App() and <ScheduleAssistant> are two DIFFERENT React
  // component functions in this file (verified: `export default function
  // App()` and `function ScheduleAssistant(...)` are separate top-level
  // declarations) — `draft`/`commitDraftChange` are ScheduleAssistant's own
  // local state, never in scope for a plain closure written inside App().
  // applyTrackerStickerSync now lives in trackerStickers.js and takes
  // draft/commitDraftChange as explicit parameters instead.
  assert.doesNotMatch(appSource, /function applyTrackerStickerSync\(/, "applyTrackerStickerSync must not be redefined as a local closure inside App.jsx");
  assert.match(appSource, /import \{ applyTrackerStickerPlan, applyTrackerStickerSync, planTrackerSticker, suppressTrackerStickerOnDelete \} from "\.\/utils\/trackerStickers";/);
});

test("App() and ScheduleAssistant are genuinely separate component scopes, and the trackerStickerHandleRef bridge connects them", () => {
  const appIndex = appSource.indexOf("export default function App()");
  const scheduleAssistantIndex = appSource.indexOf("function ScheduleAssistant(");
  assert.ok(appIndex >= 0 && scheduleAssistantIndex > appIndex, "App() and ScheduleAssistant must be two distinct, separately-declared components");

  // App() creates the ref and hands it down as a prop.
  assert.match(appSource, /const trackerStickerHandleRef = useRef\(null\);/);
  assert.match(appSource, /<ScheduleAssistant[\s\S]{0,400}?trackerStickerHandleRef=\{trackerStickerHandleRef\}/);

  // ScheduleAssistant accepts the prop and keeps it populated with its OWN
  // draft/commitDraftChange while mounted, clearing it on unmount.
  assert.match(appSource, /function ScheduleAssistant\(\{[^}]*trackerStickerHandleRef[^}]*\}\)/);
  assert.match(appSource, /trackerStickerHandleRef\.current = \{ draft, commitDraftChange \};/);
  assert.match(appSource, /return \(\) => \{ trackerStickerHandleRef\.current = null; \};/);

  // syncTrackerStickersForDate reads the ref rather than assuming
  // commitDraftChange is a bare identifier in its own scope, and treats a
  // null ref (schedule page not open) as a clean no-op, not a thrown error.
  const syncFnMatch = appSource.match(/function syncTrackerStickersForDate\(date\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(syncFnMatch, "syncTrackerStickersForDate function body not found");
  assert.match(syncFnMatch[1], /const handle = trackerStickerHandleRef\.current;/);
  assert.match(syncFnMatch[1], /if \(!handle\) return;/);
  assert.doesNotMatch(syncFnMatch[1], /\bcommitDraftChange\(/, "syncTrackerStickersForDate itself must never call a bare commitDraftChange — only via handle.commitDraftChange, passed explicitly into applyTrackerStickerSync");
});

test("the app-startup unified-tracker effect gates on loading/data before running, so its promise chain is never scheduled from an early-returning render", () => {
  const effectMatch = appSource.match(/\/\/ Entry point 1\/4:[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\}, \[enableUnifiedTracker, isFirebaseConfigured, user\?\.uid, loading, data\]\);/);
  assert.ok(effectMatch, "entry point 1 effect (with loading/data in its dependency array) not found");
  assert.match(effectMatch[1], /if \(loading \|\| \(user && !data\)\) return;/);
});

function extractFunctionBody(name, signature) {
  const match = appSource.match(new RegExp(`function ${name}\\(${signature}\\) \\{([\\s\\S]*?)\\n  \\}\\n`));
  assert.ok(match, `${name} function body not found`);
  return match[1];
}

test("no unified-tracker sync code contains a blind, error-discarding .catch(() => {}) — every catch must funnel through recordTrackerSyncFailure", () => {
  // Direct fix for the actual complaint: a real production error (e.g. a
  // Firestore FAILED_PRECONDITION for a missing composite index, or a
  // permission-denied) was being silently swallowed, leaving only a
  // generic "sync_failed" banner with zero diagnostic information
  // anywhere, including the browser console. Scoped to just the four
  // tracker-sync functions/effects (not the whole file — other, unrelated
  // features elsewhere in this large component may have their own
  // pre-existing best-effort catches that are out of scope here).
  const trackerSyncBodies = [
    extractFunctionBody("handleRetryTrackerSync", ""),
    extractFunctionBody("syncTrackerStickersForDate", "date"),
  ];
  const entry1 = appSource.match(/\/\/ Entry point 1\/4:[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\}, \[enableUnifiedTracker, isFirebaseConfigured, user\?\.uid, loading, data\]\);/);
  const entry2 = appSource.match(/\/\/ Entry point 2\/4:[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\}, \[activeTab, enableUnifiedTracker, isFirebaseConfigured, user\?\.uid\]\);/);
  assert.ok(entry1 && entry2, "entry point 1/2 effect bodies not found");
  trackerSyncBodies.push(entry1[1], entry2[1]);

  for (const body of trackerSyncBodies) {
    assert.doesNotMatch(body, /\.catch\(\(\) => \{\}\)/, "found a blind .catch(() => {}) inside tracker-sync code — every catch must call recordTrackerSyncFailure with the real error");
  }

  const recordCalls = [...appSource.matchAll(/recordTrackerSyncFailure\(/g)];
  assert.ok(recordCalls.length >= 6, `expected at least 6 recordTrackerSyncFailure(...) call sites, found ${recordCalls.length}`);
});

test("handleRetryTrackerSync branches on the failed attempt's own retryMode — never a single hardcoded retry action, and never guards on the removed trackerSyncJobId state", () => {
  const fnMatch = appSource.match(/function handleRetryTrackerSync\(\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(fnMatch, "handleRetryTrackerSync function body not found");
  const body = fnMatch[1];
  assert.match(body, /failure\.retryMode === "reconcile_job"/);
  assert.match(body, /failure\.retryMode === "sticker_only"/);
  assert.match(body, /retryPendingReconcileJobsForUser\(user\.uid/); // the "sweep" fallback branch
  // The old bug: `if (!trackerSyncJobId ...) return;` could be true even
  // while the failure banner was visible (a sweep failure never had a
  // jobId to begin with, so the button silently no-op'd). The new guard
  // reads the failure's own recorded status instead of a separate,
  // sometimes-unset piece of state.
  assert.doesNotMatch(appSource, /const \[trackerSyncJobId/, "the old separate trackerSyncJobId useState must be fully removed — retry reads failure.jobId instead");
  assert.doesNotMatch(appSource, /setTrackerSyncJobId\(/, "the old setTrackerSyncJobId setter must no longer be called anywhere");
  assert.match(body, /if \(!failure \|\| failure\.status !== "sync_failed"\) return;/);
});

test("the banner only renders when trackerSyncBanner is non-null (no unearned banner on load), and sync_failed copy is phase-aware, never a single hardcoded string", () => {
  assert.match(appSource, /shouldShowUnifiedTrackerBanner\(\{ enableUnifiedTracker, isFirebaseConfigured \}\) && trackerSyncBanner && trackerSyncBanner\.status !== "synced" && \(/);
  assert.match(appSource, /\{bannerTextForFailure\(trackerSyncBanner\.phase\)\}/);
  assert.doesNotMatch(appSource, /<span>复盘已保存，但追踪同步失败<\/span>/, "the old single hardcoded failure string must be gone — copy must vary by phase via bannerTextForFailure");
});

test("syncTrackerStickersForDate is gated on shouldRunUnifiedTrackerSweep (which is false whenever enableUnifiedTracker is 0/false) before touching fetchTrackerFacts, the ref, or anything else", () => {
  const syncFnMatch = appSource.match(/function syncTrackerStickersForDate\(date\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(syncFnMatch, "syncTrackerStickersForDate function body not found");
  assert.match(syncFnMatch[1], /if \(!shouldRunUnifiedTrackerSweep\(\{ enableUnifiedTracker, isFirebaseConfigured, uid: user\?\.uid \}\) \|\| !date\) return;/);
});

test("a successful sync auto-hides the banner after a delay (showTrackerSyncSynced schedules a timeout back to null)", () => {
  assert.match(appSource, /trackerSyncSuccessTimeoutRef\.current = setTimeout\(\(\) => setTrackerSyncBanner\(null\), \d+\);/);
});

test("showTrackerSyncSynced replaces the banner with a clean {status:\"synced\"} object — no leftover phase/code/message/jobId from a previous failure", () => {
  const fnMatch = appSource.match(/function showTrackerSyncSynced\(\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(fnMatch, "showTrackerSyncSynced function body not found");
  assert.match(fnMatch[1], /setTrackerSyncBanner\(\{ status: "synced" \}\);/, "must set a fresh { status: \"synced\" } object, never spread ...previousFailure onto it");
});
