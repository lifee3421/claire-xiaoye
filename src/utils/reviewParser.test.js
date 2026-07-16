import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_REVIEW_MARKDOWN } from "./defaultReviewMarkdown.js";
import { parseDurationToMinutes, parseReviewMarkdown } from "./reviewParser.js";

function fixture() {
  return DEFAULT_REVIEW_MARKDOWN
    .replace("# 【日期】", "# 2026-07-16")
    .replace("### 📐 数学\n- 总时长：", "### 数学\n- 总时长：2h")
    .replace("    - 高等数学：\n    - 线性代数：", "    - 高等数学：70min\n    - 线性代数：50min")
    .replace("### 💰 专业课\n- 总时长：", "### 专业课\n- 总时长：50min")
    .replace("    - 公司金融：\n    - 投资学：", "    - 公司金融：第 3 章\n    - 投资学：导论")
    .replace("### 📕 英语\n- 总时长：", "### 英语\n- 总时长：90min")
    .replace("    - 雅思写作：\n    - 雅思阅读：", "    - 雅思写作：50min，完成一个主体段\n    - 雅思阅读：40min，完成 T4-1")
    .replace("### 🐾 个人管理系统\n- 总时长：", "### 个人管理系统\n- 总时长：1h30min")
    .replace("### 红会\n- 总时长：", "### 红会\n- 总时长：1h32min")
    .replace("- 基础护肤：是 / 否 / 未记录", "- 基础护肤：是")
    .replace("- 面膜：是 / 否 / 未记录", "- 面膜：否");
}

test("parses the approved hierarchy without emoji and preserves durations", () => {
  const parsed = parseReviewMarkdown(fixture());
  assert.equal(parsed.reviewDate, "2026-07-16");
  assert.equal(parsed.subjects.math.minutes, 120);
  assert.equal(parsed.subjects.economy.minutes, 50);
  assert.equal(parsed.subjects.economy.courseProgress["公司金融"], "第 3 章");
});

test("keeps the five English leaves as separate duration data", () => {
  const parsed = parseReviewMarkdown(fixture());
  assert.equal(parsed.subjects.english.minutes, 90);
  assert.equal(parsed.subjects.english.breakdown["雅思写作"].minutes, 50);
  assert.equal(parsed.subjects.english.breakdown["雅思写作"].text, "完成一个主体段");
  assert.equal(parsed.reviewData.study.english.breakdown.ieltsReading, 40);
});

test("keeps dynamic projects separate from work and exposes structured values", () => {
  const parsed = parseReviewMarkdown(fixture());
  assert.equal(parsed.projects[0].name, "个人管理系统");
  assert.equal(parsed.projects[0].minutes, 90);
  assert.equal(parsed.reviewData.projects[0].totalMinutes, 90);
  assert.equal(parsed.health.basicSkincareDone, "是");
});

test("default placeholders are empty rather than completion records", () => {
  const parsed = parseReviewMarkdown(DEFAULT_REVIEW_MARKDOWN);
  assert.equal(parsed.health.maskStatus, "");
  assert.equal(parsed.reviewData.selfcare.mask, "unrecorded");
  assert.equal(parsed.state.energy, "");
});

test("uses four-space child lists and accepts tab or deeper indent", () => {
  assert.match(DEFAULT_REVIEW_MARKDOWN, /\n    - 雅思写作：/);
  const parsed = parseReviewMarkdown(fixture().replace(/    - 雅思写作/g, "\t- 雅思写作").replace(/    - 雅思阅读/g, "        - 雅思阅读"));
  assert.equal(parsed.subjects.english.breakdown["雅思写作"].minutes, 50);
  assert.equal(parsed.subjects.english.breakdown["雅思阅读"].minutes, 40);
});

test("recognizes common duration formats", () => {
  assert.equal(parseDurationToMinutes("2h43min"), 163);
  assert.equal(parseDurationToMinutes("3h44min"), 224);
  assert.equal(parseDurationToMinutes("1h32min"), 92);
  assert.equal(parseDurationToMinutes("1h"), 60);
  assert.equal(parseDurationToMinutes("50min"), 50);
});
