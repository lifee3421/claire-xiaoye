// Regression suite for the "「保存初版」入口不见了" report.
//
// FINDING (read-only audit, see review-baseline-entry-audit.md): nothing was
// deleted. `保存初版` was introduced by affce4b6 and no commit on any ref ever
// removed it; the flag `baselinePlanTrackEnabled` has been default-on since
// 544c36b; App.jsx's button count is byte-identical to 822c8a8 (320 vs 320).
//
// The entry vanished because `baselinePlanSnapshot` was never scoped to a
// date at read time. It is written with the date it was captured on, carried
// verbatim through every draft rebuild (normalizeScheduleAssistantDraft),
// copied into every future-day draft by generateFuturePlans, and cleared by
// nothing. Both readers — `hasBaseline()` and an inlined copy of it in
// App.jsx — only asked "does snapshot.targetDate exist?", never "does it match
// THIS draft's targetDate?". So the first baseline the user ever saved made
// every subsequent day render 覆盖初版 instead of 保存初版, permanently.
//
// These tests pin the per-date semantics that baselinePlanModel.js's file
// header ("scoped to a single planning date") and createBaselinePlanSnapshot's
// docstring ("Freeze the plan exactly as first confirmed for a date ... only
// invoke this once per date") always specified but never enforced.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createBaselinePlanSnapshot,
  hasBaseline,
  isBaselineForDate,
  isCurrentPlanIdenticalToBaseline,
  isSupersededBlockStatus,
} from "./baselinePlanModel.js";
import { normalizeScheduleAssistantDraft } from "../utils/plannerNormalization.js";

const APP_SOURCE = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

// Mirrors App.jsx's baseline entry render block (the flag gate at
// `plannerFeatureFlags.baselinePlanTrackEnabled` plus the
// `hasBaselineSnapshot ? 覆盖初版 : 保存初版` branch). Test #11 asserts the real
// JSX still has this exact shape so the mirror cannot silently drift.
function resolveBaselineEntry(draft, { baselinePlanTrackEnabled = true } = {}) {
  if (!baselinePlanTrackEnabled) return { rendered: false, label: null, confirmedAtTag: null, snapshotForStrip: null };
  const activeBaselineSnapshot = hasBaseline(draft) ? draft.baselinePlanSnapshot : null;
  return {
    rendered: true,
    label: activeBaselineSnapshot ? "覆盖初版" : "保存初版",
    confirmedAtTag: activeBaselineSnapshot?.confirmedAt ?? null,
    snapshotForStrip: activeBaselineSnapshot,
  };
}

// Mirrors App.jsx's saveBaselineNow(): guard on hasBaselineSnapshot, then
// snapshot only the LIVE blocks of the current auto-schedule.
function simulateSaveBaselineNow(draft, autoScheduleBlocks, confirmedAt) {
  if (hasBaseline(draft)) return { action: "overwrite-prompt", draft };
  const liveBlocks = (autoScheduleBlocks || []).filter((block) => !isSupersededBlockStatus(block.status));
  return {
    action: "saved",
    draft: {
      ...draft,
      baselinePlanSnapshot: createBaselinePlanSnapshot({ targetDate: draft.targetDate, confirmedAt, blocks: liveBlocks }),
    },
  };
}

const TODAY = "2026-08-03";
const YESTERDAY = "2026-08-02";
const BLOCKS = [
  { id: "b1", kind: "task", start: 540, end: 600, title: "论文" },
  { id: "b2", kind: "task", start: 600, end: 660, title: "英语" },
];

// ---------------------------------------------------------------- 1. 无 baseline 时入口存在

test("#1 a draft with no baseline renders the 保存初版 entry", () => {
  const draft = { targetDate: TODAY, baselinePlanSnapshot: null };
  const entry = resolveBaselineEntry(draft);
  assert.equal(entry.rendered, true);
  assert.equal(entry.label, "保存初版");
  assert.equal(entry.confirmedAtTag, null, "no baseline means no 初版 timestamp tag");
});

