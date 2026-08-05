// Builds the exact, whitelisted set of daily-review facts sent to Cyberboss
// for 雪尘's real-runtime-generated commentary. Every value is read through
// the SAME effective-value resolver the page/Markdown/settlement already
// share (reviewDraftSerializer.js's value()/numberValue(), and
// categoryEntryValue() for dynamic taxonomy leaves) — never a raw,
// possibly-stale field.value. Deliberately excludes anything from
// `profile` (uid, email, points balance) — this function is only ever
// given `draft`/`taxonomy`/`settlement`, so there is structurally nothing
// here to leak Firebase identity or reward-bank state with.
import { value, numberValue } from "./reviewDraftSerializer.js";
import { buildReviewTaxonomyModel, categoryEntryValue } from "./reviewTaxonomyModel.js";

const TEXT_FIELD_MAX_CHARS = 300;
const PAYLOAD_MAX_BYTES = 12 * 1024;

function text(v) {
  const trimmed = String(v ?? "").trim();
  return trimmed.length > TEXT_FIELD_MAX_CHARS ? `${trimmed.slice(0, TEXT_FIELD_MAX_CHARS)}…` : trimmed;
}

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

// TextEncoder (Web API) works identically in the browser and in Node's test
// runner — Node's `Buffer` global does not exist in the browser bundle this
// module actually ships in, which crashed the SnowDustCard on mount.
function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

const STUDY_LEAVES = [
  ["study.math.calculus", "高等数学"],
  ["study.math.linearAlgebra", "线性代数"],
  ["study.professional.corporateFinance", "公司金融"],
  ["study.professional.investments", "投资学"],
  ["study.english.vocabulary", "单词"],
  ["study.english.ieltsWriting", "雅思写作"],
  ["study.english.ieltsReading", "雅思阅读"],
  ["study.english.ieltsListening", "雅思听力"],
  ["study.english.ieltsSpeaking", "雅思口语"],
  ["study.japanese", "日语"],
  ["study.reading", "阅读"],
];

function staticLeaves(draft, ids) {
  return ids
    .map(([id, label]) => ({ label, minutes: numberValue(draft, `${id}.duration`) || numberValue(draft, `${id}.totalMinutes`), progress: text(value(draft, `${id}.progress`)), adjustment: text(value(draft, `${id}.adjustment`)) }))
    .filter((item) => item.minutes > 0 || item.progress || item.adjustment);
}

function dynamicLeaves(draft, nodes) {
  return (nodes || [])
    .map((node) => ({ label: node.name, minutes: Number(categoryEntryValue(draft, node.id, "duration")) || 0, progress: text(categoryEntryValue(draft, node.id, "progress")) }))
    .filter((item) => item.minutes > 0 || item.progress);
}

// A small, fast, non-cryptographic hash (FNV-1a) — this is a change-
// detection revision marker for the review facts, not a security boundary,
// and must run synchronously in the browser (Node's `crypto` module isn't
// available there; Web Crypto's subtle.digest is async, which would force
// this otherwise-pure builder into an async/useEffect shape for no real
// benefit).
function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildSnowDustCommentaryPayload({ date, draft, taxonomy = [], settlement = {} } = {}) {
  const taxonomyModel = buildReviewTaxonomyModel({ taxonomy, draft, reviewDate: date });

  const study = [...staticLeaves(draft, STUDY_LEAVES), ...dynamicLeaves(draft, taxonomyModel.studyGroups)];

  const groupSection = (key, staticIds = []) => [...staticLeaves(draft, staticIds), ...dynamicLeaves(draft, taxonomyModel.categoryGroups[key])];

  const project = groupSection("project", [["project.personalManagement", "个人管理系统"]]);
  const work = groupSection("work", [["work.redCross", "红会"], ["work.partyYouth", "党团"]]);

  // Explicit, authoritative study-vs-work-vs-Focus split (spec section 17):
  // pureStudyMinutes/workMinutes are summed from the SAME per-leaf entries
  // already recorded in `study`/`work`/`project` above — never re-derived
  // from Focus. This is what lets Snow-dust's commentary tell "学习5h18min"
  // apart from "Focus记录合计7h18min" instead of conflating the two.
  const pureStudyMinutes = study.reduce((sum, item) => sum + (item.minutes || 0), 0);
  const workMinutes = [...project, ...work].reduce((sum, item) => sum + (item.minutes || 0), 0);

  const review = {
    date,
    status: draft?.status || "not_generated",
    focus: {
      totalMinutes: num(draft?.focusSummary?.totalMinutes),
      sessionCount: num(draft?.focusSync?.sessionCount ?? draft?.focusSummary?.sessionCount),
      unmappedSessionCount: num(draft?.focusSync?.unmappedSessionCount),
    },
    actual: {
      pureStudyMinutes,
      workMinutes,
    },
    study,
    project,
    work,
    hobby: groupSection("hobby"),
    life: groupSection("life"),
    family: groupSection("family", [["family.contact", "联系与活动"]]),
    misc: groupSection("misc"),
    sleep: {
      bedtime: text(value(draft, "sleep.yesterday.bedtime")),
      wakeTime: text(value(draft, "sleep.yesterday.wakeTime")),
      durationText: text(value(draft, "sleep.yesterday.durationText")),
      feeling: text(value(draft, "sleep.yesterday.feeling")),
    },
    exercise: {
      totalMinutes: numberValue(draft, "exercise.today.totalMinutes"),
      activity: text(value(draft, "exercise.today.activity")),
      feeling: text(value(draft, "exercise.today.feeling")),
      // sessionCount/calories come from draft.exerciseSync — a small
      // projection metadata block api/exercise-record-sync.js writes
      // alongside the two autoValue fields (mirrors focusSummary/focusSync
      // for Focus). Zero/absent when no Keep sync has ever landed for this
      // date, so old drafts and non-Keep days are unaffected.
      sessionCount: num(draft?.exerciseSync?.sessionCount),
      calories: num(draft?.exerciseSync?.calories),
    },
    entertainment: {
      totalMinutes: num(settlement.totalEntertainmentMinutes) || numberValue(draft, "entertainment.today.totalMinutes"),
      feeling: text(value(draft, "entertainment.today.feeling")),
    },
    state: {
      energy: text(value(draft, "state.today.energy")),
      mood: text(value(draft, "state.today.moodTag") || value(draft, "state.today.mood")),
      body: text(value(draft, "state.today.bodyCondition") || value(draft, "state.today.body")),
    },
    summary: {
      studyQuality: text(value(draft, "summary.studyQuality")),
      execution: text(value(draft, "summary.execution")),
      satisfaction: text(value(draft, "summary.satisfaction")),
      oneLine: text(value(draft, "summary.oneLine")),
      special: text(value(draft, "summary.special")),
    },
    diary: {
      content: text(value(draft, "diary.content")),
      tags: text(value(draft, "diary.tags")),
    },
    isTravelDay: value(draft, "summary.isTravelDay") === "是",
  };

  let json = JSON.stringify(review);
  if (utf8ByteLength(json) > PAYLOAD_MAX_BYTES) {
    // Extremely defensive fallback — should not normally trigger given the
    // per-field TEXT_FIELD_MAX_CHARS cap, but never send an oversized body.
    review.diary.content = review.diary.content.slice(0, 60);
    json = JSON.stringify(review);
  }

  const inputRevision = fnv1aHex(json);
  return { review, inputRevision };
}
