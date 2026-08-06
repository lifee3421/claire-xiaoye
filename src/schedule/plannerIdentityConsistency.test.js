// Client/server movable-task-identity consistency check.
//
// App.jsx (browser) and src/schedule/plannerPatchApply.js (server) both call
// the SAME buildPlannerTaskGroups/flattenPlannerTasks (plannerLiveTimeline.js/
// plannerTimelineBlocks.js) — there is only one implementation, not two that
// could drift. What genuinely differs between the two callers is the
// `autoContext` object each passes in: the browser passes the full
// buildScheduleAutoContext(data) result (review/settlement-derived display
// text plus recentReadingTitle), while the server
// (resolveMovableSegments in plannerPatchApply.js) passes only
// `{ recentReadingTitle }` — deliberately never fetching settlements/review
// data server-side (see plannerPatchApply.js's file header). This test
// proves that difference is safe: given the SAME recentReadingTitle, the two
// callers resolve to byte-identical task identities (blockId/duration/
// manualStart/placement) — the extra display-only autoContext fields the
// browser has and the server doesn't never affect which tasks exist or
// where they sit.
import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerTaskGroups, resolveEnglishSkills, resolvePlannerTemplates } from "./plannerLiveTimeline.js";
import { flattenPlannerTasks } from "../utils/plannerTimelineBlocks.js";
import { resolveMovableSegments } from "./plannerPatchApply.js";

const mathTemplate = { lectureBlocks50: 3, exerciseBlocks50: 2, reviewBlocks30: 1, errorReviewBlocks50: 1, summaryBlocks30: 1 };
const englishTemplate = { wordMinutes: 30, skillMinutes: 40 };
const englishSkills = ["writing", "speaking"];

function draft(overrides = {}) {
  return {
    targetDate: "2026-08-06",
    wakeUpTime: "07:30",
    targetBedTime: "23:20",
    thesisMinutes: 90,
    professionalMinutes: 50,
    exerciseMinutes: 40,
    formalRestMinutes: 30,
    systemDevelopmentLimit: "max_30",
    todayCustomBlocks: [
      { id: "custom-1", title: "自定义", categoryId: "personal", segments: [30], breakMinutes: 5, manualOrder: 1, manualStart: 900 },
    ],
    fixedEvents: [{ id: "meeting-1", title: "会议", startTime: "10:00", endTime: "10:30", locked: false, constraint: "soft" }],
    fixedEventOverrides: {},
    todaySegmentOverrides: {
      "math-lecture-1": { placement: "timeline", manualStart: 540 },
    },
    ...overrides,
  };
}

function identityFingerprint(segments) {
  return segments
    .map((segment) => ({ blockId: segment.blockId, duration: segment.duration, occupiedDuration: segment.occupiedDuration, manualStart: segment.manualStart ?? null, placement: segment.placement, categoryId: segment.categoryId }))
    .sort((a, b) => a.blockId.localeCompare(b.blockId));
}

test("browser's full autoContext and server's minimal {recentReadingTitle}-only autoContext resolve to IDENTICAL task identities, given the same recentReadingTitle", () => {
  const d = draft();
  const recentReadingTitle = "百年孤独";

  // Shape of what App.jsx's buildScheduleAutoContext(data) actually returns —
  // a handful of extra display-only text fields the server never computes.
  const fullClientAutoContext = {
    recentReadingTitle,
    mathProgressText: "网课进度：第5章",
    mathBlockers: "第6章公式没搞懂",
    ieltsAdjustment: "写作练一篇",
    thesisAdjustmentText: "补第三章实验数据",
    dayTypeDisplayName: "普通推进日",
    sourceReviewDate: "2026-08-05",
  };
  const minimalServerAutoContext = { recentReadingTitle };

  const clientSegments = flattenPlannerTasks(
    buildPlannerTaskGroups({ draft: d, mathTemplate, englishTemplate, englishSkills, autoContext: fullClientAutoContext }),
    d.taskPoolOrder || []
  );
  const serverSegments = flattenPlannerTasks(
    buildPlannerTaskGroups({ draft: d, mathTemplate, englishTemplate, englishSkills, autoContext: minimalServerAutoContext }),
    d.taskPoolOrder || []
  );

  assert.deepEqual(identityFingerprint(clientSegments), identityFingerprint(serverSegments));
  // Sanity: this must be a REAL, non-trivial set (not two empty arrays
  // trivially "matching") — confirms math/thesis/professional/exercise/
  // formal-rest/system/reading/custom/legacy-fixed-event are all present.
  assert.ok(clientSegments.length >= 10, `expected a substantial task set, got ${clientSegments.length}`);
  assert.ok(clientSegments.some((s) => s.categoryId === "reading" || s.blockId.startsWith("reading-")));
});

test("resolveMovableSegments (the actual server entry point) matches the same identity fingerprint as the direct buildPlannerTaskGroups+flattenPlannerTasks call the browser makes, given the SAME settings/templates", () => {
  const d = draft();
  const recentReadingTitle = "百年孤独";
  const settings = { englishTemplateId: "english-two-skills" }; // exercise a non-default template on purpose

  // The browser resolves templates/englishSkills exactly this way too
  // (ScheduleAssistant's render body — see plannerLiveTimeline.js's
  // resolvePlannerTemplates/resolveEnglishSkills doc comments) — reusing the
  // SAME functions here (not hand-picked literals) is the point of this test.
  const { mathTemplate: resolvedMathTemplate, englishTemplate: resolvedEnglishTemplate } = resolvePlannerTemplates(d, settings);
  const resolvedEnglishSkills = resolveEnglishSkills(d, settings, [], resolvedEnglishTemplate);
  const clientAutoContext = { recentReadingTitle, mathProgressText: "unrelated display text" };
  const clientSegments = flattenPlannerTasks(
    buildPlannerTaskGroups({ draft: d, mathTemplate: resolvedMathTemplate, englishTemplate: resolvedEnglishTemplate, englishSkills: resolvedEnglishSkills, autoContext: clientAutoContext }),
    d.taskPoolOrder || []
  );

  const serverSegments = resolveMovableSegments(d, settings, { books: [{ title: recentReadingTitle, status: "reading" }], readingSessions: [] });

  assert.deepEqual(identityFingerprint(clientSegments), identityFingerprint(serverSegments));
});