test("#2 the entry is only ever hidden by the baselinePlanTrackEnabled flag, which defaults on", () => {
  const draft = { targetDate: TODAY, baselinePlanSnapshot: null };
  assert.equal(resolveBaselineEntry(draft, { baselinePlanTrackEnabled: false }).rendered, false);
  // readNewPlannerUiFlags returns true unless ?baselinePlanTrackEnabled=0, so
  // the default path must render.
  assert.equal(resolveBaselineEntry(draft).rendered, true);
});

// ---------------------------------------------------------------- 2. 保存后 snapshot 正确生成

test("#3 saving the baseline freezes the live blocks under the draft's own targetDate", () => {
  const draft = { targetDate: TODAY, baselinePlanSnapshot: null };
  const result = simulateSaveBaselineNow(draft, BLOCKS, "2026-08-03T01:00:00.000Z");
  assert.equal(result.action, "saved");
  const snapshot = result.draft.baselinePlanSnapshot;
  assert.equal(snapshot.targetDate, TODAY);
  assert.equal(snapshot.confirmedAt, "2026-08-03T01:00:00.000Z");
  assert.deepEqual(snapshot.blocks.map((b) => b.id), ["b1", "b2"]);
  assert.equal(hasBaseline(result.draft), true);
});

test("#4 superseded blocks are excluded from the frozen baseline, and the study target stays decoupled", () => {
  const draft = { targetDate: TODAY, baselinePlanSnapshot: null };
  const withHistory = [...BLOCKS, { id: "b3", kind: "task", start: 700, end: 760, status: "cancelled" }];
  const snapshot = simulateSaveBaselineNow(draft, withHistory, "t").draft.baselinePlanSnapshot;
  assert.deepEqual(snapshot.blocks.map((b) => b.id), ["b1", "b2"], "cancelled/rescheduled history must not enter the baseline");
  // saveBaselineNow deliberately passes no targetSnapshot (spec section 5):
  // saving the baseline must not capture or mutate the study-target state.
  assert.equal(snapshot.targetSnapshot, null);
});

// ---------------------------------------------------------------- 3. 刷新后仍存在

test("#5 the baseline survives a reload through normalizeScheduleAssistantDraft", () => {
  const saved = simulateSaveBaselineNow({ targetDate: TODAY, baselinePlanSnapshot: null }, BLOCKS, "t").draft;
  const reloaded = normalizeScheduleAssistantDraft(saved, { fallbackTargetDate: TODAY });
  assert.equal(reloaded.baselinePlanSnapshot.targetDate, TODAY);
  assert.deepEqual(reloaded.baselinePlanSnapshot.blocks.map((b) => b.id), ["b1", "b2"]);
  assert.equal(hasBaseline(reloaded), true);
  assert.equal(resolveBaselineEntry(reloaded).label, "覆盖初版", "after reload the same date must still show its baseline");
});

// ---------------------------------------------------------------- 4. 已有 baseline 时按原设计显示/隐藏

test("#6 a same-date baseline flips the entry to 覆盖初版 and reveals the 初版 timestamp tag", () => {
  const draft = { targetDate: TODAY, baselinePlanSnapshot: { targetDate: TODAY, confirmedAt: "2026-08-03T01:00:00.000Z", blocks: BLOCKS } };
  const entry = resolveBaselineEntry(draft);
  assert.equal(entry.label, "覆盖初版");
  assert.equal(entry.confirmedAtTag, "2026-08-03T01:00:00.000Z");
  assert.notEqual(entry.snapshotForStrip, null, "the 初版 strip must receive the same-date snapshot");
});

