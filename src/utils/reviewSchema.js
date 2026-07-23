// 唯一的复盘字段目录：Markdown、解析、追踪器和周统计都应从这里取得稳定路径。
// values are stored in minutes for duration fields; labels are presentation only.
let REVIEW_SCHEMA_ORDER = 1;

export const REVIEW_SCHEMA = [
  field("study.math.totalMinutes", "数学总时长", "duration", ["study", "study.math"], { aggregate: true }),
  field("study.math.calculus.duration", "高等数学", "duration", ["study", "study.math", "study.math.calculus"]),
  field("study.math.linearAlgebra.duration", "线性代数", "duration", ["study", "study.math", "study.math.linearAlgebra"]),
  field("study.math.calculus.progress", "高等数学推进", "longText", ["study", "study.math", "study.math.calculus"], { duration: false, weekly: false }),
  field("study.math.linearAlgebra.progress", "线性代数推进", "longText", ["study", "study.math", "study.math.linearAlgebra"], { duration: false, weekly: false }),
  field("study.professional.totalMinutes", "专业课总时长", "duration", ["study", "study.professional"], { aggregate: true }),
  field("study.professional.corporateFinance.duration", "公司金融", "duration", ["study", "study.professional", "study.professional.corporateFinance"]),
  field("study.professional.investments.duration", "投资学", "duration", ["study", "study.professional", "study.professional.investments"]),
  field("study.english.totalMinutes", "英语总时长", "duration", ["study", "study.english"], { aggregate: true }),
  ...["vocabulary", "ieltsWriting", "ieltsReading", "ieltsListening", "ieltsSpeaking"].map((id, index) => field(`study.english.${id}.duration`, ["单词", "雅思写作", "雅思阅读", "雅思听力", "雅思口语"][index], "duration", ["study", "study.english", `study.english.${id}`])),
  field("study.japanese.totalMinutes", "日语总时长", "duration", ["study", "study.japanese"], { aggregate: true }),
  field("study.reading.totalMinutes", "阅读总时长", "duration", ["study", "study.reading"], { aggregate: true }),
  field("project.personalManagement.totalMinutes", "个人管理系统总时长", "duration", ["project", "project.personalManagement"], { aggregate: true }),
  field("work.redCross.totalMinutes", "红会总时长", "duration", ["work", "work.redCross"], { aggregate: true }),
  field("work.partyYouth.totalMinutes", "党团总时长", "duration", ["work", "work.partyYouth"], { aggregate: true }),
  field("exercise.today.totalMinutes", "运动总时长", "duration", ["exercise", "exercise.today"], { aggregate: true }),
  field("family.contact.grandmother.duration", "和外婆联系", "duration", ["family", "family.contact", "family.contact.grandmother"]),
  field("family.contact.parent.duration", "和奶奶或爸爸联系", "duration", ["family", "family.contact", "family.contact.parent"]),
  field("family.contact.trip.duration", "家庭出游", "duration", ["family", "family.contact", "family.contact.trip"]),
  field("misc.today.totalMinutes", "杂项总时长", "duration", ["misc", "misc.today"], { aggregate: true }),
  field("misc.today.diary.duration", "写日记", "duration", ["misc", "misc.today", "misc.today.diary"]),
  field("entertainment.today.totalMinutes", "娱乐总时长", "duration", ["entertainment", "entertainment.today"], { aggregate: true }),
  field("hobby.totalMinutes", "兴趣总时长", "duration", ["hobby"], { aggregate: true }),
  field("hobby.creativeWriting.duration", "小说创作", "duration", ["hobby", "hobby.creativeWriting"]),
  field("hobby.creativeWriting.progress", "小说创作推进", "longText", ["hobby", "hobby.creativeWriting"], { duration: false, weekly: false }),
  field("hobby.music.singing.duration", "唱歌", "duration", ["hobby", "hobby.music", "hobby.music.singing"]),
  field("hobby.music.singing.progress", "唱歌推进", "longText", ["hobby", "hobby.music", "hobby.music.singing"], { duration: false, weekly: false }),
  field("hobby.music.guitar.duration", "吉他", "duration", ["hobby", "hobby.music", "hobby.music.guitar"]),
  field("hobby.music.guitar.progress", "吉他推进", "longText", ["hobby", "hobby.music", "hobby.music.guitar"], { duration: false, weekly: false }),
  field("hobby.crafts.perlerBeads.duration", "拼豆", "duration", ["hobby", "hobby.crafts", "hobby.crafts.perlerBeads"]),
  field("hobby.crafts.perlerBeads.progress", "拼豆推进", "longText", ["hobby", "hobby.crafts", "hobby.crafts.perlerBeads"], { duration: false, weekly: false }),
  field("sleep.yesterday.duration", "睡眠时长", "duration", ["sleep", "sleep.yesterday"], { aggregate: true }),
  field("selfcare.today.mask", "面膜", "booleanRecord", ["selfcare", "selfcare.today"]),
  field("selfcare.today.basicSkincare", "基础护肤", "booleanRecord", ["selfcare", "selfcare.today"]),
  field("state.today.energy", "精力", "rating", ["state", "state.today"], { duration: false, weekly: true }),
  field("state.today.mood", "情绪", "rating", ["state", "state.today"], { duration: false, weekly: true }),
];

function field(id, label, type, categoryPathIds, options = {}) {
  return { id, label, type, categoryPathIds, order: REVIEW_SCHEMA_ORDER++, supportsDuration: options.duration !== false && type === "duration", supportsFreeText: ["text", "longText"].includes(type), trackable: options.trackable !== false, weeklyAggregate: options.weekly !== false, aggregate: Boolean(options.aggregate) };
}
export function reviewSchemaFields({ trackableOnly = false } = {}) {
  return REVIEW_SCHEMA.filter((item) => !trackableOnly || item.trackable);
}

export function reviewSchemaFieldOptions() {
  return reviewSchemaFields({ trackableOnly: true }).map((item) => ({ value: item.id, label: [...item.categoryPathIds.slice(0, -1).map(categoryLabel), item.label].join(" → "), field: item }));
}

export function categoryLabel(id) {
  return ({ study: "学习", "study.math": "数学", "study.professional": "专业课", "study.english": "英语", "study.japanese": "日语", "study.reading": "阅读", project: "项目", work: "工作", exercise: "运动", family: "家庭", misc: "杂项", "misc.today.diary": "写日记", entertainment: "娱乐", hobby: "兴趣", "hobby.music": "音乐", "hobby.crafts": "手工", sleep: "睡眠", selfcare: "个护", state: "状态" })[id] || id;
}

export function reviewSchemaDynamicProject(project) {
  const id = String(project?.id || project?.name || "project").replace(/[^a-zA-Z0-9_-]/g, "-");
  return field(`project.dynamic.${id}.totalMinutes`, project?.name || "项目", "duration", ["project", `project.dynamic.${id}`], { aggregate: true });
}
