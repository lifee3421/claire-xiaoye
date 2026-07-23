// Unified taxonomy v3 contract — single source of truth for canonical categoryIds,
// legacy alias compatibility, and cross-system metadata (review fields, TickTick catalog).
// Source of truth for this file's content: E:\Cyberboss\docs\unified-taxonomy-v3-proposal.json
// (approved direction 2026-07-23; math/english/reading below are DELIBERATE naming choices
// made in that proposal, not observed facts about existing live/default data — see
// LEGACY_CATEGORY_ALIASES comment below).

export const TAXONOMY_CONTRACT_VERSION = 3;

// ---------------------------------------------------------------------------
// Canonical taxonomy tree (same nested shape App.jsx's classificationTaxonomy uses:
// primary { id, name, color, children: secondary[] }
// secondary { id, name, keywords, color, statGroup, children: tertiary[] }
// tertiary { id, name, keywords, parentId }
// `order`/`enabled`/`archived`/`trackInWeeklyReview` are intentionally omitted here;
// normalizeClassificationTaxonomy() fills sensible defaults for those.
// ---------------------------------------------------------------------------

export const CANONICAL_TAXONOMY_V3 = [
  {
    id: "study", name: "学习", color: "#34D399",
    children: [
      {
        id: "study.math", name: "数学", keywords: "数学,网课,习题,错题", color: "#60A5FA", statGroup: "study",
        children: [
          { id: "study.math.calculus", name: "高等数学", keywords: "高数,高等数学,微积分" },
          { id: "study.math.linearAlgebra", name: "线性代数", keywords: "线代,线性代数,矩阵,向量组" },
        ],
      },
      {
        id: "study.english", name: "英语", keywords: "英语,雅思,单词,写作,口语,听力,阅读", color: "#A78BFA", statGroup: "study",
        children: [
          { id: "study.english.vocabulary", name: "单词", keywords: "单词" },
          { id: "study.english.ieltsWriting", name: "雅思写作", keywords: "雅思写作,作文" },
          { id: "study.english.ieltsReading", name: "雅思阅读", keywords: "雅思阅读" },
          { id: "study.english.ieltsListening", name: "雅思听力", keywords: "雅思听力" },
          { id: "study.english.ieltsSpeaking", name: "雅思口语", keywords: "雅思口语" },
        ],
      },
      {
        id: "study.professional", name: "经济 / 专业课", keywords: "经济,金融,专业课", color: "#34D399", statGroup: "study",
        children: [
          { id: "study.professional.corporateFinance", name: "公司金融", keywords: "公司金融,公司理财,DCF,折现现金流,资本预算" },
          { id: "study.professional.investments", name: "投资学", keywords: "投资学" },
        ],
      },
      { id: "paper", name: "论文", keywords: "论文,文献,写作", color: "#FB923C", statGroup: "study", children: [] },
      { id: "study.reading", name: "阅读", keywords: "阅读,书籍", color: "#34D399", statGroup: "reading", children: [] },
      { id: "study.japanese", name: "日语", keywords: "日语", color: "#60A5FA", statGroup: "study", children: [] },
    ],
  },
  {
    id: "life", name: "生活", color: "#C58A00",
    children: [
      { id: "personal", name: "个人 / 生活", keywords: "通勤,洗漱,吃饭,家务", color: "#C58A00", statGroup: "life", children: [] },
      { id: "exercise", name: "运动", keywords: "运动,跑步,健身,拉伸", color: "#D95050", statGroup: "exercise", children: [] },
    ],
  },
  {
    id: "rest", name: "休息娱乐", color: "#CF5B96",
    children: [
      {
        id: "entertainment", name: "娱乐 / 休息", keywords: "游戏,视频,娱乐,休息", color: "#CF5B96", statGroup: "entertainment",
        children: [
          { id: "entertainment.wenyou", name: "文游", keywords: "文字游戏,文游" },
          { id: "entertainment.game", name: "游戏", keywords: "游戏" },
          { id: "entertainment.video", name: "视频", keywords: "视频,看片" },
          { id: "entertainment.shortVideo", name: "短视频", keywords: "短视频,刷视频,小红书" },
          { id: "entertainment.novel", name: "小说", keywords: "小说,看小说" },
          { id: "entertainment.other", name: "其他", keywords: "其他" },
        ],
      },
    ],
  },
  {
    id: "project", name: "项目", color: "#0EA5E9",
    children: [
      { id: "project.personalManagement", name: "个人管理系统", keywords: "个人管理系统,DustSnow,snow-dust", color: "#0EA5E9", statGroup: "other", children: [] },
    ],
  },
  {
    id: "work", name: "工作", color: "#4C6EF5",
    children: [
      { id: "work.redCross", name: "红会", keywords: "红会", color: "#4C6EF5", statGroup: "work", children: [] },
      { id: "work.partyYouth", name: "党团", keywords: "党团", color: "#4C6EF5", statGroup: "work", children: [] },
    ],
  },
  {
    id: "family", name: "家庭", color: "#FB7185",
    children: [],
  },
  {
    id: "misc", name: "杂项", color: "#94A3B8",
    children: [
      { id: "misc.diary", name: "写日记", keywords: "写日记,日记", color: "#94A3B8", statGroup: "other", children: [] },
    ],
  },
  {
    id: "hobby", name: "兴趣", color: "#F59E0B",
    children: [
      { id: "hobby.creativeWriting", name: "小说创作", keywords: "写小说,小说创作,写作", color: "#F59E0B", statGroup: "other", children: [] },
      {
        id: "hobby.music", name: "音乐", keywords: "音乐", color: "#F59E0B", statGroup: "other",
        children: [
          { id: "hobby.music.singing", name: "唱歌", keywords: "唱歌" },
          { id: "hobby.music.guitar", name: "吉他", keywords: "吉他" },
        ],
      },
      {
        id: "hobby.crafts", name: "手工", keywords: "手工", color: "#F59E0B", statGroup: "other",
        children: [
          { id: "hobby.crafts.perlerBeads", name: "拼豆", keywords: "拼豆" },
        ],
      },
    ],
  },
  {
    id: "social", name: "社交", color: "#A78BFA",
    children: [],
  },
];