test("#7 the 初版 strip stays hidden while the plan is unchanged and appears once it diverges", () => {
  const draft = { targetDate: TODAY, baselinePlanSnapshot: { targetDate: TODAY, confirmedAt: "t", blocks: BLOCKS } };
  const snapshot = resolveBaselineEntry(draft).snapshotForStrip;
  const baselineBlocks = snapshot.blocks.filter((b) => b.kind === "task" && b.status !== "cancelled");
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks: BLOCKS }), true, "unchanged plan => strip hidden");
  const moved = [{ ...BLOCKS[0], start: 545, end: 605 }, BLOCKS[1]];
  assert.equal(isCurrentPlanIdenticalToBaseline({ baselineBlocks, currentBlocks: moved }), false, "moved block => strip shown");
});

// ------------------------------------------- 5. 跨日期不复用（本次真因的直接回归）

test("#8 REGRESSION: yesterday's baseline must not hide today's 保存初版 entry", () => {
  // Exactly the reported symptom. Before the fix hasBaseline() returned true
  // here (snapshot.targetDate merely existed), so the entry rendered 覆盖初版
  // on every day after the first baseline the user ever saved.
  const draft = { targetDate: TODAY, baselinePlanSnapshot: { targetDate: YESTERDAY, confirmedAt: "2026-08-02T01:00:00.000Z", blocks: BLOCKS } };
  assert.equal(isBaselineForDate(draft.baselinePlanSnapshot, draft.targetDate), false);
  assert.equal(hasBaseline(draft), false);
  const entry = resolveBaselineEntry(draft);
  assert.equal(entry.label, "保存初版", "a foreign-date baseline must not consume today's save entry");
  assert.equal(entry.confirmedAtTag, null, "yesterday's confirmedAt must not be shown as today's 初版 time");
  assert.equal(entry.snapshotForStrip, null, "the 初版 strip must never diff today's plan against another day's snapshot");
});

test("#9 clicking 保存初版 with a stale foreign-date baseline saves today's baseline instead of prompting to overwrite", () => {
  const draft = { targetDate: TODAY, baselinePlanSnapshot: { targetDate: YESTERDAY, confirmedAt: "old", blocks: [] } };
  const result = simulateSaveBaselineNow(draft, BLOCKS, "2026-08-03T02:00:00.000Z");
  assert.equal(result.action, "saved", "no overwrite confirm dialog — this date had no baseline");
  assert.equal(result.draft.baselinePlanSnapshot.targetDate, TODAY);
  assert.equal(result.draft.baselinePlanSnapshot.confirmedAt, "2026-08-03T02:00:00.000Z");
});

test("#10 a stale baseline inherited by generateFuturePlans' date copies is inert, not authoritative", () => {
  // generateFuturePlans builds each future draft with makeScheduleDraft({
  // ...draft, targetDate }) — the spread carries today's baselinePlanSnapshot
  // into every future date verbatim. The date guard makes those copies inert.
  const today = { targetDate: TODAY, baselinePlanSnapshot: { targetDate: TODAY, confirmedAt: "t", blocks: BLOCKS } };
  for (const futureDate of ["2026-08-04", "2026-08-05", "2026-08-06"]) {
    const futureDraft = { ...today, targetDate: futureDate };
    assert.equal(hasBaseline(futureDraft), false, `${futureDate} inherited a snapshot but must still offer 保存初版`);
    assert.equal(resolveBaselineEntry(futureDraft).label, "保存初版");
  }
});

test("#11 isBaselineForDate rejects every partial/absent shape instead of throwing", () => {
  assert.equal(isBaselineForDate(null, TODAY), false);
  assert.equal(isBaselineForDate(undefined, TODAY), false);
  assert.equal(isBaselineForDate({ targetDate: TODAY }, ""), false);
  assert.equal(isBaselineForDate({ targetDate: TODAY }, undefined), false);
  assert.equal(isBaselineForDate({}, TODAY), false);
  assert.equal(isBaselineForDate({ targetDate: null }, TODAY), false);
  assert.equal(isBaselineForDate({ targetDate: TODAY }, TODAY), true);
});

