import { reviewSchemaDynamicProject } from "../utils/reviewSchema.js";

export const REVIEW_SCHEMA_VERSION = 2;
const duration = (id, label, options = {}) => ({ id, label, kind: "duration", ...options });
const text = (id, label) => ({ id, label, kind: "text" });
const select = (id, label, options) => ({ id, label, kind: "select", options });
const score = (id, label) => ({ id, label, kind: "score" });
const time = (id, label) => ({ id, label, kind: "time" });

export const reviewSections = [
  { title: "学习", groups: [
    { title: "数学", fields: [duration("study.math.totalMinutes", "总时长", { parts: ["study.math.calculus.duration", "study.math.linearAlgebra.duration"] }), duration("study.math.calculus.duration", "高等数学"), duration("study.math.linearAlgebra.duration", "线性代数"), text("study.math.calculus.progress", "高等数学推进"), text("study.math.linearAlgebra.progress", "线性代数推进"), text("study.math.adjustment", "调整")] },
    { title: "专业课", fields: [duration("study.professional.totalMinutes", "总时长", { parts: ["study.professional.corporateFinance.duration", "study.professional.investments.duration"] }), duration("study.professional.corporateFinance.duration", "公司金融"), duration("study.professional.investments.duration", "投资学"), text("study.professional.corporateFinance.progress", "公司金融推进"), text("study.professional.investments.progress", "投资学推进"), text("study.professional.adjustment", "调整")] },
    { title: "英语", fields: [duration("study.english.totalMinutes", "总时长", { parts: ["study.english.vocabulary.duration", "study.english.ieltsWriting.duration", "study.english.ieltsReading.duration", "study.english.ieltsListening.duration", "study.english.ieltsSpeaking.duration"] }), duration("study.english.vocabulary.duration", "单词"), duration("study.english.ieltsWriting.duration", "雅思写作"), duration("study.english.ieltsReading.duration", "雅思阅读"), duration("study.english.ieltsListening.duration", "雅思听力"), duration("study.english.ieltsSpeaking.duration", "雅思口语"), text("study.english.vocabulary.progress", "单词推进"), text("study.english.ieltsWriting.progress", "雅思写作推进"), text("study.english.ieltsReading.progress", "雅思阅读推进"), text("study.english.ieltsListening.progress", "雅思听力推进"), text("study.english.ieltsSpeaking.progress", "雅思口语推进"), text("study.english.adjustment", "调整")] },
    { title: "日语", fields: [duration("study.japanese.totalMinutes", "总时长"), text("study.japanese.progress", "今日推进"), text("study.japanese.adjustment", "调整")] },
    { title: "阅读", fields: [duration("study.reading.totalMinutes", "总时长"), text("study.reading.bookTitle", "书籍"), text("study.reading.content", "阅读内容"), text("study.reading.feeling", "感受"), text("study.reading.adjustment", "调整")] },
  ] },
  { title: "项目", groups: [{ title: "个人管理系统 / DustSnow", fields: [duration("project.personalManagement.totalMinutes", "总时长"), text("project.personalManagement.progress", "今日推进"), text("project.personalManagement.adjustment", "调整")] }] },
  { title: "工作", groups: [{ title: "红会", fields: [duration("work.redCross.totalMinutes", "总时长"), text("work.redCross.progress", "今日推进"), text("work.redCross.adjustment", "调整")] }, { title: "党团", fields: [duration("work.partyYouth.totalMinutes", "总时长"), text("work.partyYouth.progress", "今日推进"), text("work.partyYouth.adjustment", "调整")] }] },
  { title: "家庭", groups: [{ title: "联系与活动", fields: [duration("family.contact.totalMinutes", "总时长", { parts: ["family.contact.grandmother.duration", "family.contact.parent.duration", "family.contact.trip.duration"] }), duration("family.contact.grandmother.duration", "和外婆联系"), duration("family.contact.parent.duration", "和奶奶或爸爸联系"), duration("family.contact.trip.duration", "家庭出游"), text("family.contact.other", "其他"), text("family.contact.feeling", "今日感受")] }] },
  { title: "杂项", groups: [{ title: "今日杂项", fields: [duration("misc.today.totalMinutes", "总时长", { parts: ["misc.today.tidying.duration", "misc.today.temporary.duration", "misc.today.review.duration", "misc.today.diary.duration", "misc.today.other.duration"] }), duration("misc.today.tidying.duration", "收拾"), duration("misc.today.temporary.duration", "临时事项"), duration("misc.today.review.duration", "复盘"), duration("misc.today.diary.duration", "写日记"), duration("misc.today.other.duration", "其他"), text("misc.today.adjustment", "调整")] }] },
  { title: "娱乐", groups: [{ title: "今日娱乐", fields: [duration("entertainment.today.totalMinutes", "总时长", { parts: ["entertainment.today.wenyou.duration", "entertainment.today.game.duration", "entertainment.today.video.duration", "entertainment.today.shortVideo.duration", "entertainment.today.novel.duration", "entertainment.today.other.duration"] }), duration("entertainment.today.wenyou.duration", "文游"), duration("entertainment.today.game.duration", "游戏"), duration("entertainment.today.video.duration", "视频"), duration("entertainment.today.shortVideo.duration", "短视频"), duration("entertainment.today.novel.duration", "小说"), duration("entertainment.today.other.duration", "其他"), select("entertainment.today.feeling", "娱乐感受", ["放松", "一般", "有些失控", "明显失控"]), text("entertainment.today.adjustment", "调整")] }] },
  { title: "兴趣", groups: [{ title: "今日兴趣", fields: [duration("hobby.totalMinutes", "总时长", { parts: ["hobby.creativeWriting.duration", "hobby.music.singing.duration", "hobby.music.guitar.duration", "hobby.crafts.perlerBeads.duration"] }), duration("hobby.creativeWriting.duration", "小说创作"), text("hobby.creativeWriting.progress", "小说创作推进"), duration("hobby.music.singing.duration", "唱歌"), text("hobby.music.singing.progress", "唱歌推进"), duration("hobby.music.guitar.duration", "吉他"), text("hobby.music.guitar.progress", "吉他推进"), duration("hobby.crafts.perlerBeads.duration", "拼豆"), text("hobby.crafts.perlerBeads.progress", "拼豆推进")] }] },
];
// Snow Dust's note/annotation card. Deliberately a single, lightweight field —
// not part of reviewSections/otherSections, so it never renders inside the
// regular subject cards. Cyberboss does not write to it yet; the UI only needs
// to display it if present and show an empty-state placeholder otherwise.
export const snowDustNoteField = text("snowDust.note", "雪尘批注");

