import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_REVIEW_MARKDOWN } from "./defaultReviewMarkdown.js";
import { parseDurationToMinutes, parseReviewMarkdown } from "./reviewParser.js";

function fixture() {
  return DEFAULT_REVIEW_MARKDOWN
    .replace("# 【日期】", "# 2026-07-16")
    .replace("- 总时长：\n  - 网课： /3\n  - 习题： /3", "- 总时长：2h\n  - 网课：2/3\n  - 习题：1/3")
    .replace("  - 高等数学：\n- \n  - 线性代数：\n- ", "  - 高等数学：极限第 2 章\n  - 线性代数：矩阵第 1 节")
    .replace("### 💰 专业课\n- 总时长：\n- 今日推进：\n  - 公司金融：\n- \n  - 投资学：\n- ", "### 专业课\n- 总时长：50min\n- 今日推进：\n  - 公司金融：第 3 章\n  - 城市经济学：导论")
    .replace("### 🌍 雅思专项\n- 总时长：\n  - 写作：\n  - 阅读：\n  - 听力：\n  - 口语：", "### 雅思专项\n- 总时长：90min\n  - 写作：50min，完成一个主体段\n  - 阅读：40min，完成 T4-1")
    .replace("### 🐾 个人管理系统\n- 总时长：", "### 个人管理系统\n- 总时长：1h30min")
    .replace("## 💼 工作\n- 总时长：\n- 事项：\n  - 红会：", "## 工作\n- 总时长：1h32min\n- 事项：\n  - 红会：整理材料")
    .replace("## 📌 杂项\n- 总时长：\n- 内容：\n  - 收拾：", "## 杂项\n- 总时长：5min\n- 内容：\n  - 收拾：桌面")
    .replace("- 娱乐总时长：", "- 娱乐总时长：40min")
    .replace("- 入睡时间：", "- 入睡时间：23:30");
}

test("parses the final heading hierarchy without relying on emoji", () => {
  const parsed = parseReviewMarkdown(fixture());
  assert.equal(parsed.reviewDate, "2026-07-16");
  assert.equal(parsed.subjects.math.minutes, 120);
  assert.deepEqual(parsed.subjects.math.progress, ["高等数学：极限第 2 章", "线性代数：矩阵第 1 节"]);
  assert.equal(parsed.subjects.economy.courseProgress["公司金融"], "第 3 章");
  assert.equal(parsed.subjects.economy.courseProgress["城市经济学"], "导论");
});

test("keeps IELTS skills separate and extracts inline duration plus remaining text", () => {
  const parsed = parseReviewMarkdown(fixture());
  assert.equal(parsed.subjects.ielts.minutes, 90);
  assert.equal(parsed.subjects.ielts.skills["写作"].minutes, 50);
  assert.equal(parsed.subjects.ielts.skills["写作"].text, "完成一个主体段");
  assert.equal(parsed.subjects.ielts.skills["阅读"].minutes, 40);
});

test("keeps projects and work separate and treats personal management as one project", () => {
  const parsed = parseReviewMarkdown(fixture());
  assert.equal(parsed.projects[0].name, "个人管理系统");
  assert.equal(parsed.projects[0].minutes, 90);
  assert.equal(parsed.subjects.work.minutes, 92);
  assert.equal(parsed.subjects.misc.minutes, 5);
});

test("skips empty default fields and never imports health from the Markdown template", () => {
  const parsed = parseReviewMarkdown(DEFAULT_REVIEW_MARKDOWN);
  assert.equal(parsed.subjects.ielts.skills["听力"], undefined);
  assert.deepEqual(parsed.health.maintenanceCompleted, undefined);
  assert.equal(parsed.health.maskStatus, "");
});

test("recognizes common duration formats", () => {
  assert.equal(parseDurationToMinutes("2h43min"), 163);
  assert.equal(parseDurationToMinutes("3h44min"), 224);
  assert.equal(parseDurationToMinutes("1h32min"), 92);
  assert.equal(parseDurationToMinutes("1h"), 60);
  assert.equal(parseDurationToMinutes("50min"), 50);
  assert.equal(parseDurationToMinutes("5min"), 5);
});

test("accepts deeper list indentation without losing nested fields", () => {
  const parsed = parseReviewMarkdown(fixture().replace(/  - 写作/g, "\t- 写作").replace(/  - 阅读/g, "        - 阅读"));
  assert.equal(parsed.subjects.ielts.skills["写作"].minutes, 50);
  assert.equal(parsed.subjects.ielts.skills["阅读"].minutes, 40);
});