// Historical snapshot of the pre-v3 code default (what `defaultClassificationTaxonomy`
// in App.jsx used to hardcode before this phase). Kept only so the migration preview
// can show a real three-way diff (live vs old-code-default vs v3-canonical) instead of
// live-vs-v3 twice, now that App.jsx's code default IS CANONICAL_TAXONOMY_V3.
export const LEGACY_CODE_DEFAULT_TAXONOMY_SNAPSHOT = [
  { id: "study", name: "学习", color: "#34D399", children: [
    { id: "math", name: "数学", keywords: "数学,网课,习题,错题", color: "#60A5FA", statGroup: "study", children: [{ id: "study.math.calculus", name: "高等数学", keywords: "高数,高等数学,微积分" }, { id: "study.math.linear", name: "线性代数", keywords: "线代,线性代数,矩阵,向量组" }] },
    { id: "english", name: "英语", keywords: "英语,雅思,单词,写作,口语,听力,阅读", color: "#A78BFA", statGroup: "study", children: [{ id: "study.english.vocabulary", name: "单词", keywords: "单词" }, { id: "study.english.ielts-writing", name: "雅思写作", keywords: "雅思写作,作文" }, { id: "study.english.ielts-reading", name: "雅思阅读", keywords: "雅思阅读" }, { id: "study.english.ielts-listening", name: "雅思听力", keywords: "雅思听力" }, { id: "study.english.ielts-speaking", name: "雅思口语", keywords: "雅思口语" }] },
    { id: "economics", name: "经济 / 专业课", keywords: "经济,金融,专业课", color: "#34D399", statGroup: "study", children: [{ id: "study.professional.corporate-finance", name: "公司金融", keywords: "公司金融,公司理财,DCF,折现现金流,资本预算" }, { id: "study.professional.investment", name: "投资学", keywords: "投资学" }] },
    { id: "paper", name: "论文", keywords: "论文,文献,写作", color: "#FB923C", statGroup: "study", children: [] },
    { id: "reading", name: "阅读", keywords: "阅读,书籍", color: "#34D399", statGroup: "reading", children: [] },
  ] },
  { id: "life", name: "生活", color: "#C58A00", children: [{ id: "personal", name: "个人 / 生活", keywords: "通勤,洗漱,吃饭,家务", color: "#C58A00", statGroup: "life", children: [] }, { id: "exercise", name: "运动", keywords: "运动,跑步,健身,拉伸", color: "#D95050", statGroup: "exercise", children: [] }] },
  { id: "rest", name: "休息娱乐", color: "#CF5B96", children: [{ id: "entertainment", name: "娱乐 / 休息", keywords: "游戏,视频,娱乐,休息", color: "#CF5B96", statGroup: "entertainment", children: [] }] },
];