// The sequential, single-column reading/filling order for the workbench (see
// daily-review-workbench UI refresh spec). Section titles must match the
// `title` values used in reviewSections / otherSections above.
export const WORKBENCH_SECTION_ORDER = [
  "学习",
  "项目",
  "工作",
  "运动",
  "个护",
  "家庭",
  "杂项",
  "娱乐",
  "兴趣",
  "状态",
  "睡眠",
  "评分与总结",
  "日记",
];

export const otherSections = [
  { title: "睡眠", fields: [time("sleep.yesterday.bedtime", "入睡时间"), time("sleep.yesterday.wakeTime", "起床时间"), text("sleep.yesterday.durationText", "睡眠时长"), text("sleep.yesterday.lateReason", "晚睡原因"), text("sleep.yesterday.feeling", "睡眠感受"), text("sleep.yesterday.adjustment", "调整")] },
  { title: "运动", fields: [duration("exercise.today.totalMinutes", "总时长"), text("exercise.today.activity", "运动项目"), select("exercise.today.feeling", "强度感受", ["轻松", "适中", "偏累", "太累"]), select("exercise.today.intensity", "系统计分强度", ["无", "低强度", "中高强度"]), text("exercise.today.bodyFeeling", "身体感受"), text("exercise.today.adjustment", "调整")] },
  { title: "个护", fields: [select("selfcare.today.basicSkincare", "基础护肤", ["是", "否"]), select("selfcare.today.mask", "面膜", ["否/未确认", "是"]), duration("selfcare.today.waterMl", "喝水量"), select("selfcare.today.period", "经期", ["否", "是"]), text("selfcare.today.other", "其他")] },
  { title: "状态", fields: [score("state.today.energy", "精力"), score("state.today.mood", "情绪"), score("state.today.body", "身体状态"), select("state.today.sleepImpact", "睡眠影响", ["大", "中", "小", "无"]), select("state.today.phoneInterference", "手机干扰", ["大", "中", "小", "无"]) ] },
  { title: "评分与总结", fields: [score("summary.studyQuality", "学习质量"), score("summary.execution", "执行稳定度"), score("summary.satisfaction", "今日满意度"), text("summary.oneLine", "今日一句话总结"), text("summary.special", "今日特殊情况"), select("summary.isTravelDay", "今天是出游日", ["否", "是"]) ] },
  { title: "日记", fields: [text("diary.title", "标题"), text("diary.content", "正文"), text("diary.tags", "标签")] },
];
export function fieldState(value = "", source = "default") { return { value, autoValue: value, source, sourceRevision: "", manuallyEdited: false, editedAt: "", updatedAt: new Date().toISOString() }; }
export function allGroups(profile = {}, temporaryProjects = []) { const dynamic = [...(profile.reviewProjects || []), ...temporaryProjects].map((project) => typeof project === "string" ? { name: project, id: project } : project).filter((project) => project?.name); const groups = dynamic.map((project) => { const schema = reviewSchemaDynamicProject(project); const prefix = schema.id.replace(/\.totalMinutes$/, ""); return { title: project.name, temporaryId: project.temporaryId || "", fields: [duration(schema.id, "总时长"), text(`${prefix}.progress`, "今日推进"), text(`${prefix}.adjustment`, "调整")] }; }); return reviewSections.map((section) => section.title === "项目" ? { ...section, groups: [...section.groups, ...groups] } : section); }
export function createReviewDraft(date, profile = {}) { const fields = { "selfcare.today.basicSkincare": fieldState("是"), "selfcare.today.mask": fieldState("否/未确认"), "snowDust.note": fieldState("") }; [...allGroups(profile).flatMap((section) => section.groups), ...otherSections].forEach((group) => group.fields.forEach((field) => { if (!fields[field.id]) fields[field.id] = fieldState(""); })); return { schemaVersion: REVIEW_SCHEMA_VERSION, date, timezone: "Asia/Shanghai", status: "not_generated", fields, temporaryProjects: [], generatedAt: "", updatedAt: new Date().toISOString(), submittedAt: "", linkedSettlementId: "", revisionLog: [] }; }
export function migrateFeatureDraft(draft, profile = {}) { const base = createReviewDraft(draft?.date || new Date().toISOString().slice(0, 10), profile); if (!draft?.fields) return base; const legacy = { "study.math.总时长": "study.math.totalMinutes", "study.economy.总时长": "study.professional.totalMinutes", "study.english.总时长": "study.english.totalMinutes", "study.japanese.总时长": "study.japanese.totalMinutes", "study.reading.总时长": "study.reading.totalMinutes", "work.redcross.总时长": "work.redCross.totalMinutes", "work.party.总时长": "work.partyYouth.totalMinutes", "exercise.总时长": "exercise.today.totalMinutes", "exercise.系统计分强度": "exercise.today.intensity", "entertainment.总时长": "entertainment.today.totalMinutes", "entertainment.游戏": "entertainment.today.game.duration", "sleep.入睡时间": "sleep.yesterday.bedtime", "sleep.睡眠时长": "sleep.yesterday.durationText", "study.reading.书籍": "study.reading.bookTitle", "study.reading.感受": "study.reading.feeling", "health.基础护肤": "selfcare.today.basicSkincare", "health.面膜": "selfcare.today.mask", "health.喝水量": "selfcare.today.waterMl", "health.经期": "selfcare.today.period", "state.精力": "state.today.energy", "state.情绪": "state.today.mood", "state.身体状态": "state.today.body", "state.睡眠影响": "state.today.sleepImpact", "state.手机干扰": "state.today.phoneInterference", "diary.标题": "diary.title", "diary.正文": "diary.content", "diary.标签": "diary.tags" }; const fields = { ...base.fields }; Object.entries(draft.fields).forEach(([id, item]) => { const target = legacy[id] || id; if (fields[target]) fields[target] = item; }); return { ...base, ...draft, fields }; }
