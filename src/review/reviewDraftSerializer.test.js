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