// ---------------------------------------------------------------------------
// Legacy alias compatibility.
//
// IMPORTANT: the three entries below (math/english/reading -> study.math/study.english/
// study.reading) are a DELIBERATE NAMING CHOICE made in unified-taxonomy-v3-proposal.json,
// not an observed fact that live Firestore data or classificationTaxonomy code defaults
// already use the canonical full-path form. Existing/live data is expected to still use
// the bare legacy ids until migrated — that is exactly what this alias map and
// normalizeCategoryId()/mergeLiveTaxonomyWithCanonical() below are for: read-time
// compatibility plus an explicit, opt-in migration step (never a silent/passive rename).
//
// `entertainment.creative-writing` / `entertainment.creativeWriting` is intentionally
// NOT listed here: per Claire's correction (2026-07-23), 写小说 was never actually
// implemented under entertainment.* anywhere (v2 was never built), so there is no
// legacy data to be compatible with. It is superseded by hobby.creativeWriting, not
// aliased to it.
// ---------------------------------------------------------------------------

export const LEGACY_CATEGORY_ALIASES = Object.freeze({
  "math": "study.math",
  "english": "study.english",
  "reading": "study.reading",
  "study.math.linear": "study.math.linearAlgebra",
  "economics": "study.professional",
  "study.professional.corporate-finance": "study.professional.corporateFinance",
  "study.professional.investment": "study.professional.investments",
  "study.english.ielts-writing": "study.english.ieltsWriting",
  "study.english.ielts-reading": "study.english.ieltsReading",
  "study.english.ielts-listening": "study.english.ieltsListening",
  "study.english.ielts-speaking": "study.english.ieltsSpeaking",
  "project.personal-management": "project.personalManagement",
  "work.red-cross": "work.redCross",
  "work.party-youth": "work.partyYouth",
  "entertainment.short-video": "entertainment.shortVideo",
});

/**
 * Normalize a possibly-legacy categoryId to its canonical v3 id.
 * Unknown ids (including genuinely custom/unrecognized categories) pass through
 * unchanged — this function must never invent or delete data.
 */
export function normalizeCategoryId(categoryId) {
  const id = typeof categoryId === "string" ? categoryId.trim() : "";
  if (!id) return id;
  return Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_ALIASES, id) ? LEGACY_CATEGORY_ALIASES[id] : id;
}

// ---------------------------------------------------------------------------
// Traversal utilities (operate on the same nested tree shape).
// ---------------------------------------------------------------------------

