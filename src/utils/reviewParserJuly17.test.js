import assert from "node:assert/strict";
import test from "node:test";
import { parseReviewMarkdown } from "./reviewParser.js";

const july17Markdown = `# 【日期】7月17日
---
## 📚 学习
### 📐 数学
- 总时长：
- **分项时长：**
    - 高等数学：
    - 线性代数：3h32min
- **今日推进：**
    - 高等数学：
    - 线性代数：做了很久的题。

### 💰 专业课
- 总时长：
- **分项时长：**
    - 公司金融：43min
    - 投资学：
- **今日推进：**
    - 公司金融：学了一下回收期和净现值法。
    - 投资学：

### 📕 英语
- 总时长：
- **分项时长：**
    - 单词：12min
    - 雅思写作：1h47min
    - 雅思阅读：
    - 雅思听力：
    - 雅思口语：
- **今日推进：**
    - 单词：15新词45复习
    - 雅思写作：使用写作练习本进行写作。
    - 雅思阅读：
    - 雅思听力：
    - 雅思口语：

### 🌸 日语
- 总时长：12min
- **今日推进：**
-

### 📚 阅读
- 总时长：
- **今日推进：**
    - 书籍：
    - 阅读内容：
---
## 🚀 项目
### 🐾 个人管理系统
- 总时长：4h13min
- **今日推进：**
    - 开发了个人管理系统。
### 📝 【项目名称】
- 总时长：
- **今日推进：**
-
---
## 💼 工作
### 红会
- 总时长：
- **今日推进：**
-
### 党团
- 总时长：
- **今日推进：**
-
---
## 💪 运动
### 今日运动
- 总时长：
- 运动项目：
---
## 🏠 家庭
### 联系与活动
- 总时长：
- **分项时长：**
    - 和外婆联系：
    - 和奶奶或爸爸联系：
    - 家庭出游：
---
## 📌 杂项
### 今日杂项
- 总时长：
- **分项时长：**
    - 收拾：
    - 临时事项：
    - 复盘：
    - 其他：
    - 做饭：23min
---
## 🎮 娱乐
### 今日娱乐
- 总时长：
- **分项时长：**
    - 文游：2h
    - 小说：
    - 游戏：
    - 视频：20min
    - 短视频：
    - 其他：
---
## 😴 睡眠
### 昨日睡眠
- 入睡时间：3:23
- 起床时间：8:00
- 睡眠时长：4h37min
---
## 🌳 个护
### 今日个护
- 基础护肤：是
- 面膜：否
- 喝水量：800
---
## 🌙 状态
### 今日状态
- 精力：7/10
---
## ⭐ 评分与总结
- 学习质量：7/10
---`;

test("parses the complete July 17 review without double-counting IELTS or blank entries", () => {
  const parsed = parseReviewMarkdown(july17Markdown, {
    miscTags: [{ id: "cooking", name: "做饭", keywords: "做饭" }],
  });

  assert.equal(parsed.studyMinutes, 386);
  assert.equal(parsed.subjects.math.minutes, 212);
  assert.equal(parsed.subjects.economy.minutes, 43);
  assert.equal(parsed.subjects.english.minutes, 119);
  assert.equal(parsed.subjects.japanese.minutes, 12);
  assert.equal(parsed.totalEntertainmentMinutes, 140);
  assert.equal(parsed.subjects.misc.tagBreakdown.cooking.minutes, 23);
  assert.equal(parsed.sleepDuration, "4h37min");
  assert.equal(parsed.reviewData.sleep.minutes, 277);
  assert.equal(parsed.projects.length, 1);
});
