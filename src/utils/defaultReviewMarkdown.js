// The exported text is intentionally the user-approved review master. Nested
// list items use four spaces so copy/paste and import have one stable shape.
export const DEFAULT_REVIEW_MARKDOWN = `# 【日期】

---

## 📚 学习

### 📐 数学
- 总时长：
- **分项时长：**
    - 高等数学：
    - 线性代数：
- **今日推进：**
    - 高等数学：
    - 线性代数：
- 调整：

### 💰 专业课
- 总时长：
- **分项时长：**
    - 公司金融：
    - 投资学：
- **今日推进：**
    - 公司金融：
    - 投资学：
- 调整：

### 📕 英语
- 总时长：
- **分项时长：**
    - 单词：
    - 雅思写作：
    - 雅思阅读：
    - 雅思听力：
    - 雅思口语：
- **今日推进：**
    - 单词：
    - 雅思写作：
    - 雅思阅读：
    - 雅思听力：
    - 雅思口语：
- 调整：

### 🌸 日语
- 总时长：
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
- 总时长：
- **今日推进：**
    -
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
    - 和外婆联系：
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
    - 视频：
    - 短视频：
    - 其他：
- 娱乐感受：放松 / 一般 / 有些失控 / 明显失控
- 调整：

---

## 😴 睡眠

### 昨日睡眠
- 入睡时间：
- 起床时间：
- 睡眠时长：
- 晚睡原因：
- 睡眠感受：
- 调整：

---

## 🌳 个护

### 今日个护
- 基础护肤：是 / 否 / 未记录
- 面膜：是 / 否 / 未记录
- 喝水量：
- 经期：是 / 否 / 未记录
- 其他：

---

## 🌙 状态

### 今日状态
- 精力： /10
- 情绪： /10
- 身体状态： /10
- 睡眠影响：大 / 中 / 小 / 无
- 手机干扰：大 / 中 / 小 / 无

---

## ⭐ 评分与总结
- 学习质量： /10
- 执行稳定度： /10
- 今日满意度： /10
- 今日一句话总结：
- 今日特殊情况：

---

## 🧩 日记
- 标题：
- 正文：
- 标签：
`;

export function buildDefaultReviewMarkdown(projects = []) {
  const dynamic = (Array.isArray(projects) ? projects : []).filter((project) => project && project.archived !== true && project.paused !== true && String(project.name || "").trim());
  if (!dynamic.length) return DEFAULT_REVIEW_MARKDOWN;
  const marker = "### 📝 【项目名称】\n- 总时长：\n- **今日推进：**\n    -\n- 调整：";
  const blocks = dynamic.map((project) => `### 📝 ${String(project.name).trim()}\n- 总时长：\n- **今日推进：**\n    -\n- 调整：`).join("\n\n");
  return DEFAULT_REVIEW_MARKDOWN.replace(marker, blocks);
}