export function flattenTaxonomy(taxonomy = []) {
  const rows = [];
  const visit = (node, level, parentId, primaryId, primaryName, secondaryId, secondaryName) => {
    if (!node || typeof node !== "object") return;
    const id = typeof node.id === "string" ? node.id : "";
    const row = {
      id,
      name: node.name || "",
      level,
      parentId: parentId || "",
      primaryId: level === 1 ? id : primaryId,
      primaryName: level === 1 ? node.name : primaryName,
      secondaryId: level === 2 ? id : secondaryId,
      secondaryName: level === 2 ? node.name : secondaryName,
      keywords: node.keywords || "",
      color: node.color || "",
      statGroup: node.statGroup || "",
      order: Number.isFinite(Number(node.order)) ? Number(node.order) : null,
    };
    rows.push(row);
    (Array.isArray(node.children) ? node.children : []).forEach((child) =>
      visit(child, level + 1, id, row.primaryId, row.primaryName, row.secondaryId, row.secondaryName));
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach((node) => visit(node, 1, "", "", "", "", ""));
  return rows;
}

export function findCanonicalNode(categoryId) {
  const id = normalizeCategoryId(categoryId);
  return flattenTaxonomy(CANONICAL_TAXONOMY_V3).find((row) => row.id === id) || null;
}

export function getCanonicalPath(categoryId) {
  const node = findCanonicalNode(categoryId);
  if (!node) return [];
  return [node.primaryName, node.secondaryName, node.level === 3 ? node.name : ""].filter(Boolean);
}

// ---------------------------------------------------------------------------
// reviewBinding metadata — which src/utils/reviewSchema.js and/or
// src/review/dailyReviewSchema.js field ids correspond to each canonical categoryId.
// Both files are stable, independently-maintained catalogs (see unified-taxonomy-v3
// -proposal.md section 0.1) — coverage is intentionally not identical between them,
// that divergence is recorded here rather than papered over.
// ---------------------------------------------------------------------------

export const REVIEW_BINDINGS = Object.freeze({
  "study.math": { totalMinutes: "study.math.totalMinutes", sources: ["reviewSchema.js", "dailyReviewSchema.js"] },
  "study.math.calculus": { duration: "study.math.calculus.duration", progress: "study.math.calculus.progress", sources: ["reviewSchema.js", "dailyReviewSchema.js"] },
  "study.math.linearAlgebra": { duration: "study.math.linearAlgebra.duration", progress: "study.math.linearAlgebra.progress", sources: ["reviewSchema.js", "dailyReviewSchema.js"] },
  "study.english": { totalMinutes: "study.english.totalMinutes", sources: ["reviewSchema.js", "dailyReviewSchema.js"] },
  "study.english.vocabulary": { duration: "study.english.vocabulary.duration", progress: "study.english.vocabulary.progress", sources: ["reviewSchema.js (duration only)", "dailyReviewSchema.js"] },
  "study.english.ieltsWriting": { duration: "study.english.ieltsWriting.duration", progress: "study.english.ieltsWriting.progress", sources: ["reviewSchema.js (duration only)", "dailyReviewSchema.js"] },
  "study.english.ieltsReading": { duration: "study.english.ieltsReading.duration", progress: "study.english.ieltsReading.progress", sources: ["reviewSchema.js (duration only)", "dailyReviewSchema.js"] },
  "study.english.ieltsListening": { duration: "study.english.ieltsListening.duration", progress: "study.english.ieltsListening.progress", sources: ["reviewSchema.js (duration only)", "dailyReviewSchema.js"] },
  "study.english.ieltsSpeaking": { duration: "study.english.ieltsSpeaking.duration", progress: "study.english.ieltsSpeaking.progress", sources: ["reviewSchema.js (duration only)", "dailyReviewSchema.js"] },
  "study.professional": { totalMinutes: "study.professional.totalMinutes", sources: ["reviewSchema.js", "dailyReviewSchema.js"] },
  "study.professional.corporateFinance": { duration: "study.professional.corporateFinance.duration", progress: "study.professional.corporateFinance.progress", sources: ["reviewSchema.js (duration only)", "dailyReviewSchema.js"] },
  "study.professional.investments": { duration: "study.professional.investments.duration", progress: "study.professional.investments.progress", sources: ["reviewSchema.js (duration only)", "dailyReviewSchema.js"] },
  "paper": { sources: [], note: "No review field exists for paper in either file — pre-existing gap." },
  "study.reading": { totalMinutes: "study.reading.totalMinutes", bookTitle: "study.reading.bookTitle", content: "study.reading.content", feeling: "study.reading.feeling", sources: ["reviewSchema.js (totalMinutes only)", "dailyReviewSchema.js"] },
  "study.japanese": { totalMinutes: "study.japanese.totalMinutes", progress: "study.japanese.progress", adjustment: "study.japanese.adjustment", sources: ["reviewSchema.js (totalMinutes only)", "dailyReviewSchema.js"] },
  "exercise": { totalMinutes: "exercise.today.totalMinutes", activity: "exercise.today.activity", feeling: "exercise.today.feeling", intensity: "exercise.today.intensity", sources: ["reviewSchema.js (totalMinutes only)", "dailyReviewSchema.js"] },
  "entertainment": { totalMinutes: "entertainment.today.totalMinutes", feeling: "entertainment.today.feeling", sources: ["reviewSchema.js (totalMinutes only)", "dailyReviewSchema.js"] },
  "entertainment.wenyou": { duration: "entertainment.today.wenyou.duration", sources: ["dailyReviewSchema.js"] },
  "entertainment.game": { duration: "entertainment.today.game.duration", sources: ["dailyReviewSchema.js"] },
  "entertainment.video": { duration: "entertainment.today.video.duration", sources: ["dailyReviewSchema.js"] },
  "entertainment.shortVideo": { duration: "entertainment.today.shortVideo.duration", sources: ["dailyReviewSchema.js"] },
  "entertainment.novel": { duration: "entertainment.today.novel.duration", sources: ["dailyReviewSchema.js"] },
  "entertainment.other": { duration: "entertainment.today.other.duration", sources: ["dailyReviewSchema.js"] },
  "project.personalManagement": { totalMinutes: "project.personalManagement.totalMinutes", progress: "project.personalManagement.progress", adjustment: "project.personalManagement.adjustment", sources: ["reviewSchema.js (totalMinutes only)", "dailyReviewSchema.js"] },
  "work.redCross": { totalMinutes: "work.redCross.totalMinutes", progress: "work.redCross.progress", adjustment: "work.redCross.adjustment", sources: ["reviewSchema.js (totalMinutes only)", "dailyReviewSchema.js"] },
  "work.partyYouth": { totalMinutes: "work.partyYouth.totalMinutes", progress: "work.partyYouth.progress", adjustment: "work.partyYouth.adjustment", sources: ["reviewSchema.js (totalMinutes only)", "dailyReviewSchema.js"] },
  "family": { totalMinutes: "family.contact.totalMinutes", sources: ["reviewSchema.js (sub-durations only)", "dailyReviewSchema.js"] },
  "misc": { totalMinutes: "misc.today.totalMinutes", sources: ["reviewSchema.js", "dailyReviewSchema.js"] },
  "misc.diary": { duration: "misc.today.diary.duration", sources: ["dailyReviewSchema.js (this phase)"], note: "Kept explicitly separate from misc.today.review.duration (复盘 time, a different concept)." },
  "hobby": { totalMinutes: "hobby.totalMinutes", sources: ["dailyReviewSchema.js (this phase)"] },
  "hobby.creativeWriting": { duration: "hobby.creativeWriting.duration", progress: "hobby.creativeWriting.progress", sources: ["dailyReviewSchema.js (this phase)"] },
  "hobby.music.singing": { duration: "hobby.music.singing.duration", progress: "hobby.music.singing.progress", sources: ["dailyReviewSchema.js (this phase)"] },
  "hobby.music.guitar": { duration: "hobby.music.guitar.duration", progress: "hobby.music.guitar.progress", sources: ["dailyReviewSchema.js (this phase)"] },
  "hobby.crafts.perlerBeads": { duration: "hobby.crafts.perlerBeads.duration", progress: "hobby.crafts.perlerBeads.progress", sources: ["dailyReviewSchema.js (this phase)"] },
  "social": { sources: [], note: "Taxonomy-only placeholder per Claire's instruction — no review fields, no TickTick binding." },
});

// ---------------------------------------------------------------------------
// TickTick / Catkeeper Category Catalog metadata — canonical categoryId ->
// keywords + known legacy TickTick-side aliases, sourced from
// E:\Cyberboss\docs\ticktick-taxonomy-migration-plan.json (read-only reference,
// no TickTick data is read or written by this module).
// ---------------------------------------------------------------------------

export const TICKTICK_CATEGORY_ALIASES = Object.freeze({
  "study.math.calculus": ["高等数学"],
  "study.math.linearAlgebra": ["线性代数"],
  "study.english.vocabulary": ["背单词", "单词"],
  "study.english.ieltsWriting": ["雅思写作"],
  "study.english.ieltsReading": ["雅思阅读"],
  "study.english.ieltsListening": ["雅思听力"],
  "study.english.ieltsSpeaking": ["雅思口语"],
  "study.professional.corporateFinance": ["公司金融"],
  "study.reading": ["阅读"],
  "study.japanese": ["日语"],
  "work.redCross": ["红会"],
  "work.partyYouth": ["党团"],
  "project.personalManagement": ["个人管理体系：snow-dust", "个人管理系统"],
  "entertainment.wenyou": ["文游"],
  "entertainment.game": ["游戏"],
  "entertainment.video": ["看片子"],
  "entertainment.shortVideo": ["刷小红书"],
  "entertainment.novel": ["看小说"],
  "entertainment.other": ["放松", "木鱼水心《史记》", "购物"],
  "misc.diary": ["写日记"],
  "hobby.creativeWriting": ["写作 (原地改名为 写小说)", "写小说"],
  "hobby.music.singing": ["唱歌"],
  "hobby.music.guitar": ["吉他"],
  "hobby.crafts.perlerBeads": ["拼豆"],
});

// ---------------------------------------------------------------------------
// Merge algorithm: bring a live (possibly customized, possibly legacy-id) taxonomy
// tree up to date with the canonical v3 tree, WITHOUT losing any user customization
// or any node the canonical tree doesn't know about.
//
// Rules (see unified-taxonomy-v3-proposal + Claire's phase-1 instructions):
// 1. Legacy ids are normalized to canonical ids on read.
// 2. Where a live node matches a canonical node (by normalized id), the LIVE node's
//    name/color/keywords/order/enabled/archived/trackInWeeklyReview win — canonical
//    values are only used as defaults for brand-new nodes.
// 3. Canonical nodes missing from the live tree are added (using canonical defaults).
// 4. Live nodes not present in canonical at all (real custom categories) are kept,
//    never deleted.
// 5. Pure function — no Firestore access, no side effects. Idempotent: merging the
//    merge output again with the same canonical tree produces an identical result.
// ---------------------------------------------------------------------------

function mergeLevel(liveNodes, canonicalNodes, level, diff) {
  const liveEntries = (Array.isArray(liveNodes) ? liveNodes : [])
    .filter((node) => node && typeof node === "object" && typeof node.id === "string" && node.id.trim())
    .map((node) => {
      const rawId = node.id;
      const normId = normalizeCategoryId(rawId);
      if (normId !== rawId) diff.normalizedIds.push({ from: rawId, to: normId, level });
      return { rawId, normId, node };
    });
  const liveByNormId = new Map();
  liveEntries.forEach((entry) => {
    // If two live nodes normalize to the same id (e.g. duplicate legacy+canonical rows
    // already both present), keep the first and record the rest as unknown so nothing
    // silently disappears.
    if (!liveByNormId.has(entry.normId)) liveByNormId.set(entry.normId, entry);
  });

  const result = [];
  const consumed = new Set();

  (Array.isArray(canonicalNodes) ? canonicalNodes : []).forEach((canonicalNode) => {
    const match = liveByNormId.get(canonicalNode.id);
    if (match) {
      consumed.add(canonicalNode.id);
      const mergedChildren = mergeLevel(match.node.children, canonicalNode.children, level + 1, diff);
      result.push({ ...match.node, id: canonicalNode.id, children: mergedChildren });
    } else {
      diff.addedNodes.push({ id: canonicalNode.id, name: canonicalNode.name, level });
      const mergedChildren = mergeLevel([], canonicalNode.children, level + 1, diff);
      result.push({ ...canonicalNode, children: mergedChildren });
    }
  });

  liveEntries.forEach((entry) => {
    if (consumed.has(entry.normId)) return;
    if (result.some((row) => row.id === entry.normId)) {
      // duplicate normalized id collision guard — keep as unknown without clobbering
      diff.duplicateIds.push({ id: entry.rawId, normalizedId: entry.normId, level });
      return;
    }
    diff.unknownLiveNodes.push({ id: entry.rawId, normalizedId: entry.normId, name: entry.node.name, level });
    const mergedChildren = mergeLevel(entry.node.children, [], level + 1, diff);
    result.push({ ...entry.node, id: entry.normId, children: mergedChildren });
  });

  result.forEach((node, index) => { node.order = index; });
  return result;
}

export function mergeLiveTaxonomyWithCanonical({ liveTaxonomy = [], canonicalTaxonomy = CANONICAL_TAXONOMY_V3 } = {}) {
  const diff = { addedNodes: [], normalizedIds: [], unknownLiveNodes: [], duplicateIds: [] };
  const taxonomy = mergeLevel(liveTaxonomy, canonicalTaxonomy, 1, diff);
  return { taxonomy, diff };
}

// ---------------------------------------------------------------------------
// Three-way diff (live vs code default vs canonical v3) for the settings-page
// migration preview. Read-only — never mutates or writes anything.
// ---------------------------------------------------------------------------

export function buildThreeWayTaxonomyDiff({ liveTaxonomy = [], defaultTaxonomy = [], canonicalTaxonomy = CANONICAL_TAXONOMY_V3 } = {}) {
  const liveRows = flattenTaxonomy(liveTaxonomy);
  const defaultRows = flattenTaxonomy(defaultTaxonomy);
  const canonicalRows = flattenTaxonomy(canonicalTaxonomy);

  const liveByNormId = new Map(liveRows.map((row) => [normalizeCategoryId(row.id), row]));
  const defaultByNormId = new Map(defaultRows.map((row) => [normalizeCategoryId(row.id), row]));
  const canonicalById = new Map(canonicalRows.map((row) => [row.id, row]));

  const { diff: mergeDiff } = mergeLiveTaxonomyWithCanonical({ liveTaxonomy, canonicalTaxonomy });

  const fieldDiffs = [];
  canonicalRows.forEach((canonicalRow) => {
    const liveRow = liveByNormId.get(canonicalRow.id);
    if (!liveRow) return;
    const changed = {};
    if (liveRow.name && liveRow.name !== canonicalRow.name) changed.name = { live: liveRow.name, canonical: canonicalRow.name };
    if (liveRow.keywords && liveRow.keywords !== canonicalRow.keywords) changed.keywords = { live: liveRow.keywords, canonical: canonicalRow.keywords };
    if (liveRow.color && liveRow.color !== canonicalRow.color) changed.color = { live: liveRow.color, canonical: canonicalRow.color };
    if (liveRow.order != null && canonicalRow.order != null && liveRow.order !== canonicalRow.order) changed.order = { live: liveRow.order, canonical: canonicalRow.order };
    if (liveRow.level !== canonicalRow.level) changed.level = { live: liveRow.level, canonical: canonicalRow.level };
    if (Object.keys(changed).length) fieldDiffs.push({ id: canonicalRow.id, changed });
  });

  const liveOnlyVsDefault = liveRows.filter((row) => !defaultByNormId.has(normalizeCategoryId(row.id)));
  const defaultOnlyVsLive = defaultRows.filter((row) => !liveByNormId.has(normalizeCategoryId(row.id)));

  return {
    generatedAt: new Date().toISOString(),
    liveNodeCount: liveRows.length,
    defaultNodeCount: defaultRows.length,
    canonicalNodeCount: canonicalRows.length,
    legacyIdsFoundInLive: mergeDiff.normalizedIds,
    canonicalNodesMissingFromLive: mergeDiff.addedNodes,
    liveOnlyNodes: mergeDiff.unknownLiveNodes,
    fieldLevelDifferences: fieldDiffs,
    liveVsDefaultOnlyInLive: liveOnlyVsDefault.map((row) => ({ id: row.id, name: row.name, level: row.level })),
    liveVsDefaultOnlyInDefault: defaultOnlyVsLive.map((row) => ({ id: row.id, name: row.name, level: row.level })),
    legacyAliasTable: LEGACY_CATEGORY_ALIASES,
  };
}