// ---------------------------------------------------- 不影响「发送给雪尘」/ 自动捕获

test("#12 the Snow-dust send flow neither reads nor writes baselinePlanSnapshot", () => {
  // spec section 5: saving the baseline and syncing the plan are fully
  // decoupled — a missing token / CORS failure must never affect 保存初版, and
  // an absent baseline must never block the 雪尘 sync.
  const sendFlow = APP_SOURCE.slice(APP_SOURCE.indexOf("async function sendReminderPlanToSnowDust"), APP_SOURCE.indexOf("// ---- Baseline (初版计划) explicit save"));
  assert.ok(sendFlow.length > 0, "the send flow must precede the baseline block in App.jsx");
  assert.doesNotMatch(sendFlow, /baselinePlanSnapshot/, "sending to 雪尘 must not touch the baseline snapshot");
  assert.doesNotMatch(sendFlow, /createBaselinePlanSnapshot/, "sending to 雪尘 must never auto-capture a baseline");
});

test("#13 baselinePlanSnapshot is only ever written by the two explicit user actions", () => {
  const writes = [...APP_SOURCE.matchAll(/baselinePlanSnapshot:\s*createBaselinePlanSnapshot/g)];
  assert.equal(writes.length, 2, "exactly two writers: saveBaselineNow and overwriteBaselineNow — no implicit capture anywhere else");
  assert.match(APP_SOURCE, /async function saveBaselineNow\(\)/);
  assert.match(APP_SOURCE, /async function overwriteBaselineNow\(\)/);
});

// ---------------------------------------------------------------- 接线断言（防漂移）

test("#14 App.jsx resolves the baseline through the shared date-aware guard, not an inlined existence check", () => {
  assert.match(
    APP_SOURCE,
    /const activeBaselineSnapshot = hasBaseline\(draft\) \? draft\.baselinePlanSnapshot : null;/,
    "the entry must gate on hasBaseline(draft), which compares snapshot.targetDate against draft.targetDate",
  );
  assert.match(APP_SOURCE, /const hasBaselineSnapshot = Boolean\(activeBaselineSnapshot\);/);
  assert.match(APP_SOURCE, /const baselineConfirmedAt = activeBaselineSnapshot\?\.confirmedAt;/);
  assert.doesNotMatch(
    APP_SOURCE,
    /Boolean\(draft\.baselinePlanSnapshot && draft\.baselinePlanSnapshot\.targetDate\)/,
    "the old date-blind inline copy must not come back",
  );
  assert.match(APP_SOURCE, /import \{ createBaselinePlanSnapshot, hasBaseline,/, "hasBaseline must come from baselinePlanModel, not be redefined locally");
});

test("#15 the 初版 strip receives the date-resolved snapshot, never draft.baselinePlanSnapshot directly", () => {
  assert.match(APP_SOURCE, /baselineSnapshot=\{activeBaselineSnapshot\}/);
  assert.doesNotMatch(APP_SOURCE, /baselineSnapshot=\{draft\.baselinePlanSnapshot\}/);
});

test("#16 the save/overwrite entry JSX still matches the shape resolveBaselineEntry mirrors", () => {
  assert.match(APP_SOURCE, /\{plannerFeatureFlags\.baselinePlanTrackEnabled && \(/, "the flag gate must stay");
  assert.match(APP_SOURCE, /\{hasBaselineSnapshot \? \(/, "the two-branch entry must stay");
  assert.match(APP_SOURCE, /onClick=\{overwriteBaselineNow\}>\s*覆盖初版/);
  assert.match(APP_SOURCE, /onClick=\{saveBaselineNow\}>\s*保存初版/);
  assert.match(APP_SOURCE, /\{baselineConfirmedAt && \(/, "the 初版 timestamp tag must stay bound to the resolved confirmedAt");
});
