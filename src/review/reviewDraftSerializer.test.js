import test from "node:test";
import assert from "node:assert/strict";
import { createReviewDraft, migrateFeatureDraft } from "./dailyReviewSchema.js";
import { buildLegacyReviewValues, buildReviewMarkdown, buildStructuredReview } from "./reviewDraftSerializer.js";
import { parseReviewMarkdown } from "../utils/reviewParser.js";

test("Phase 1 structured draft preserves field state and generates compatibility values", () => {
  const draft = createReviewDraft("2026-07-23");
  draft.fields["study.math.totalMinutes"].value = 120;
  draft.fields["study.english.totalMinutes"].value = 60;
  draft.fields["work.redCross.totalMinutes"].value = 50;
  draft.fields["entertainment.today.totalMinutes"].value = 30;
  draft.fields["sleep.yesterday.bedtime"].value = "23:00";
  draft.fields["diary.content"].value = "今天完成了复盘。";
  const legacy = buildLegacyReviewValues(draft);
  assert.equal(legacy.studyMinutes, 180);
  assert.equal(legacy.workMinutes, 50);
  assert.equal(legacy.totalEntertainmentMinutes, 30);
  assert.match(buildReviewMarkdown(draft), /今天完成了复盘/);
  assert.deepEqual(buildStructuredReview(draft).manualOverridePaths, []);
});

test("Markdown export prefers the new moodTag/bodyCondition tags over the old 0-10 scores, but falls back to the score for older drafts", () => {
  const withTags = createReviewDraft("2026-07-23");
  withTags.fields["state.today.moodTag"].value = "开心";
  withTags.fields["state.today.bodyCondition"].value = "正常";
  withTags.fields["state.today.mood"].value = 8;
  withTags.fields["state.today.body"].value = 6;
  const markdownWithTags = buildReviewMarkdown(withTags);
  assert.match(markdownWithTags, /情绪：开心/);
  assert.match(markdownWithTags, /身体状态：正常/);

  const legacyOnly = createReviewDraft("2026-07-23");
  legacyOnly.fields["state.today.mood"].value = 8;
  legacyOnly.fields["state.today.body"].value = 6;
  const markdownLegacyOnly = buildReviewMarkdown(legacyOnly);
  assert.match(markdownLegacyOnly, /情绪：8/);
  assert.match(markdownLegacyOnly, /身体状态：6/);
});

test("opens a saved v2 draft with stable fields and preserves edited values", () => {
  const original = createReviewDraft("2026-07-22");
  original.fields["study.math.totalMinutes"] = { ...original.fields["study.math.totalMinutes"], value: 212, manuallyEdited: true, source: "manual" };
  const restored = migrateFeatureDraft(original);
  assert.equal(restored.fields["study.math.totalMinutes"].value, 212);
  assert.equal(restored.fields["study.math.totalMinutes"].manuallyEdited, true);
  assert.equal(restored.date, "2026-07-22");
});

