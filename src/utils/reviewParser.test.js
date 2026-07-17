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

const nestedRegressionFixture = `# 【日期】
---
## 📚 学习
### 📐 数学
- 总时长：
- **分项时长：**
    - 高等数学：
    - 线性代数：41min
- **今日推进：**
    - 高等数学：
    - 线性代数：做了点习题
- 调整：

### 💰 专业课
- 总时长：
- **分项时长：**
    - 公司金融：1h58min
    - 投资学：
- **今日推进：**
    - 公司金融：
    - 投资学：
- 调整：

### 📕 英语
- 总时长：
- **分项时长：**
    - 单词：12min
    - 雅思写作：2h3min
    - 雅思阅读：
    - 雅思听力：
    - 雅思口语：
- **今日推进：**
    - 单词：
    - 雅思写作：在ai帮助下做了一个写作练习本
    - 雅思阅读：
    - 雅思听力：
    - 雅思口语：
- 调整：

### 🌸 日语
- 总时长：8min
- **今日推进：**
-
- 调整：

### 📚 阅读
- 总时长：
- **今日推进：**
    - 书籍：
    - 阅读内容：
- 感受：
- 调整：
---
## 🚀 项目
### 🐾 个人管理系统
- 总时长：2h36min
- **今日推进：**
    - 开了很多新功能，比如说给纪雪尘设置了一个他自己的状态。然后呢，开启了早上问好，然后复盘也在慢慢接进去。
- 调整：
### 📝 【项目名称】
- 总时长：
- **今日推进：**
-
- 调整：
---
## 💼 工作
### 红会
- 总时长：
- **今日推进：**
-
- 调整：
### 党团
- 总时长：
- **今日推进：**
-
- 调整：
---
## 💪 运动
### 今日运动
- 总时长：
- 运动项目：
- 强度感受：轻松 / 适中 / 偏累 / 太累
- 身体感受：
- 调整：
---
## 🏠 家庭

### 联系与活动
- 总时长：
- **分项时长：**
    - 和外婆联系：40min
    - 和奶奶或爸爸联系：
    - 家庭出游：
- 其他：
- 今日感受：

---
## 📌 杂项
### 今日杂项
- 总时长：
- **分项时长：**
    - 收拾：
    - 临时事项：
    - 复盘：
    - 其他：
- 调整：
---
## 🎮 娱乐
### 今日娱乐
- 总时长：
- **分项时长：**
    - 文游：
    - 小说：
    - 游戏：
    - 视频：1h
    - 短视频：
    - 其他：
- 娱乐感受：放松 / 一般 / 有些失控 / 明显失控
- 调整：
---
## 😴 睡眠
### 昨日睡眠
- 入睡时间：3:32
- 起床时间：9:18
- 睡眠时长：5h46min
- 晚睡原因：熬夜改代码，然后放松看小视频
- 睡眠感受：醒来不舒服
- 调整：
---
## 🌳 个护
### 今日个护
- 基础护肤：是
- 面膜：否
- 喝水量：500
- 经期：否
- 其他：
---
## 🌙 状态
### 今日状态
- 精力：6 /10
- 情绪： 7 /10
- 身体状态：6 /10
- 睡眠影响：中
- 手机干扰：中
---
## ⭐ 评分与总结
- 学习质量： 6/10
- 执行稳定度： 6/10
- 今日满意度： 5/10
- 今日一句话总结：又是沉迷代码的一天
- 今日特殊情况：
---
## 🧩 日记
- 标题：
- 正文：
- 标签：`;

test("parses nested bold review labels and effective totals from the final Chinese template", () => {
  const parsed = parseReviewMarkdown(nestedRegressionFixture);
  assert.equal(parsed.subjects.math.minutes, 41);
  assert.equal(parsed.subjects.economy.minutes, 118);
  assert.equal(parsed.subjects.english.minutes, 135);
  assert.equal(parsed.subjects.japanese.minutes, 8);
  assert.equal(parsed.subjects.reading.minutes, 0);
  assert.equal(parsed.studyMinutes, 302);
  assert.equal(parsed.reviewData.study.math.totalMinutes, 41);
  assert.equal(parsed.reviewData.study.professional.totalMinutes, 118);
  assert.equal(parsed.reviewData.study.english.totalMinutes, 135);
  assert.equal(parsed.projects[0].name, "个人管理系统");
  assert.equal(parsed.projects[0].minutes, 156);
  assert.equal(parsed.projects.some((project) => /项目名称/.test(project.name)), false);
  assert.equal(parsed.subjects.work.minutes, 0);
  assert.equal(parsed.subjects.work.progress.join("；").includes("**"), false);
  assert.equal(parsed.subjects.work.progress.join("；").includes("今日推进：**"), false);
  assert.equal(parsed.subjects.family.minutes, 40);
  assert.equal(parsed.totalEntertainmentMinutes, 60);
  assert.equal(parsed.reviewData.entertainment.totalMinutes, 60);
  assert.equal(parsed.reviewData.sleep.minutes, 346);
  assert.equal(parsed.exerciseMinutes, 0);
  assert.equal(parsed.state.energy, 6);
  assert.equal(parsed.state.mood, 7);
  assert.equal(parsed.state.bodyStatus, 6);
  assert.equal(parsed.state.studyQuality, 6);
  assert.equal(parsed.state.executionStability, 6);
  assert.equal(parsed.state.todaySatisfaction, 5);
  assert.equal(parsed.health.mask, false);
  assert.equal(parsed.health.basicSkincare, true);
  assert.equal(parsed.health.waterAmount, 500);
});