test("structured review markdown round-trips English progress, sleep adjustment and dynamic projects", () => {
  const draft = createReviewDraft("2026-07-23", { reviewProjects: [{ id: "thesis", name: "论文" }] });
  draft.fields["study.english.totalMinutes"].value = 120;
  draft.fields["study.english.ieltsWriting.duration"].value = 60;
  draft.fields["study.english.ieltsWriting.progress"].value = "完成一篇大作文";
  draft.fields["sleep.yesterday.adjustment"].value = "今晚提前半小时";
  draft.fields["entertainment.today.wenyou.duration"].value = 20;
  draft.fields["entertainment.today.shortVideo.duration"].value = 10;
  draft.temporaryProjects = [{ id: "temp-presentation", temporaryId: "presentation", name: "临时汇报" }];
  draft.fields["project.dynamic.thesis.totalMinutes"] = { value: 40 };
  draft.fields["project.dynamic.thesis.progress"] = { value: "整理大纲" };
  draft.fields["project.dynamic.thesis.adjustment"] = { value: "明天继续" };
  draft.fields["project.dynamic.temp-presentation.totalMinutes"] = { value: 30 };
  draft.fields["project.dynamic.temp-presentation.progress"] = { value: "完成演示稿" };
  draft.fields["project.dynamic.temp-presentation.adjustment"] = { value: "" };
  const markdown = buildReviewMarkdown(draft, { reviewProjects: [{ id: "thesis", name: "论文" }] });
  const parsed = parseReviewMarkdown(markdown);
  assert.match(markdown, /雅思写作：完成一篇大作文/);
  assert.match(markdown, /睡眠.*[\s\S]*调整：今晚提前半小时/);
  assert.match(markdown, /### 论文/);
  assert.match(markdown, /### 临时汇报/);
  assert.equal(parsed.subjects.english.minutes, 120);
  assert.ok(parsed.projects.some((project) => project.name === "论文" && project.minutes === 40));
  assert.ok(parsed.projects.some((project) => project.name === "临时汇报" && project.minutes === 30));
});

test("Markdown export includes the leaf-level study adjustment fields added alongside the group-level ones", () => {
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.calculus.adjustment"].value = "明天多做两道题";
  draft.fields["study.math.linearAlgebra.adjustment"].value = "复习特征值";
  draft.fields["study.english.ieltsSpeaking.adjustment"].value = "口语再练一遍";
  const markdown = buildReviewMarkdown(draft);
  assert.match(markdown, /高等数学：明天多做两道题/);
  assert.match(markdown, /线性代数：复习特征值/);
  assert.match(markdown, /雅思口语：口语再练一遍/);
});

test("Markdown export includes the period-cycle fields (day/flow/pain)", () => {
  const draft = createReviewDraft("2026-07-24");
  draft.fields["selfcare.today.periodDay"].value = 2;
  draft.fields["selfcare.today.periodFlow"].value = "中等";
  draft.fields["selfcare.today.periodPain"].value = "轻微";
  const markdown = buildReviewMarkdown(draft);
  assert.match(markdown, /经期第几天：2/);
  assert.match(markdown, /血量：中等/);
  assert.match(markdown, /疼痛程度：轻微/);
});

test("buildStructuredReview carries every field (including the new leaf-adjustment and period fields) through unfiltered", () => {
  const draft = createReviewDraft("2026-07-24");
  draft.fields["study.math.calculus.adjustment"].value = "复习巩固";
  draft.fields["selfcare.today.periodFlow"].value = "少量";
  const structured = buildStructuredReview(draft);
  assert.equal(structured.fields["study.math.calculus.adjustment"].value, "复习巩固");
  assert.equal(structured.fields["selfcare.today.periodFlow"].value, "少量");
});

test("draft.ui.studyLeafVisibility round-trips through migrateFeatureDraft (autosave/restore path)", () => {
  const original = createReviewDraft("2026-07-24");
  original.ui = { studyLeafVisibility: { added: ["math.linearAlgebra"], hidden: ["english.vocabulary"] } };
  const restored = migrateFeatureDraft(original);
  assert.deepEqual(restored.ui.studyLeafVisibility.added, ["math.linearAlgebra"]);
  assert.deepEqual(restored.ui.studyLeafVisibility.hidden, ["english.vocabulary"]);
});

test("a saved draft missing draft.ui entirely (pre-existing drafts) still restores with the safe default shape", () => {
  const legacySaved = createReviewDraft("2026-07-24");
  delete legacySaved.ui;
  const restored = migrateFeatureDraft(legacySaved);
  assert.deepEqual(restored.ui, { studyLeafVisibility: { added: [], hidden: [] }, categoryVisibility: { added: [], hidden: [] } });
});

test("createReviewDraft seeds categoryReviewEntries as an empty object, and draft.ui.categoryVisibility alongside studyLeafVisibility", () => {
  const draft = createReviewDraft("2026-07-24");
  assert.deepEqual(draft.categoryReviewEntries, {});
  assert.deepEqual(draft.ui.categoryVisibility, { added: [], hidden: [] });
});

test("draft.categoryReviewEntries round-trips through migrateFeatureDraft (autosave/restore path), independent of draft.fields", () => {
  const original = createReviewDraft("2026-07-24");
  original.categoryReviewEntries = { "misc.plantCare": { duration: { value: 15, autoValue: 15, source: "manual", manuallyEdited: true } } };
  const restored = migrateFeatureDraft(original);
  assert.equal(restored.categoryReviewEntries["misc.plantCare"].duration.value, 15);
});

test("a saved draft missing categoryReviewEntries entirely (pre-existing drafts) still restores with a safe empty-object default", () => {
  const legacySaved = createReviewDraft("2026-07-24");
  delete legacySaved.categoryReviewEntries;
  const restored = migrateFeatureDraft(legacySaved);
  assert.deepEqual(restored.categoryReviewEntries, {});
});

test("draft.ui is independent per date: adding a leaf for 07-24 does not appear on a freshly created 07-25 draft", () => {
  const day1 = createReviewDraft("2026-07-24");
  day1.ui.studyLeafVisibility.added.push("math.linearAlgebra");
  const day2 = createReviewDraft("2026-07-25");
  assert.deepEqual(day2.ui.studyLeafVisibility.added, []);
  assert.notStrictEqual(day1.ui, day2.ui);
});

test("buildStructuredReview includes categoryReviewEntries and a taxonomySnapshot of only the day's actually-used dynamic nodes", () => {
  const draft = createReviewDraft("2026-07-24");
  draft.categoryReviewEntries = { "misc.plantCare": { duration: { value: 20, autoValue: 20, source: "manual", manuallyEdited: true } } };
  const taxonomy = [{ id: "misc", name: "杂项", children: [{ id: "misc.plantCare", name: "浇花", color: "#94A3B8", children: [] }] }];
  const structured = buildStructuredReview(draft, { taxonomy });
  assert.equal(structured.categoryReviewEntries["misc.plantCare"].duration.value, 20);
  assert.deepEqual(structured.taxonomySnapshot, [{ categoryId: "misc.plantCare", name: "浇花", parentId: "misc", color: "#94A3B8", archived: false }]);
});

test("Markdown export includes a dynamic-category leaf added purely through taxonomy, with no dailyReviewSchema.js change", () => {
  const draft = createReviewDraft("2026-07-24");
  draft.categoryReviewEntries = {
    "misc.plantCare": {
      duration: { value: 20, autoValue: 20, source: "manual", manuallyEdited: true },
      progress: { value: "浇了三盆花", autoValue: "", source: "manual", manuallyEdited: true },
    },
  };
  const taxonomy = [{ id: "misc", name: "杂项", children: [{ id: "misc.plantCare", name: "浇花", children: [] }] }];
  const markdown = buildReviewMarkdown(draft, {}, { taxonomy });
  assert.match(markdown, /## 🧩 动态分类/);
  assert.match(markdown, /### 浇花/);
  assert.match(markdown, /总时长：20min/);
  assert.match(markdown, /今日推进：浇了三盆花/);
});

test("Markdown export resolves a dynamic category's name from taxonomySnapshot (historical), not the live taxonomy, when both are given", () => {
  const draft = createReviewDraft("2026-07-24");
  draft.categoryReviewEntries = { "misc.plantCare": { duration: { value: 10, autoValue: 10, source: "manual", manuallyEdited: true } } };
  const renamedLiveTaxonomy = [{ id: "misc", name: "杂项", children: [{ id: "misc.plantCare", name: "改名后的分类", children: [] }] }];
  const historicalSnapshot = [{ categoryId: "misc.plantCare", name: "浇花（当天的名字）", parentId: "misc", color: "", archived: false }];
  const markdown = buildReviewMarkdown(draft, {}, { taxonomy: renamedLiveTaxonomy, taxonomySnapshot: historicalSnapshot });
  assert.match(markdown, /### 浇花（当天的名字）/);
  assert.doesNotMatch(markdown, /### 改名后的分类/);
});

test("Markdown export skips fully-empty dynamic category entries (an empty categoryReviewEntries record for a leaf that was added then never filled)", () => {
  const draft = createReviewDraft("2026-07-24");
  draft.categoryReviewEntries = { "misc.plantCare": {} };
  const markdown = buildReviewMarkdown(draft, {}, { taxonomy: [] });
  assert.doesNotMatch(markdown, /动态分类/);
});
