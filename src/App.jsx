import { Component, Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { calculatePoolDropTarget } from "./utils/plannerDropTarget";
import { buildTemplateSnapshotContent, defaultTemplateSaveScopes, instantiateTemplateTaskCollections, mergeTemplateSnapshotContent } from "./utils/plannerTemplateSnapshot";
import { chooseNewestPlannerState, loadPlannerRecovery, savePlannerRecovery } from "./utils/plannerDraftRecovery";
import {
  asArray,
  asRecord,
  normalizeScheduleAssistantDraft,
  normalizeScheduleAssistantSettings,
  normalizeScheduleDraftArchive,
} from "./utils/plannerNormalization";
import { readPlannerFeatureFlags } from "./utils/plannerFeatureFlags";
import { buildCategoryTimeProgress, buildLifeMaintenanceSummary, buildReviewTrackerSummary, buildStudyComposition, formatDuration, groupTaskPlacementProgress, normalizeMaintenanceItemOrder, normalizePlannerCategoryOrder, sortCategoriesByOrder, summarizePeriodUsage, mergeLifeMaintenanceItems } from "./utils/plannerOverview";
import { getBlockActiveMinutes, summarizePlannerMinutes } from "./utils/plannerMinutes";
import { buildAgentDaySnapshot, buildAgentDaySnapshotFromDailyData } from "./agent/buildAgentDaySnapshot";
import { buildCatkeeperCategoryCatalog } from "./agent/buildCategoryCatalog";
import {
  CANONICAL_TAXONOMY_V3,
  LEGACY_CATEGORY_ALIASES,
  normalizeCategoryId,
  legacyIdsFor,
  mergeLiveTaxonomyWithCanonical,
  buildThreeWayTaxonomyDiff,
  normalizeReviewConfig,
  isLeafTaxonomyNode,
} from "./taxonomy/taxonomyContract";
import TaxonomyMigrationPanel from "./taxonomy/TaxonomyMigrationPanel";
import { LIFE_CATEGORY_IDS, allocateTasksAcrossDates, ensureLifeCategories, ensureMorningRoutineCard, findDayStartAnchor, isMorningRoutineCard, migrateLegacyFixedEvents, resolvePlannerTimelineStart, unifyPlannerDraftCards } from "./utils/unifiedPlannerCards";
import {
  clearConnectionSettings,
  createSnapshotAutoSync,
  loadConnectionSettings,
  saveConnectionSettings,
  sendCategoryCatalog,
  sendSnapshot,
  testConnection,
} from "./agent/catkeeperSnapshotSender";
import {
  Award,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Coins,
  Copy,
  Upload,
  Download,
  Edit3,
  Gamepad2,
  Gift,
  History,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Moon,
  PackagePlus,
  Plus,
  Palette,
  Save,
  Settings,
  Sparkles,
  Target,
  Trash2,
  Undo2,
  GripVertical,
  Lock,
  Unlock,
  Wand2,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider, isFirebaseConfigured } from "./services/firebase";
import {
  createSettlement,
  completeDevelopmentPlan,
  completeScheduleSegmentGoal,
  deleteCategory,
  deleteDevelopmentPlan,
  deleteProduct,
  deleteLatestRedemption,
  deleteLatestSettlement,
  ensureUserSeed,
  redeemProduct,
  redeemEntertainmentExtension,
  reviseSettlement,
  rollbackSettlementsTo,
  saveCategory,
  saveDevelopmentPlan,
  saveDiaryEntry,
  saveEntertainmentLog,
  saveMathProgressRecord,
  saveProfessionalProgressRecord,
  saveProjectRewardApplication,
  saveBookEntry,
  saveProduct,
  saveProfileSettings,
  saveReviewWorkbenchSettlement,
  syncDiaryFromSettlement,
  syncReadingFromSettlement,
  subscribeUserData,
} from "./services/dataService";
import { loadDemoData, saveDemoData } from "./services/demoStore";
import { saveReviewDraft } from "./services/reviewDraftService";
import {
  calculateBankPointsAdded,
  calculateDaysLeft,
  calculateFreeEntertainmentScore,
  calculateWorkPoints,
  DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
  calculateGeneratedMinutes,
  estimateDaysToCart,
  estimateDaysToProduct,
  formatDateOnly,
  formatDateTime,
  intensityPresets,
  formatPoints,
  roundPoints,
  round1,
  toNumber,
} from "./utils/calculations";
import { parseReviewMarkdown } from "./utils/reviewParser";
import { reviewValueLines, reviewValueText } from "./utils/reviewValue";
import { readClipboardText, writeClipboardText } from "./utils/clipboard";
import { buildDefaultReviewMarkdown, DEFAULT_REVIEW_MARKDOWN } from "./utils/defaultReviewMarkdown";
import { categoryLabel, reviewSchemaFieldOptions, reviewSchemaFields } from "./utils/reviewSchema";
import DailyReviewWorkbench from "./review/DailyReviewWorkbench";
import {
  countDiaryWords,
  generateDiarySummary,
  generateDiaryTitle,
  groupDiaryTags,
  normalizeDiaryTags,
  parseDiaryFromMarkdown,
  splitDiaryListValue,
} from "./utils/diaryParser";
import { classifyDay, dayTypeLabels, entertainmentTypeText, extensionCostMap, getExtensionCost } from "./utils/dayType";
import { exportRedemptionsCsv, exportSettlementsCsv, exportWeeklySummaryCsv } from "./utils/exportCsv";
import { buildWeeklySummary, minutesLabel } from "./utils/weeklySummary";
import {
  extractMathProgressFromReview,
  getProgressMap,
  isItemFullyComplete,
  isSectionComplete,
  mathCurriculum,
  mathTracks,
} from "./utils/mathProgress";
import {
  extractProfessionalProgressFromReview,
  getProfessionalProgressMap,
  isProfessionalSectionComplete,
  professionalCurriculum,
  professionalStages,
} from "./utils/professionalProgress";
import { cleanBookTitle, normalizeBookTitle, readingBookId, readingSessionId, readingStatusText } from "./utils/reading";

const tabs = [
  { id: "dashboard", label: "首页", icon: LayoutDashboard },
  { id: "settlement", label: "每日结算", icon: CalendarClock },
  { id: "schedule", label: "明日排程", icon: Wand2 },
  { id: "mall", label: "奖励商场", icon: Gift },
  { id: "estimator", label: "目标估算", icon: Target },
  { id: "weekly", label: "周总结", icon: Award },
  { id: "english", label: "英语追踪", icon: Sparkles },
  { id: "diary", label: "日记档案", icon: Edit3 },
  { id: "library", label: "小椰图书馆", icon: BookOpen },
  { id: "mathProgress", label: "数学进度", icon: Check },
  { id: "professionalProgress", label: "专业课进度", icon: BookOpen },
  { id: "records", label: "历史记录", icon: History },
  { id: "settings", label: "设置", icon: Settings },
];

const sleepAdjustmentOptions = [
  { value: 3, label: "22:30 前入睡：+3分" },
  { value: 2, label: "22:30-23:00 入睡：+2分" },
  { value: 1.5, label: "23:00-23:20 入睡：+1.5分" },
  { value: 0.5, label: "23:20-23:40 入睡：+0.5分" },
  { value: -1, label: "23:40-00:10 入睡：-1分" },
  { value: -1.5, label: "00:10-00:40 入睡：-1.5分" },
  { value: -2, label: "00:40 后入睡：-2分" },
];

const defaultEntertainmentQuickPresets = [
  { id: "game-10", type: "game", minutes: 10, label: "游戏 10min" },
  { id: "game-30", type: "game", minutes: 30, label: "游戏 30min" },
  { id: "sing-20", type: "singing", minutes: 20, label: "唱歌 20min" },
  { id: "video-15", type: "video", minutes: 15, label: "视频 15min" },
];

const blankProduct = {
  name: "",
  categoryId: "",
  price: 15,
  description: "",
  icon: "",
  imageUrl: "",
  rarity: "rare",
  priority: "medium",
  status: "available",
  limitedUntil: "",
  repeatable: true,
  note: "",
};

const blankCategory = {
  name: "",
  icon: "✨",
  color: "#8B5CF6",
  description: "",
};

const blankDevelopmentPlan = {
  title: "",
  kind: "feature",
  type: "feature",
  estimatedMinutes: 15,
  priority: "medium",
  status: "idea",
  note: "",
};

const scheduleSceneOptions = [
  ["home", "在家"],
  ["school", "在校"],
  ["school_with_exercise", "在校且运动"],
  ["outside", "外出 / 通勤"],
  ["commute", "通勤日"],
  ["special_affairs", "特殊事务"],
  ["uncertain", "不确定"],
];

const restPreferenceOptions = [
  ["low_stimulus_20", "低刺激休息 20min"],
  ["singing_or_guitar_30", "唱歌 / 吉他 30min"],
  ["drawing_30", "画画 30min"],
  ["walk_30", "散步 30min"],
  ["game_if_allowed", "如果允许，安排游戏"],
  ["no_game", "不安排游戏 / 视频"],
];

const systemDevelopmentLimitOptions = [
  ["none", "不安排"],
  ["max_30", "最多 30min"],
  ["max_50", "最多 50min"],
  ["only_if_mainlines_done", "只有主线完成后才允许"],
];

const exerciseModeOptions = [
  ["auto", "自动判断"],
  ["formal_exercise", "正式运动"],
  ["recovery", "恢复 / 拉伸"],
  ["light_stretch", "轻运动 20-30min"],
  ["skip_with_reason", "今天不运动"],
];

const englishSkillOptions = [
  ["writing", "写作"],
  ["speaking", "口语"],
  ["reading", "阅读"],
  ["listening", "听力"],
];

const englishSkillText = {
  writing: "写作",
  speaking: "口语",
  reading: "阅读",
  listening: "听力",
};

const entertainmentOopsMessages = [
  "小椰看见了：今天有点越界，但不是世界末日。收住、洗漱、复盘，下一局别让系统接管你。",
  "今天这把娱乐有点冲出围栏啦。小椰不骂你，但小椰会蹲在门口提醒：下次到点就撤。",
  "记录得很诚实，已经很重要了。现在我们把边界捡回来，明天别再让快乐开无双哦。",
  "嗯哼，被小椰抓到一点点失控。没关系，今天先收尾，明天用更短的快乐拿回主动权。",
  "小椰轻轻敲桌：玩可以，漂走不行。现在回港，明天继续当主线玩家。",
];

const defaultMathTemplates = [
  {
    id: "standard-math-day",
    name: "标准数学日",
    lectureBlocks50: 3,
    exerciseBlocks50: 2,
    reviewBlocks30: 1,
    errorReviewBlocks50: 0,
    summaryBlocks30: 0,
    note: "适合普通学习日：3×50网课 + 2×50习题 + 30min复习",
  },
  {
    id: "exercise-catch-up",
    name: "习题补账日",
    lectureBlocks50: 1,
    exerciseBlocks50: 3,
    reviewBlocks30: 1,
    errorReviewBlocks50: 1,
    summaryBlocks30: 0,
    note: "适合网课进度够但题少的日子",
  },
  {
    id: "low-state-keep-line",
    name: "低状态保线日",
    lectureBlocks50: 0,
    exerciseBlocks50: 1,
    reviewBlocks30: 1,
    errorReviewBlocks50: 0,
    summaryBlocks30: 0,
    note: "适合低状态：习题 1×50 + 复习 30min",
  },
  {
    id: "high-intensity-math",
    name: "高强度数学日",
    lectureBlocks50: 4,
    exerciseBlocks50: 3,
    reviewBlocks30: 1,
    errorReviewBlocks50: 1,
    summaryBlocks30: 0,
    note: "适合数学主攻日",
  },
  {
    id: "review-organize-day",
    name: "复习整理日",
    lectureBlocks50: 0,
    exerciseBlocks50: 2,
    reviewBlocks30: 1,
    errorReviewBlocks50: 2,
    summaryBlocks30: 1,
    note: "适合阶段复盘，不推进新课",
  },
];

const defaultEnglishTemplates = [
  {
    id: "english-one-skill",
    name: "标准英语日",
    wordMinutes: 30,
    skillCount: 1,
    skillMinutes: 50,
    skillMode: "recommended",
    note: "单词固定 + 推荐专项 1 项",
  },
  {
    id: "english-two-skills",
    name: "双专项推进日",
    wordMinutes: 30,
    skillCount: 2,
    skillMinutes: 40,
    skillMode: "recommended",
    note: "适合一天推两项：单词 + 两个雅思专项",
  },
  {
    id: "english-light",
    name: "低状态保线日",
    wordMinutes: 20,
    skillCount: 1,
    skillMinutes: 25,
    skillMode: "recommended",
    note: "只保英语出现，不压主线精力",
  },
  {
    id: "english-writing-focus",
    name: "写作主攻日",
    wordMinutes: 30,
    skillCount: 1,
    skillMinutes: 60,
    skillMode: "manual",
    manualSkills: ["writing"],
    note: "适合专门打磨作文逻辑链",
  },
];

const plannerCategoryDefinitions = [
  { id: "math", name: "数学", shortName: "数学", foreground: "#60A5FA", background: "#EAF2FF", statGroup: "study" },
  { id: "english", name: "英语 / 雅思", shortName: "英语", foreground: "#A78BFA", background: "#F1EAFE", statGroup: "study" },
  { id: "economics", name: "经济 / 专业课", shortName: "专业课", foreground: "#34D399", background: "#E8F7ED", statGroup: "study" },
  { id: "paper", name: "论文", shortName: "论文", foreground: "#FB923C", background: "#FFF0E2", statGroup: "study" },
  { id: "personal", name: "个人 / 生活", shortName: "生活", foreground: "#C58A00", background: "#FFF7D8", statGroup: "life" },
  { id: "exercise", name: "运动", shortName: "运动", foreground: "#D95050", background: "#FFE8E8", statGroup: "exercise" },
  { id: "reading", name: "阅读", shortName: "阅读", foreground: "#34D399", background: "#E4F7F3", statGroup: "reading" },
  { id: "entertainment", name: "娱乐 / 休息", shortName: "娱乐", foreground: "#CF5B96", background: "#FCE8F3", statGroup: "entertainment" },
];

// Canonical default taxonomy now lives in ./taxonomy/taxonomyContract.js (unified
// taxonomy v3 contract), not inline here — see that module for the source of truth
// and for legacy alias / normalization / merge utilities.
const defaultClassificationTaxonomy = CANONICAL_TAXONOMY_V3;

const legacyPlannerCategoryIds = {
  "数学": "math", "英语/雅思": "english", "英语 / 雅思": "english", "论文": "paper",
  "专业课": "economics", "经济/金融": "economics", "经济类": "economics", "运动": "exercise",
  "娱乐": "entertainment", "休息": "entertainment", "阅读": "reading", "生活": "personal", "固定": "personal",
};
Object.assign(legacyPlannerCategoryIds, {
  ielts: "english",
  IELTS: "english",
  english: "english",
  English: "english",
});

const defaultRhythmPresets = [
  { id: "rhythm-50-10", label: "50+10", workMinutes: 50, restMinutes: 10, segmentCount: 1, order: 1, enabled: true, builtIn: true },
  { id: "rhythm-50-15", label: "50+15", workMinutes: 50, restMinutes: 15, segmentCount: 1, order: 2, enabled: true, builtIn: true },
  { id: "rhythm-30", label: "30", workMinutes: 30, restMinutes: 0, segmentCount: 1, order: 3, enabled: true, builtIn: true },
  { id: "rhythm-90", label: "90", workMinutes: 90, restMinutes: 0, segmentCount: 1, order: 4, enabled: true, builtIn: true },
  { id: "rhythm-50x2", label: "50×2", workMinutes: 50, restMinutes: 10, segmentCount: 2, order: 5, enabled: true, builtIn: true },
];

const defaultScheduleAssistantSettings = {
  defaultWakeUpTime: "07:30",
  defaultBedTime: "23:20",
  defaultScene: "uncertain",
  defaultLunchBlockMinutes: 90,
  defaultDinnerMinutes: 40,
  defaultStartupBufferMinutes: 20,
  defaultFormalRestMinutes: 30,
  defaultFormalRestBlocks: 1,
  defaultMorningPrepMinutes: 20,
  defaultShowerMinutes: 25,
  defaultMaskMinutes: 20,
  defaultMathTemplateId: "standard-math-day",
  mathTemplates: defaultMathTemplates,
  defaultEnglishTemplateId: "english-one-skill",
  englishTemplates: defaultEnglishTemplates,
  englishRotationSettings: {
    wordBlockFixed: true,
    defaultWordMinutes: 30,
    rotationMode: "auto_rotate",
    enabledSkills: ["writing", "speaking", "reading", "listening"],
    defaultSkillMinutes: 50,
    manualSelectedSkill: "writing",
  },
  defaultThesisMinutes: 90,
  defaultProfessionalMinutes: 50,
  defaultSystemDevelopmentLimit: "max_30",
  defaultRestPreference: "low_stimulus_20",
  commonTasks: [],
  rhythmPresets: defaultRhythmPresets,
  defaultDayTemplateId: "builtin-standard",
  dayTemplates: [],
  deletedDayTemplateSystemKeys: [],
};

const generalTaskPoolTemplateTasks = [
  ["数学｜主课", "math", 50, 10, 2, 1, ["morning", "afternoon"]], ["数学｜习题", "math", 50, 10, 1, 2, ["morning", "afternoon", "evening"]],
  ["英语｜单词", "english", 15, 0, 1, 3, ["morning", "evening"]], ["英语｜专项", "english", 45, 10, 1, 4, ["afternoon", "evening"]],
  ["经济 / 专业课｜主课", "economics", 50, 10, 2, 5, ["afternoon", "evening"]], ["论文 / 报告｜可见产出", "paper", 90, 10, 1, 6, ["afternoon", "evening"]], ["阅读", "reading", 30, 0, 1, 7, ["afternoon", "evening"]],
  ["运动｜正式运动", "exercise", 40, 10, 1, 8, ["afternoon", "evening"]], ["运动｜轻量恢复", "exercise", 30, 10, 1, 9, ["afternoon", "evening"]],
  ["娱乐｜自由娱乐", "entertainment", 30, 0, 1, 10, ["afternoon", "evening"]], ["娱乐｜游戏", "entertainment", 60, 0, 1, 11, ["evening"]], ["娱乐｜唱歌 / 吉他", "entertainment", 30, 0, 1, 12, ["afternoon", "evening"]], ["娱乐｜休息放松", "entertainment", 30, 0, 1, 13, ["afternoon", "evening"]],
  ["起床与洗漱", "personal", 20, 0, 1, 14, ["morning"]], ["午饭＋补剂＋午休", "personal", 90, 0, 1, 15, ["midday"]], ["午间启动缓冲", "personal", 20, 0, 1, 16, ["midday"]], ["晚饭", "personal", 40, 0, 1, 17, ["evening"]], ["洗澡", "personal", 30, 0, 1, 18, ["evening"]], ["敷面膜 / 护肤", "personal", 20, 0, 1, 19, ["evening"]], ["复盘与日记", "personal", 30, 0, 1, 20, ["evening"]], ["睡前洗漱与上床准备", "personal", 30, 0, 1, 21, ["evening"]], ["通勤", "personal", 80, 0, 1, 22, ["morning", "evening"]], ["收拾整理", "personal", 20, 0, 1, 23, ["afternoon", "evening"]], ["工作 / 事务处理", "personal", 50, 10, 1, 24, ["afternoon", "evening"]],
].map(([title, categoryId, workMinutes, breakMinutes, segmentCount, manualOrder, preferredPeriods]) => ({ templateItemId: `general-pool-${manualOrder}`, title, categoryId, segments: Array.from({ length: segmentCount }, () => workMinutes), workMinutes, breakMinutes, segmentCount, priority: manualOrder <= 2 || manualOrder === 5 || manualOrder === 6 ? 1 : manualOrder <= 7 || manualOrder >= 14 ? 2 : 3, manualOrder, preferredPeriods, splittable: segmentCount > 1 }));

const factoryPlannerTemplateSeeds = [
  { systemKey: "claire-general-task-pool", name: "通用基准任务池", description: "只提供完整任务池，不预排固定事件或时间线。", content: { wakeUpTime: "07:30", targetBedTime: "23:20", scene: "home", fixedEvents: [], defaultTaskGroups: generalTaskPoolTemplateTasks, timelineSegments: [] } },
  { systemKey: "builtin-standard", name: "在校标准日", content: { wakeUpTime: "07:30", targetBedTime: "23:20", scene: "school", commuteStatus: "no", morningPrepMinutes: 40, lunchBlockMinutes: 90, startupBufferMinutes: 20, formalRestMinutes: 30, formalRestBlocks: 1, fixedEvents: [], exerciseMinutes: 40, exerciseType: "正式运动" } },
  { systemKey: "builtin-commute", name: "通勤上学日", content: { wakeUpTime: "07:10", targetBedTime: "23:20", scene: "school", commuteStatus: "yes", morningPrepMinutes: 70, lunchBlockMinutes: 90, startupBufferMinutes: 20, formalRestMinutes: 30, formalRestBlocks: 1, fixedEvents: [] } },
  { systemKey: "builtin-outing", name: "出游日", content: { wakeUpTime: "08:00", targetBedTime: "23:30", scene: "outing", commuteStatus: "yes", morningPrepMinutes: 40, lunchBlockMinutes: 90, startupBufferMinutes: 20, formalRestMinutes: 30, formalRestBlocks: 1, fixedEvents: [], exerciseMinutes: 0, exerciseType: "出游步行" } },
  { systemKey: "builtin-work", name: "工作事务日", content: { wakeUpTime: "07:40", targetBedTime: "23:20", scene: "work", commuteStatus: "uncertain", morningPrepMinutes: 30, lunchBlockMinutes: 90, startupBufferMinutes: 20, formalRestMinutes: 30, formalRestBlocks: 1, fixedEvents: [], professionalMinutes: 30, thesisMinutes: 40 } },
  { systemKey: "builtin-low", name: "低状态保线日", content: { wakeUpTime: "08:30", targetBedTime: "23:00", scene: "home", commuteStatus: "no", morningPrepMinutes: 20, lunchBlockMinutes: 90, startupBufferMinutes: 20, formalRestMinutes: 30, formalRestBlocks: 2, fixedEvents: [], exerciseMinutes: 20, exerciseType: "恢复 / 拉伸" } },
];

function makeDemoUser() {
  return {
    uid: "demo-user",
    displayName: "Claire",
    email: "本地演示模式，配置 Firebase 后启用云同步",
    photoURL: "",
    isDemo: true,
  };
}

function normalizeDataPoints(value) {
  if (!value) return value;
  return {
    ...value,
    profile: {
      ...(value.profile || {}),
      points: roundPoints(value.profile?.points),
    },
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [user, setUser] = useState(isFirebaseConfigured ? null : makeDemoUser());
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [toast, setToast] = useState("");
  const [data, setData] = useState(() => (isFirebaseConfigured ? null : normalizeDataPoints(loadDemoData())));
  const [agentDaySnapshot, setAgentDaySnapshot] = useState(null);
  const [snapshotSyncIssue, setSnapshotSyncIssue] = useState("");
  const snapshotAutoSyncRef = useRef(null);
  if (!snapshotAutoSyncRef.current) snapshotAutoSyncRef.current = createSnapshotAutoSync({ onResult: (result) => setSnapshotSyncIssue(catkeeperStatusText(result.status)) });
  const queueSnapshotSync = (snapshot, reason) => snapshotAutoSyncRef.current.schedule({
    reason,
    delayMs: reason === "plan_updated" ? 2500 : 1000,
    buildSnapshot: (syncReason) => ({ ...snapshot, generatedAt: new Date().toISOString(), source: { ...snapshot.source, reason: syncReason } }),
  });

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setLoading(true);
        await ensureUserSeed(currentUser.uid, currentUser);
      } else {
        setData(null);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) return undefined;
    setLoading(true);
    return subscribeUserData(user.uid, (nextData) => {
      setData(normalizeDataPoints(nextData));
      setLoading(false);
    });
  }, [user]);

  const actions = useMemo(() => {
    if (isFirebaseConfigured) {
      return {
        saveCategory: (category) => saveCategory(user.uid, category),
        deleteCategory: (categoryId) => deleteCategory(user.uid, categoryId),
        saveProduct: (product) => saveProduct(user.uid, product),
        deleteProduct: (productId) => deleteProduct(user.uid, productId),
        saveDevelopmentPlan: (plan) => saveDevelopmentPlan(user.uid, plan),
        deleteDevelopmentPlan: (planId) => deleteDevelopmentPlan(user.uid, planId),
        completeDevelopmentPlan: (plan) => {
          if (plan.kind !== "bug" && hasCompletedDevelopmentToday(data.developmentPlans, plan.id)) {
            throw new Error("今天已经完成过一条开发愿望啦。剩下的先放清单里，明天再开工。");
          }
          return completeDevelopmentPlan(user.uid, plan, data.profile.points || 0);
        },
        redeemProduct: (product) => redeemProduct(user.uid, product, data.profile.points || 0),
        saveEntertainmentLog: (log) => saveEntertainmentLog(user.uid, log),
        redeemEntertainmentExtension: (extension) => redeemEntertainmentExtension(user.uid, extension, data.profile.points || 0),
        createSettlement: (settlement) => createSettlement(user.uid, settlement, data.profile.points || 0),
        saveReviewWorkbenchSettlement: (settlement, draft) => saveReviewWorkbenchSettlement(user.uid, settlement, draft),
        saveReviewDraft: (draft) => saveReviewDraft(user.uid, draft),
        reviseSettlement: (settlement, previousSettlement) => reviseSettlement(user.uid, settlement, previousSettlement, data.profile.points || 0),
        deleteLatestSettlement: (settlement, fallbackProfile) => deleteLatestSettlement(user.uid, settlement, fallbackProfile, data.profile.points || 0),
        rollbackSettlementsTo: (settlementsToDelete, targetSettlement) => rollbackSettlementsTo(user.uid, settlementsToDelete, targetSettlement, data.profile.points || 0),
        deleteLatestRedemption: (redemption, product) => deleteLatestRedemption(user.uid, redemption, product, data.profile.points || 0),
        saveMathProgress: (record) => saveMathProgressRecord(user.uid, record),
        saveProfessionalProgress: (record) => saveProfessionalProgressRecord(user.uid, record),
        saveProfileSettings: (settings) => saveProfileSettings(user.uid, settings),
        completeScheduleSegmentGoal: (goalEntry) => completeScheduleSegmentGoal(user.uid, goalEntry, goalEntry.rewardPointsAdded, data.profile.points || 0),
        saveProjectRewardApplication: (application) => saveProjectRewardApplication(user.uid, application, data.profile.points || 0),
        saveDiaryEntry: (entry) => saveDiaryEntry(user.uid, entry),
        syncDiaryFromSettlement: (entry, strategy) => syncDiaryFromSettlement(user.uid, entry, strategy),
        syncReadingFromSettlement: (reading) => syncReadingFromSettlement(user.uid, reading),
        saveBookEntry: (book) => saveBookEntry(user.uid, book),
      };
    }

    const updateDemo = (updater) => {
      setData((current) => {
        const next = updater(structuredClone(current));
        next.profile = { ...next.profile, points: roundPoints(next.profile?.points) };
        saveDemoData(next);
        return next;
      });
    };

    return {
      saveCategory: async (category) =>
        updateDemo((current) => {
          if (category.id) {
            current.categories = current.categories.map((item) => (item.id === category.id ? { ...item, ...category } : item));
          } else {
            current.categories.push({ ...category, id: crypto.randomUUID() });
          }
          return current;
        }),
      deleteCategory: async (categoryId) =>
        updateDemo((current) => {
          current.categories = current.categories.filter((item) => item.id !== categoryId);
          current.products = current.products.map((item) => (item.categoryId === categoryId ? { ...item, categoryId: "" } : item));
          return current;
        }),
      saveProduct: async (product) =>
        updateDemo((current) => {
          const payload = { ...product, price: Number(product.price) || 0, repeatable: product.repeatable !== false };
          if (product.id) {
            current.products = current.products.map((item) => (item.id === product.id ? { ...item, ...payload } : item));
          } else {
            current.products.push({ ...payload, id: crypto.randomUUID() });
          }
          return current;
        }),
      deleteProduct: async (productId) =>
        updateDemo((current) => {
          current.products = current.products.filter((item) => item.id !== productId);
          return current;
        }),
      saveDevelopmentPlan: async (plan) =>
        updateDemo((current) => {
          current.developmentPlans = current.developmentPlans || [];
          const payload = { ...plan, estimatedMinutes: Number(plan.estimatedMinutes || 15), updatedAt: new Date().toISOString() };
          if (plan.id) {
            current.developmentPlans = current.developmentPlans.map((item) => (item.id === plan.id ? { ...item, ...payload } : item));
          } else {
            current.developmentPlans.unshift({ ...payload, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
          }
          return current;
        }),
      deleteDevelopmentPlan: async (planId) =>
        updateDemo((current) => {
          current.developmentPlans = (current.developmentPlans || []).filter((item) => item.id !== planId);
          return current;
        }),
      completeDevelopmentPlan: async (plan) =>
        updateDemo((current) => {
          if (plan.kind !== "bug" && hasCompletedDevelopmentToday(current.developmentPlans, plan.id)) {
            throw new Error("今天已经完成过一条开发愿望啦。剩下的先放清单里，明天再开工。");
          }
          current.profile.updatedAt = new Date().toISOString();
          const donePlan = { ...plan, status: "done", pointsSpent: 0, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          if (plan.id) {
            current.developmentPlans = (current.developmentPlans || []).map((item) => (item.id === plan.id ? { ...item, ...donePlan } : item));
          } else {
            current.developmentPlans = [{ ...donePlan, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...(current.developmentPlans || [])];
          }
          return current;
        }),
      redeemProduct: async (product) =>
        updateDemo((current) => {
          const price = Number(product.price) || 0;
          if (current.profile.points < price) throw new Error(`还差 ${price - current.profile.points} 分。小椰帮你把目标守住。`);
          current.profile.points -= price;
          if (product.repeatable === false) {
            current.products = current.products.map((item) => (item.id === product.id ? { ...item, status: "redeemed" } : item));
          }
          current.redemptions.unshift({
            id: crypto.randomUUID(),
            productId: product.id,
            productName: product.name,
            categoryId: product.categoryId,
            price,
            remainingPoints: current.profile.points,
            note: product.note || "",
            createdAt: new Date().toISOString(),
          });
          return current;
        }),
      saveEntertainmentLog: async (log) =>
        updateDemo((current) => {
          current.entertainmentLogs = current.entertainmentLogs || [];
          current.entertainmentLogs.unshift({
            ...log,
            id: crypto.randomUUID(),
            minutes: Math.max(0, Number(log.minutes || 0)),
            createdAt: new Date().toISOString(),
          });
          return current;
        }),
      redeemEntertainmentExtension: async (extension) =>
        updateDemo((current) => {
          const pointsSpent = Number(extension.pointsSpent || 0);
          if ((current.profile.points || 0) < pointsSpent) throw new Error(`还差 ${pointsSpent - (current.profile.points || 0)} 分，先把加时放一放。`);
          const extensionId = crypto.randomUUID();
          current.profile.points = Math.max(0, (current.profile.points || 0) - pointsSpent);
          current.profile.updatedAt = new Date().toISOString();
          current.entertainmentExtensions = current.entertainmentExtensions || [];
          current.entertainmentExtensions.unshift({
            ...extension,
            id: extensionId,
            createdAt: new Date().toISOString(),
          });
          current.redemptions.unshift({
            id: crypto.randomUUID(),
            type: "entertainment_extension",
            extensionId,
            productName: `当日娱乐加时 +${Number(extension.minutes || 0)}min`,
            categoryId: "entertainment_extension",
            price: pointsSpent,
            remainingPoints: current.profile.points,
            minutes: Number(extension.minutes || 0),
            date: extension.date,
            note: extension.reason || "",
            createdAt: new Date().toISOString(),
          });
          return current;
        }),
      createSettlement: async (settlement) =>
        updateDemo((current) => {
          current.profile.points += Number(settlement.pointsAdded);
          current.profile.todayBalanceMinutes = Number(settlement.generatedMinutes);
          current.profile.nextDayBaseEntertainmentLimit = DAILY_FREE_ENTERTAINMENT_LIMIT_MIN;
          current.profile.nextDayEntertainmentLimitReason = settlement.nextDayEntertainmentLimitReason || "";
          current.profile.nextDayEntertainmentSourceDayType = settlement.nextDayEntertainmentSourceDayType || "";
          if (settlement.health?.maskStatus === "已敷" && settlement.reviewDate) {
            current.profile.lastMaskDate = settlement.reviewDate;
          }
          current.profile.maskCycle = {
            lastMaskDateAfterReview: settlement.lastMaskDateAfterReview || settlement.lastMaskDateBeforeReview || "",
            shouldScheduleMaskTomorrow: settlement.shouldScheduleMaskTomorrow === true,
            tomorrowDate: settlement.maskTomorrowDate || "",
            status: settlement.maskCycleStatus || "",
            message: settlement.maskCycleMessage || "",
            nextSuggestedDate: settlement.nextMaskSuggestedDate || "",
            updatedFromReviewDate: settlement.reviewDate || "",
          };
          current.profile.updatedAt = new Date().toISOString();
          current.settlements.unshift({ ...settlement, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
          return current;
        }),
      saveReviewWorkbenchSettlement: async (settlement, draft) => updateDemo((current) => {
        const index = current.settlements.findIndex((item) => item.reviewDate === settlement.reviewDate);
        const previous = index >= 0 ? current.settlements[index] : null;
        const pointDelta = Number(settlement.pointsAdded || 0) - Number(previous?.pointsAdded || 0);
        current.profile.points += pointDelta;
        current.profile.todayBalanceMinutes = Number(settlement.generatedMinutes || 0);
        current.profile.updatedAt = new Date().toISOString();
        const saved = {
          ...(previous || {}),
          ...settlement,
          id: previous?.id || settlement.reviewDate,
          reviewSchemaVersion: 2,
          reviewDraftDate: settlement.reviewDate,
          settlementRevision: Number(previous?.settlementRevision || 0) + (previous ? 1 : 0),
          createdAt: previous?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (index >= 0) current.settlements[index] = saved;
        else current.settlements.unshift(saved);
        current.dailyReviewDrafts ||= [];
        const draftIndex = current.dailyReviewDrafts.findIndex((item) => item.date === draft.date);
        const savedDraft = { ...draft, id: draft.date, status: "submitted", linkedSettlementId: saved.id, updatedAt: new Date().toISOString() };
        if (draftIndex >= 0) current.dailyReviewDrafts[draftIndex] = savedDraft;
        else current.dailyReviewDrafts.push(savedDraft);
        return current;
      }),
      saveReviewDraft: async (draft) => updateDemo((current) => {
        current.dailyReviewDrafts ||= [];
        const index = current.dailyReviewDrafts.findIndex((item) => item.date === draft.date);
        const saved = { ...draft, id: draft.date, updatedAt: new Date().toISOString() };
        if (index >= 0) current.dailyReviewDrafts[index] = saved;
        else current.dailyReviewDrafts.push(saved);
        return current;
      }),
      reviseSettlement: async (settlement, previousSettlement) =>
        updateDemo((current) => {
          const index = current.settlements.findIndex((item) => item.id === previousSettlement?.id);
          if (index < 0) throw new Error("找不到需要修订的结算记录。");
          const previous = current.settlements[index];
          current.profile.points += Number(settlement.pointsAdded || 0) - Number(previous.pointsAdded || 0);
          current.settlements[index] = {
            ...previous,
            ...settlement,
            settlementRevision: Number(previous.settlementRevision || 0) + 1,
            reconciliationHistory: [...(previous.reconciliationHistory || []), { beforePointsAdded: Number(previous.pointsAdded || 0), afterPointsAdded: Number(settlement.pointsAdded || 0), delta: Number(settlement.pointsAdded || 0) - Number(previous.pointsAdded || 0), reason: "manual_review_revision", at: new Date().toISOString() }],
            updatedAt: new Date().toISOString(),
          };
          return current;
        }),
      deleteLatestSettlement: async (settlement, fallbackProfile) =>
        updateDemo((current) => {
          current.settlements = current.settlements.filter((item) => item.id !== settlement.id);
          current.profile.points = Math.max(0, (current.profile.points || 0) - Number(settlement.pointsAdded || 0));
          current.profile.todayBalanceMinutes = Number(fallbackProfile.todayBalanceMinutes || 0);
          current.profile.nextDayBaseEntertainmentLimit = DAILY_FREE_ENTERTAINMENT_LIMIT_MIN;
          current.profile.nextDayEntertainmentLimitReason = fallbackProfile.nextDayEntertainmentLimitReason || "";
          current.profile.nextDayEntertainmentSourceDayType = fallbackProfile.nextDayEntertainmentSourceDayType || "normal_progress_day";
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      rollbackSettlementsTo: async (settlementsToDelete, targetSettlement) =>
        updateDemo((current) => {
          const deleteIds = new Set(settlementsToDelete.map((item) => item.id));
          const pointsToRemove = settlementsToDelete.reduce((sum, item) => sum + Number(item.pointsAdded || 0), 0);
          current.settlements = current.settlements.filter((item) => !deleteIds.has(item.id));
          current.profile.points = Math.max(0, (current.profile.points || 0) - pointsToRemove);
          current.profile.todayBalanceMinutes = Number(targetSettlement.generatedMinutes || 0);
          current.profile.nextDayBaseEntertainmentLimit = DAILY_FREE_ENTERTAINMENT_LIMIT_MIN;
          current.profile.nextDayEntertainmentLimitReason = targetSettlement.nextDayEntertainmentLimitReason || "";
          current.profile.nextDayEntertainmentSourceDayType = targetSettlement.nextDayEntertainmentSourceDayType || "normal_progress_day";
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      deleteLatestRedemption: async (redemption, product) =>
        updateDemo((current) => {
          current.redemptions = current.redemptions.filter((item) => item.id !== redemption.id);
          current.profile.points = (current.profile.points || 0) + Number(redemption.price || 0);
          if (redemption.type === "entertainment_extension" && redemption.extensionId) {
            current.entertainmentExtensions = (current.entertainmentExtensions || []).filter((item) => item.id !== redemption.extensionId);
          }
          if (product?.status === "redeemed") {
            current.products = current.products.map((item) => (item.id === product.id ? { ...item, status: "wishlist" } : item));
          }
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      saveProfileSettings: async (settings) =>
        updateDemo((current) => {
          current.profile = { ...current.profile, ...settings };
          if ("points" in settings) current.profile.points = Number(settings.points) || 0;
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      saveProjectRewardApplication: async (application) =>
        updateDemo((current) => {
          current.projectRewardApplications = current.projectRewardApplications || [];
          const existing = application.id ? current.projectRewardApplications.find((item) => item.id === application.id) : null;
          const finalPoints = Number(application.finalPoints || 0);
          const pointDelta = finalPoints - Number(existing?.finalPoints || 0);
          const payload = {
            ...application,
            finalPoints,
            requestedPoints: Number(application.requestedPoints || 0),
            status: finalPoints > 0 ? "approved" : "draft",
            updatedAt: new Date().toISOString(),
          };
          if (application.id) {
            current.projectRewardApplications = current.projectRewardApplications.map((item) => (item.id === application.id ? { ...item, ...payload } : item));
          } else {
            current.projectRewardApplications.unshift({ ...payload, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
          }
          if (pointDelta) {
            current.profile.points = Number(current.profile.points || 0) + pointDelta;
            current.redemptions.unshift({
              id: crypto.randomUUID(),
              type: "project_reward",
              productName: `结项奖励：${payload.eventName || "未命名事件"}`,
              categoryId: "project_reward",
              price: -pointDelta,
              pointsAdded: pointDelta,
              remainingPoints: current.profile.points,
              note: payload.note || "",
              createdAt: new Date().toISOString(),
            });
          }
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      saveDiaryEntry: async (entry) =>
        updateDemo((current) => {
          current.diaryEntries = current.diaryEntries || [];
          const payload = { ...entry, id: entry.date, manuallyEdited: true, source: entry.source || "manual", updatedAt: new Date().toISOString() };
          const exists = current.diaryEntries.some((item) => item.date === entry.date);
          current.diaryEntries = exists
            ? current.diaryEntries.map((item) => (item.date === entry.date ? { ...item, ...payload } : item))
            : [{ ...payload, createdAt: new Date().toISOString() }, ...current.diaryEntries];
          return current;
        }),
      syncDiaryFromSettlement: async (entry, strategy = "overwrite") =>
        updateDemo((current) => {
          current.diaryEntries = current.diaryEntries || [];
          const existing = current.diaryEntries.find((item) => item.date === entry.date);
          if (existing && (existing.manuallyEdited || existing.source === "manual") && strategy === "cancel") {
            throw new Error("今天的日记已经手动编辑过，本次未覆盖。");
          }
          const tags = normalizeDiaryTags(entry.normalizedTags || entry.rawTags || []);
          const mergedTags = normalizeDiaryTags([...(existing?.normalizedTags || []), ...tags]);
          const payload = strategy === "tags"
            ? {
                ...existing,
                date: entry.date,
                rawTags: mergedTags,
                normalizedTags: mergedTags,
                tagGroups: existing?.tagGroups || entry.tagGroups || groupDiaryTags(mergedTags),
                source: "daily-settlement",
                sourceReviewDate: entry.sourceReviewDate || entry.date,
                lastSyncedFromSettlementAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : {
                ...existing,
                ...entry,
                id: entry.date,
                source: "daily-settlement",
                manuallyEdited: false,
                lastSyncedFromSettlementAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
          current.diaryEntries = existing
            ? current.diaryEntries.map((item) => (item.date === entry.date ? payload : item))
            : [{ ...payload, createdAt: new Date().toISOString() }, ...current.diaryEntries];
          return current;
        }),
      syncReadingFromSettlement: async (reading) =>
        updateDemo((current) => {
          current.books = current.books || [];
          current.readingSessions = current.readingSessions || [];
          const date = reading.date || reading.sourceReviewDate || "";
          const title = cleanBookTitle(reading.bookTitle || reading.readingBookTitle || "");
          const minutes = Number(reading.minutes ?? reading.readingMinutes ?? 0);
          if (!date || !title || minutes <= 0) return current;
          const normalizedTitle = normalizeBookTitle(title);
          const bookId = reading.bookId || readingBookId(title);
          const sessionId = readingSessionId(date, title);
          const existingBook = current.books.find((book) => book.id === bookId);
          const existingSession = current.readingSessions.find((session) => session.id === sessionId);
          const previousMinutes = Number(existingSession?.minutes || 0);
          const minutesDiff = minutes - previousMinutes;
          const sessionPayload = {
            ...(existingSession || {}),
            id: sessionId,
            date,
            source: "daily-review",
            sourceReviewDate: date,
            bookId,
            bookTitle: existingBook?.title || title,
            normalizedBookTitle: normalizedTitle,
            minutes,
            feeling: reading.feeling || reading.readingFeeling || "",
            updatedAt: new Date().toISOString(),
          };
          current.readingSessions = existingSession
            ? current.readingSessions.map((session) => (session.id === sessionId ? sessionPayload : session))
            : [{ ...sessionPayload, createdAt: new Date().toISOString() }, ...current.readingSessions];
          const bookPayload = existingBook
            ? {
                ...existingBook,
                totalMinutes: Math.max(0, Number(existingBook.totalMinutes || 0) + minutesDiff),
                sessionCount: Math.max(0, Number(existingBook.sessionCount || 0) + (existingSession ? 0 : 1)),
                firstReadDate: existingBook.firstReadDate && existingBook.firstReadDate < date ? existingBook.firstReadDate : date,
                lastReadDate: existingBook.lastReadDate && existingBook.lastReadDate > date ? existingBook.lastReadDate : date,
                recentFeeling: reading.feeling || reading.readingFeeling || existingBook.recentFeeling || "",
                updatedAt: new Date().toISOString(),
              }
            : {
                id: bookId,
                title,
                normalizedTitle,
                status: "reading",
                language: /[A-Za-z]/.test(title) && !/[一-龥]/.test(title) ? "en" : "zh",
                type: "other",
                totalMinutes: minutes,
                sessionCount: 1,
                firstReadDate: date,
                lastReadDate: date,
                recentFeeling: reading.feeling || reading.readingFeeling || "",
                favorite: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
          current.books = existingBook
            ? current.books.map((book) => (book.id === bookId ? bookPayload : book))
            : [bookPayload, ...current.books];
          return current;
        }),
      saveBookEntry: async (book) =>
        updateDemo((current) => {
          current.books = current.books || [];
          const title = cleanBookTitle(book.title || "");
          const id = book.id || readingBookId(title);
          const payload = { ...book, id, title, normalizedTitle: normalizeBookTitle(title), updatedAt: new Date().toISOString() };
          current.books = current.books.some((item) => item.id === id)
            ? current.books.map((item) => (item.id === id ? { ...item, ...payload } : item))
            : [{ ...payload, createdAt: new Date().toISOString() }, ...current.books];
          return current;
        }),
      completeScheduleSegmentGoal: async (goalEntry) =>
        updateDemo((current) => {
          current.profile.points = Number(current.profile.points || 0) + Number(goalEntry.rewardPointsAdded || 1);
          current.profile.scheduleSegmentGoals = {
            ...(current.profile.scheduleSegmentGoals || {}),
            [goalEntry.date]: goalEntry,
          };
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      saveMathProgress: async (record) =>
        updateDemo((current) => {
          current.mathProgress = current.mathProgress || [];
          const payload = { ...record, id: record.itemId, updatedAt: new Date().toISOString() };
          const exists = current.mathProgress.some((item) => item.itemId === record.itemId);
          current.mathProgress = exists
            ? current.mathProgress.map((item) => (item.itemId === record.itemId ? { ...item, ...payload } : item))
            : [payload, ...current.mathProgress];
          return current;
        }),
      saveProfessionalProgress: async (record) =>
        updateDemo((current) => {
          current.professionalProgress = current.professionalProgress || [];
          const payload = { ...record, id: record.itemId, updatedAt: new Date().toISOString() };
          const exists = current.professionalProgress.some((item) => item.itemId === record.itemId);
          current.professionalProgress = exists
            ? current.professionalProgress.map((item) => (item.itemId === record.itemId ? { ...item, ...payload } : item))
            : [payload, ...current.professionalProgress];
          return current;
        }),
    };
  }, [data, user]);

  async function handleGoogleLogin() {
    await runAction(() => signInWithPopup(auth, googleProvider), "欢迎来到小椰奖励商场，云端账本已经打开。");
  }

  async function runAction(action, successMessage) {
    try {
      await action();
      setToast(successMessage);
    } catch (error) {
      setToast(error.message || "操作没有完成，小椰帮你先稳住。");
    }
  }

  async function handleSettlementSubmit(settlement, draft, diaryOptions) {
    try {
      await actions.saveReviewWorkbenchSettlement(settlement, draft);
      if (agentDaySnapshot?.date === settlement.reviewDate) {
        queueSnapshotSync({
          ...agentDaySnapshot,
          generatedAt: new Date().toISOString(),
          review: {
            status: "submitted",
            submittedAt: new Date().toISOString(),
          },
        }, "review_submitted");
      }
      let diaryMessage = "未检测到日记，本次未同步日记。";
      if (diaryOptions?.sync && diaryOptions.diary?.content?.trim()) {
        if (diaryOptions.strategy === "cancel") {
          diaryMessage = "已按你的选择跳过日记同步。";
        } else {
          try {
            await actions.syncDiaryFromSettlement(diaryOptions.diary, diaryOptions.strategy || "overwrite");
            diaryMessage = diaryOptions.strategy === "tags" ? "日记标签已补充。" : "日记已同步到日记档案。";
          } catch (error) {
            diaryMessage = `日记同步失败：${error.message || "请重试"}`;
          }
        }
      }
      let readingMessage = "未检测到阅读记录。";
      if (settlement.readingMinutes > 0 && settlement.readingBookTitle) {
        try {
          await actions.syncReadingFromSettlement(buildReadingEntryFromSettlement(settlement));
          readingMessage = "阅读已同步到小椰图书馆。";
        } catch (error) {
          readingMessage = `阅读同步失败：${error.message || "请重试"}`;
        }
      }
      setToast(`${settlementResultText(settlement, data.profile.points || 0)} ${diaryMessage} ${readingMessage}`);
    } catch (error) {
      setToast(error.message || "结算没有保存成功，小椰先帮你稳住。");
      throw error;
    }
  }

  async function handleReviewDraftSave(draft) {
    await actions.saveReviewDraft(draft);
  }

  async function handleResyncDiaryFromSettlement(settlement) {
    const date = settlement.reviewDate || formatDateOnly(settlement.createdAt);
    const parsedDiary = parseDiaryFromMarkdown(settlement.rawReview || "", date);
    if (!parsedDiary?.content) {
      setToast("这条结算记录里没有可同步的日记内容。");
      return;
    }
    const existing = (data.diaryEntries || []).find((entry) => entry.date === date);
    let strategy = "overwrite";
    if (existing && (existing.manuallyEdited || existing.source === "manual")) {
      const choice = window.prompt("今天的日记已经被手动编辑过。输入 1 覆盖更新，2 只补充标签，3 取消。", "2");
      if (choice === "3" || choice === null) {
        setToast("已取消日记同步。");
        return;
      }
      strategy = choice === "1" ? "overwrite" : "tags";
    }
    try {
      await actions.syncDiaryFromSettlement(buildDiaryEntryFromDraft(parsedDiary, date, settlement), strategy);
      setToast(strategy === "tags" ? "日记标签已重新同步。" : "日记已重新同步。");
    } catch (error) {
      setToast(error.message || "日记重新同步失败，请重试。");
    }
  }

  if (loading || (user && !data)) {
    return (
      <main className="loading-shell">
        <div className="coin-orbit">
          <img src="/yeye/yeye-main-clean.png" alt="小椰" />
        </div>
        <p>小椰正在整理奖励银行...</p>
      </main>
    );
  }

  if (isFirebaseConfigured && !user) {
    return <LoginScreen onLogin={handleGoogleLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/yeye/yeye-main-clean.png" alt="" />
          <div>
            <strong>小椰奖励商场</strong>
            <span>Claire 的考研奖励银行</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button className={activeTab === tab.id ? "nav-item active" : "nav-item"} key={tab.id} onClick={() => setActiveTab(tab.id)}>
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="account-card">
          {user.photoURL ? <img src={user.photoURL} alt="" /> : <div className="avatar-fallback">椰</div>}
          <div>
            <strong>{data.profile.displayName || user.displayName || "Claire"}</strong>
            <span>{user.email || "本地演示模式"}</span>
          </div>
        </div>

        {isFirebaseConfigured ? (
          <button className="ghost-button" onClick={() => signOut(auth)}>
            <LogOut size={17} />
            退出登录
          </button>
        ) : (
          <div className="config-note">当前是本地演示模式。填写 `.env` 后启用 Google 登录和 Firestore 多设备同步。</div>
        )}
      </aside>

      <main className="main-panel">
        <TopBar profile={data.profile} isDemo={!isFirebaseConfigured} />
        {activeTab === "dashboard" && (
          <Dashboard
            data={data}
            setActiveTab={setActiveTab}
            onCompleteScheduleSegmentGoal={(goalEntry) => runAction(() => actions.completeScheduleSegmentGoal(goalEntry), `学习目标打卡完成，奖励银行 +${formatSegmentReward(goalEntry.rewardPointsAdded || 1)} 分。`)}
            onSaveProjectReward={(application) => runAction(() => actions.saveProjectRewardApplication(application), "结项奖励申请已保存。")}
          />
        )}
        {activeTab === "settlement" && (
          <DailyReviewWorkbench
            data={data}
            profile={data.profile}
            taxonomy={normalizeClassificationTaxonomy(data.profile.classificationTaxonomy || [])}
            settlements={data.settlements}
            dailyReviewDrafts={data.dailyReviewDrafts || []}
            onSaveMathProgress={(records) =>
              runAction(() => Promise.all(records.map((record) => actions.saveMathProgress(record))), `已同步 ${records.length} 个数学进度打卡。`)
            }
            onSaveProfessionalProgress={(records) =>
              runAction(() => Promise.all(records.map((record) => actions.saveProfessionalProgress(record))), `已同步 ${records.length} 个专业课进度打卡。`)
            }
            diaryEntries={data.diaryEntries || []}
            onSubmit={handleSettlementSubmit}
            onSaveDraft={handleReviewDraftSave}
            onSaveProfile={(settings) => actions.saveProfileSettings(settings)}
          />
        )}
        {activeTab === "schedule" && (
          <SchedulePageBoundary diagnosticContext={buildPlannerDiagnosticContext(data)}>
            <ScheduleAssistant
              data={data}
              onSaveProfile={(settings) => actions.saveProfileSettings(settings)}
              onAgentSnapshot={setAgentDaySnapshot}
              onSnapshotPersisted={queueSnapshotSync}
              snapshotSyncIssue={snapshotSyncIssue}
              onOpenSettlement={() => setActiveTab("settlement")}
            />
          </SchedulePageBoundary>
        )}
        {activeTab === "mall" && (
          <Mall
            data={data}
            onRedeem={(product) => runAction(() => actions.redeemProduct(product), `兑换成功。你用 ${product.price} 分兑换了「${product.name}」，这是阶段性战利品。`)}
            onSaveProduct={(product) => runAction(() => actions.saveProduct(product), "商品已保存，奖励货架更新好了。")}
            onDeleteProduct={(productId) => runAction(() => actions.deleteProduct(productId), "商品已删除。")}
            onReorderProducts={(products) => runAction(() => Promise.all(products.map((product) => actions.saveProduct(product))), "货架顺序已更新。")}
            onSaveCategory={(category) => runAction(() => actions.saveCategory(category), "分类已保存，货架颜色也整理好了。")}
            onDeleteCategory={(categoryId) => runAction(() => actions.deleteCategory(categoryId), "分类已删除。")}
            onSaveDevelopmentPlan={(plan) => runAction(() => actions.saveDevelopmentPlan(plan), "开发愿望已记入装修计划。")}
            onDeleteDevelopmentPlan={(planId) => runAction(() => actions.deleteDevelopmentPlan(planId), "开发愿望已删除。")}
            onCompleteDevelopmentPlan={(plan) => runAction(() => actions.completeDevelopmentPlan(plan), "开发完成，已写入开发日志。")}
          />
        )}
        {activeTab === "estimator" && (
          <Estimator
            data={data}
            onSaveDashboardTarget={(productIds) =>
              runAction(() => actions.saveProfileSettings({ dashboardTargetProductIds: productIds, dashboardTargetUpdatedAt: new Date().toISOString() }), "首页目标已更新。")
            }
          />
        )}
        {activeTab === "weekly" && <WeeklySummary data={data} />}
        {activeTab === "english" && <EnglishTrackingPage settlements={data.settlements} />}
        {activeTab === "diary" && (
          <DiaryArchivePage
            entries={data.diaryEntries || []}
            onSave={(entry) => runAction(() => actions.saveDiaryEntry(entry), "日记已保存。")}
          />
        )}
        {activeTab === "library" && (
          <LibraryHomePage
            books={data.books || []}
            sessions={data.readingSessions || []}
            diaryEntries={data.diaryEntries || []}
            onSaveBook={(book) => runAction(() => actions.saveBookEntry(book), "书籍信息已保存。")}
          />
        )}
        {activeTab === "mathProgress" && (
          <MathProgressPage
            records={data.mathProgress || []}
            onSave={(record) => runAction(() => actions.saveMathProgress(record), "数学进度已保存。")}
          />
        )}
        {activeTab === "professionalProgress" && (
          <ProfessionalProgressPage
            records={data.professionalProgress || []}
            onSave={(record) => runAction(() => actions.saveProfessionalProgress(record), "专业课进度已保存。")}
          />
        )}
        {false && activeTab === "categories" && (
          <CategoryManager
            categories={data.categories}
            onSave={(category) => runAction(() => actions.saveCategory(category), "分类已保存，货架颜色也整理好了。")}
            onDelete={(categoryId) => runAction(() => actions.deleteCategory(categoryId), "分类已删除。")}
          />
        )}
        {activeTab === "records" && (
          <Records
            data={data}
            onSaveProjectReward={(application) => runAction(() => actions.saveProjectRewardApplication(application), "结项奖励申请已保存。")}
            onDeleteSettlement={(settlement, fallbackProfile) =>
              runAction(() => actions.deleteLatestSettlement(settlement, fallbackProfile), "已撤销最近一次结算，银行积分和额度已回退。")
            }
            onRollbackSettlements={(settlementsToDelete, targetSettlement) =>
              runAction(() => actions.rollbackSettlementsTo(settlementsToDelete, targetSettlement), "已回退到选中的结算日，之后的结算记录已移除。")
            }
            onDeleteRedemption={(redemption, product) =>
              runAction(() => actions.deleteLatestRedemption(redemption, product), "已撤销最近一次兑换，积分已经加回奖励银行。")
            }
            onSyncDiary={handleResyncDiaryFromSettlement}
          />
        )}
        {activeTab === "settings" && (
          <SettingsPage
            profile={data.profile}
            settlements={data.settlements}
            agentSnapshot={agentDaySnapshot}
            onOpenSchedule={() => setActiveTab("schedule")}
            onSave={(settings) => runAction(() => actions.saveProfileSettings(settings), "设置已保存，小椰会按新的边界帮你记账。")}
            userReady={Boolean(user)}
            onApplyTaxonomyMigration={(taxonomy) => actions.saveProfileSettings({ classificationTaxonomy: taxonomy })}
          />
        )}
      </main>

      {toast && (
        <button className="toast" onClick={() => setToast("")}>
          <Check size={18} />
          {toast}
        </button>
      )}
    </div>
  );
}

function settlementResultText(settlement, currentPoints) {
  const total = roundPoints(currentPoints + settlement.pointsAdded);
  const extras = [
    settlement.sleepAdjustmentPoints ? `睡眠 ${settlement.sleepAdjustmentPoints > 0 ? "+" : ""}${settlement.sleepAdjustmentPoints}` : "",
    settlement.exerciseBonusPoints ? `运动 +${settlement.exerciseBonusPoints}` : "",
    settlement.workPoints ? `工作 +${settlement.workPoints}` : "",
    settlement.dayTypeBonusPoints ? `日型 +${settlement.dayTypeBonusPoints}` : "",
    settlement.reviewTimelinessBonus ? `复盘归档 +${settlement.reviewTimelinessBonus}` : "",
    settlement.entertainmentScoreDelta ? `自由娱乐 ${settlement.entertainmentScoreDelta > 0 ? "+" : ""}${settlement.entertainmentScoreDelta}` : "",
  ].filter(Boolean);
  const bonusText = extras.length ? `，含${extras.join("、")}分` : "";
  return `结算完成：今日生成价值 ${settlement.generatedMinutes}min，转入 ${formatPoints(settlement.pointsAdded)} 分${bonusText}。自由娱乐 ${settlement.totalEntertainmentMinutes || 0}/${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min。当前银行 ${formatPoints(total)} 分。`;
}

function LoginScreen({ onLogin }) {
  return (
    <main className="login-screen">
      <section className="login-hero">
        <img src="/yeye/yeye-main-clean.png" alt="小椰" />
        <p className="eyebrow">Yeye Reward Mall</p>
        <h1>Claire 的小椰奖励商场</h1>
        <p className="login-copy">这里不是惩罚你的地方，而是把每天认真学习、运动和守住边界的努力存起来。</p>
        <button className="primary-button large" onClick={onLogin}>
          <Sparkles size={20} />
          使用 Google 登录
        </button>
      </section>
    </main>
  );
}

function TopBar({ profile, isDemo }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{isDemo ? "本地演示" : "云端同步"}</p>
        <h1>奖励银行账本</h1>
      </div>
      <div className="point-badge">
        <Coins size={22} />
        <span>{formatPoints(profile.points)}</span>
        <small>银行积分</small>
      </div>
    </header>
  );
}

const entertainmentTypeOptions = [
  ["game", "游戏"],
  ["singing", "唱歌"],
  ["guitar", "吉他"],
  ["drawing", "画画"],
  ["novel", "小说"],
  ["video", "视频"],
  ["scrolling", "刷手机"],
  ["other", "其他"],
];

const defaultEntertainmentReviewTags = [
  { id: "entertainment-wenyou", name: "文游", keywords: "文游" },
  { id: "entertainment-novel", name: "小说", keywords: "小说" },
  { id: "entertainment-game", name: "游戏", keywords: "游戏" },
  { id: "entertainment-video", name: "视频", keywords: "视频" },
  { id: "entertainment-short-video", name: "短视频", keywords: "短视频" },
];

const defaultMiscReviewTags = [
  { id: "misc-personal-system", name: "个人管理体系", keywords: "个人管理体系,个人管理系统,管理系统" },
  { id: "misc-party", name: "党团", keywords: "党团,党团事务" },
  { id: "misc-cleaning", name: "收拾", keywords: "收拾,整理" },
  { id: "misc-review", name: "复盘", keywords: "复盘" },
];

function mergeEntertainmentReviewTags(tags = []) {
  const custom = (tags || []).filter((tag) => !defaultEntertainmentReviewTags.some((item) => item.id === tag.id));
  return [...defaultEntertainmentReviewTags, ...custom];
}

function mergeMiscReviewTags(tags = []) {
  const custom = (tags || []).filter((tag) => !defaultMiscReviewTags.some((item) => item.id === tag.id));
  return [...defaultMiscReviewTags, ...custom];
}

function normalizeEntertainmentQuickPresets(value) {
  const source = Array.isArray(value) && value.length ? value : defaultEntertainmentQuickPresets;
  return source
    .map((item, index) => ({
      id: item.id || `quick-${index}`,
      type: item.type || "other",
      minutes: Math.max(1, Number(item.minutes || 10)),
      label: item.label || `${entertainmentTypeText[item.type] || "娱乐"} ${item.minutes || 10}min`,
    }))
    .slice(0, 8);
}

function quickPresetsToText(presets = []) {
  return normalizeEntertainmentQuickPresets(presets)
    .map((item) => `${item.type}:${item.minutes}:${item.label}`)
    .join("\n");
}

function parseEntertainmentQuickPresetText(text) {
  return String(text || "")
    .split("\n")
    .map((line, index) => {
      const [type = "other", minutes = "10", ...labelParts] = line.split(":").map((item) => item.trim());
      const value = Math.max(1, Number(minutes || 10));
      if (!type && !value) return null;
      return {
        id: `quick-${Date.now()}-${index}`,
        type: entertainmentTypeOptions.some((item) => item[0] === type) ? type : "other",
        minutes: value,
        label: labelParts.join(":") || `${entertainmentTypeText[type] || "娱乐"} ${value}min`,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function entertainmentSnapshot(data, date = todayIsoDate()) {
  const todaySettlement = (data.settlements || []).find((item) => item.reviewDate === date);
  const baseLimit = DAILY_FREE_ENTERTAINMENT_LIMIT_MIN;
  const baseReason = "每日固定自由娱乐额度90min，不随前一天日型变化。";
  const sourceDayType = "fixed_free_entertainment";
  const logs = (data.entertainmentLogs || []).filter((item) => item.date === date);
  const extensions = (data.entertainmentExtensions || []).filter((item) => item.date === date);
  const loggedUsed = logs.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const settlementUsed = todaySettlement
    ? Number(todaySettlement.totalEntertainmentMinutes ?? (Number(todaySettlement.beneficialMinutes || 0) + Number(todaySettlement.actualGameMinutesToday || 0)))
    : 0;
  const used = Math.max(loggedUsed, settlementUsed);
  const extensionMinutes = extensions.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const extensionPoints = extensions.reduce((sum, item) => sum + Number(item.pointsSpent || 0), 0);
  const totalLimit = baseLimit;
  return {
    date,
    baseLimit,
    baseReason,
    sourceDayType,
    used,
    loggedUsed,
    settlementUsed,
    usedSource: settlementUsed >= loggedUsed && settlementUsed > 0 ? "settlement" : "logs",
    extensionMinutes,
    extensionPoints,
    totalLimit,
    remainingBase: Math.max(0, baseLimit - used),
    remainingTotal: totalLimit - used,
    logs,
    extensions,
  };
}

function findEntertainmentLimitSource(settlements = [], date, previousDate) {
  const exactPrevious = settlements.find((item) => item.reviewDate === previousDate);
  if (exactPrevious) return exactPrevious;
  return settlements
    .filter((item) => item.reviewDate && item.reviewDate < date)
    .sort((a, b) => b.reviewDate.localeCompare(a.reviewDate))[0];
}

function resolveDashboardTarget(products, profile) {
  const points = Number(profile.points || 0);
  const savedIds = Array.isArray(profile.dashboardTargetProductIds) ? profile.dashboardTargetProductIds : [];
  const savedProducts = savedIds
    .map((id) => products.find((product) => product.id === id))
    .filter(Boolean);
  if (savedProducts.length) {
    const totalCost = savedProducts.reduce((sum, product) => sum + Number(product.price || 0), 0);
    return {
      source: "saved",
      name: savedProducts.length === 1 ? savedProducts[0].name : `${savedProducts[0].name} 等 ${savedProducts.length} 件`,
      need: Math.max(0, totalCost - points),
      totalCost,
    };
  }
  const nearest = products
    .map((product) => ({ product, need: Math.max(0, (product.price || 0) - points) }))
    .sort((a, b) => a.need - b.need || a.product.price - b.product.price)[0];
  return nearest
    ? { source: "auto", name: nearest.product.name, need: nearest.need, totalCost: nearest.product.price || 0 }
    : null;
}

function Dashboard({ data, setActiveTab, onCompleteScheduleSegmentGoal, onSaveProjectReward }) {
  const profile = data.profile;
  const recentSettlement = data.settlements[0];
  const entertainment = entertainmentSnapshot(data);
  const segmentGoalState = buildTodaySegmentGoalState(data);
  const [showProjectRewardForm, setShowProjectRewardForm] = useState(false);

  return (
    <section className="dashboard-home">
      <div className="dashboard-metrics">
        <StatCard icon={Coins} title="奖励银行" value={`${formatPoints(profile.points)} 分`} text="用来兑换商场里的阶段性战利品。" tone="coin" />
        <StatCard icon={Gamepad2} title="今日自由娱乐" value={`${entertainment.baseLimit} min`} text={entertainment.baseReason} tone="game" />
        <DashboardGoalStatCard profile={profile} />
      </div>

      <div className="dashboard-main">
        <div className="panel wide dashboard-quest-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Study Quest</p>
              <h2>小椰今日看板</h2>
            </div>
            <Wand2 size={22} />
          </div>
          <div className="quest-board">
            <SegmentGoalBoard state={segmentGoalState} onComplete={onCompleteScheduleSegmentGoal} />
            <div className="quest-board-side">
              <div className="quest-row">
                <div>
                  <strong>今日自由娱乐</strong>
                  <span>{entertainment.baseLimit}min。{entertainment.baseReason}</span>
                </div>
                <button className="primary-button" onClick={() => setActiveTab("settlement")}>
                  去结算 <ChevronRight size={18} />
                </button>
              </div>
              <div className="quest-row">
                <div>
                  <strong>今日主线</strong>
                  <span>学习进度点在左边，目标与激励图放在右侧。</span>
                </div>
                <button className="secondary-button" onClick={() => setActiveTab("mall")}>
                  去奖励商城 <ChevronRight size={18} />
                </button>
              </div>
              <div className="dashboard-action-row">
                <button className="secondary-button compact" type="button" onClick={() => setActiveTab("mall")}>兑换奖励</button>
                <button className="secondary-button compact" type="button" onClick={() => setShowProjectRewardForm(true)}>申请结项奖励</button>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={!profile.eventBookLink}
                  onClick={() => profile.eventBookLink && window.open(profile.eventBookLink, "_blank", "noopener,noreferrer")}
                >
                  查看事件簿
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-side-column">
          <div className="panel dashboard-recent-panel">
            <div className="panel-title">
              <h2>最近结算</h2>
              <History size={20} />
            </div>
            {recentSettlement ? (
              <div className="record-mini">
                <strong>+{formatPoints(recentSettlement.pointsAdded)} 分</strong>
                <span>{recentSettlement.dayTypeDisplayName || dayTypeLabels[recentSettlement.nextDayEntertainmentSourceDayType] || "已结算"} · 自由娱乐 {recentSettlement.totalEntertainmentMinutes || 0}/{DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min</span>
                <small>{formatDateTime(recentSettlement.createdAt)}</small>
              </div>
            ) : (
              <p className="empty-text">还没有结算记录。第一次复盘后，奖励银行就会亮起来。</p>
            )}
          </div>
        </div>
      </div>
      {showProjectRewardForm && (
        <ProjectRewardApplicationPanel
          profile={profile}
          onClose={() => setShowProjectRewardForm(false)}
          onSave={(application) => {
            onSaveProjectReward(application);
            setShowProjectRewardForm(false);
          }}
        />
      )}
    </section>
  );
}

function ProjectRewardApplicationPanel({ profile, application = null, onSave, onClose }) {
  const [form, setForm] = useState({
    id: application?.id || "",
    existingFinalPoints: Number(application?.finalPoints || 0),
    eventName: application?.eventName || "",
    eventBookLink: application?.eventBookLink || profile.eventBookLink || "",
    archived: application?.archived === true,
    result: application?.result || "",
    requestedPoints: application?.requestedPoints ?? 2,
    finalPoints: application?.finalPoints ?? "",
    note: application?.note || "",
  });

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSave({
      ...form,
      requestedPoints: Number(form.requestedPoints || 0),
      finalPoints: form.archived ? Number(form.finalPoints || 0) : 0,
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="panel project-reward-form" onSubmit={submit}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Project Reward</p>
            <h2>申请结项奖励</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><Trash2 size={17} /></button>
        </div>
        <p className="field-help">参考区间：小结项 +2，中结项 +4，大结项 +6，重大结项 +8。这里只记录申请，最终加分需要你确认后手动填写。</p>
        <TextField label="事件名称" value={form.eventName} required onChange={(value) => update("eventName", value)} />
        <TextField label="事件簿链接" value={form.eventBookLink} onChange={(value) => update("eventBookLink", value)} />
        <label className="field">
          <span>完成结果</span>
          <input value={form.result} onChange={(event) => update("result", event.target.value)} placeholder="已答辩 / 已提交 / 已发布 / 已落地 / 已完成" />
        </label>
        <NumberField label="申请加分" value={form.requestedPoints} onChange={(value) => update("requestedPoints", value)} />
        <label className="mini-check project-archive-check">
          <input type="checkbox" checked={form.archived} onChange={(event) => update("archived", event.target.checked)} />
          <span>已总结归档</span>
        </label>
        <label className="field">
          <span>最终加分</span>
          <input type="number" value={form.finalPoints} disabled={!form.archived} onChange={(event) => update("finalPoints", toNumber(event.target.value))} />
        </label>
        {!form.archived && <p className="field-help">勾选“已总结归档”后，最终加分才会生效。</p>}
        <label className="field">
          <span>备注</span>
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} />
        </label>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="submit"><Save size={18} />保存申请</button>
        </div>
      </form>
    </div>
  );
}

function StatCard({ icon: Icon, title, value, text, tone }) {
  return (
    <div className={`stat-card stat-card-${tone}`}>
      <div className={`stat-icon ${tone}`}><Icon size={24} /></div>
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{text}</p>
    </div>
  );
}

function DashboardGoalStatCard({ profile }) {
  const daysLeft = calculateDaysLeft(profile.dashboardGoalDate);
  const hasGoal = Boolean(profile.dashboardGoalTitle || profile.dashboardGoalMessage || profile.dashboardGoalImage);
  const countdownText = !profile.dashboardGoalDate
    ? "未设日期"
    : daysLeft === null
      ? "未设日期"
      : daysLeft <= 0
        ? "就是今天"
        : `还有 ${daysLeft} 天`;
  const subtitle = profile.dashboardGoalDate ? `目标日 · ${profile.dashboardGoalDate}` : "倒计时目标";
  const title = profile.dashboardGoalTitle || "写一个想靠近的目标";
  const message = profile.dashboardGoalMessage || "去设置里放一句想让自己抬头就能看到的话。";

  return (
    <div className="stat-card dashboard-countdown-card">
      <div className="dashboard-countdown-top">
        <div className="stat-icon time"><Target size={24} /></div>
        <div className="dashboard-countdown-meta">
          <span>{subtitle}</span>
          <b>{title}</b>
        </div>
      </div>
      <div className="dashboard-countdown-body">
        <div className="dashboard-countdown-copy">
          <strong>{profile.dashboardGoalDate ? countdownText : title}</strong>
          <p>{message}</p>
        </div>
        {profile.dashboardGoalImage ? (
          <div className="dashboard-countdown-media">
            <img src={profile.dashboardGoalImage} alt="激励图片" />
          </div>
        ) : (
          <div className="dashboard-countdown-media empty">在设置里放一张激励图</div>
        )}
      </div>
      {!hasGoal && <small className="dashboard-countdown-hint">目标、日期和图片都在设置页里改。</small>}
    </div>
  );
}

const segmentOverdueMessages = [
  "这一段已经过点啦，奖励窗口关闭。小椰把爪子从积分按钮上挪开了。",
  "时间门关上了，这一格不能补领积分。下一段我们重新抢回来。",
  "小猫看表：这段已过期，不补发小鱼干，但可以继续学习回血。",
  "这一段错过了就不补签啦。小椰灰灰地记下：下次早点点亮。",
  "奖励窗口结束。不是惩罚，是围栏：下一段还来得及。",
];

const segmentDoneMessages = [
  "好耶，这一段亮了。奖励银行加分，小椰原地跳一下。",
  "进度点拿下。今天的小猫监督员表示满意。",
  "这格完成得很漂亮，继续稳稳往前冒。",
  "已打卡。小椰把这一段贴上小星星了。",
  "不错，主线玩家回来了。奖励到账。",
];

function SegmentGoalBoard({ state, onComplete }) {
  const [catMessage, setCatMessage] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  if (!state.hasGoals) {
    return (
      <div className="segment-goal-board empty">
        <strong>今日学习目标</strong>
        <span>去“明日排程”生成一次排程后，这里会出现上午、下午、晚上三个学习进度点。</span>
      </div>
    );
  }

  async function completeSegment(segment) {
    if (pendingKey || segment.completed || segment.expired) return;
    setPendingKey(segment.key);
    const nextEntry = {
      ...state.entry,
      rewardPointsAdded: segment.rewardPoints,
      completed: {
        ...(state.entry.completed || {}),
        [segment.key]: {
          completedAt: new Date().toISOString(),
          targetMinutes: segment.targetMinutes,
          rewardPoints: segment.rewardPoints,
        },
      },
    };
    try {
      await onComplete(nextEntry);
      setCatMessage(`${pickMessage(segmentDoneMessages, `${state.date}-${segment.key}-done`)} +${formatSegmentReward(segment.rewardPoints)} 分`);
      window.setTimeout(() => setCatMessage(""), 5200);
    } finally {
      setPendingKey("");
    }
  }

  const completedCount = state.segments.filter((segment) => segment.completed).length;
  const completedScore = state.segments
    .filter((segment) => segment.completed)
    .reduce((sum, segment) => sum + Number(segment.rewardPoints || 0), 0);

  return (
    <div className="segment-goal-board">
      <div className="segment-head">
        <div>
          <strong>今日学习进度点</strong>
          <span>{state.date} · 完成 {completedCount}/3，限时奖励 +1 / +1.5 / +1.5</span>
        </div>
        <span className="segment-score">+{formatSegmentReward(completedScore)}</span>
      </div>
      <div className="segment-progress"><i style={{ width: `${(completedCount / 3) * 100}%` }} /></div>
      <div className="segment-list">
        {state.segments.map((segment) => (
          <div className={segment.completed ? "segment-item done" : segment.expired ? "segment-item overdue" : "segment-item"} key={segment.key}>
            <div>
              <strong>{segment.label} · {minutesLabel(segment.targetMinutes)}</strong>
              <span>{segment.title}前累计 · 截止 {segment.deadline} · 奖励 +{formatSegmentReward(segment.rewardPoints)}</span>
              {segment.expired && !segment.completed && <small>{segment.message}</small>}
              {segment.completed && <small>{segment.doneText} +{formatSegmentReward(segment.rewardPoints)} 分</small>}
            </div>
            <button className={segment.completed || segment.expired || pendingKey === segment.key ? "disabled-button compact" : "secondary-button compact"} type="button" disabled={segment.completed || segment.expired || Boolean(pendingKey)} onClick={() => completeSegment(segment)}>
              {segment.completed ? "已打卡" : segment.expired ? "已过期" : pendingKey === segment.key ? "记录中" : `打卡 +${formatSegmentReward(segment.rewardPoints)}`}
            </button>
          </div>
        ))}
      </div>
      {catMessage && (
        <div className="cat-celebration comfort">
          <img className="cat-face-img" src="/yeye/yeye-jump-clean.png" alt="" />
          <strong>{catMessage}</strong>
        </div>
      )}
    </div>
  );
}

function EntertainmentControlPanel({ data, snapshot, onSaveEntertainmentLog, onRedeemEntertainmentExtension, onSaveProfileSettings }) {
  const quickPresets = normalizeEntertainmentQuickPresets(data.profile.entertainmentQuickPresets);
  const [quickText, setQuickText] = useState(() => quickPresetsToText(quickPresets));
  const [logForm, setLogForm] = useState({ type: "game", minutes: 10, note: "" });
  const [catMessage, setCatMessage] = useState("");
  const [extensionForm, setExtensionForm] = useState({
    minutes: 10,
    reason: "",
    thesisOutput: "",
    checks: {
      math: false,
      english: false,
      noUnrecordedLoss: false,
      noSleepCompression: false,
      professionalOk: true,
    },
  });
  const cost = getExtensionCost(extensionForm.minutes) || 0;
  const enoughPoints = (data.profile.points || 0) >= cost;
  const thesisOk = extensionForm.thesisOutput.trim().length >= 2;
  const checksOk = Object.values(extensionForm.checks).every(Boolean);
  const canRedeem = enoughPoints && thesisOk && checksOk && cost > 0;

  function saveQuickLog(preset) {
    const minutes = Math.max(1, Number(preset.minutes || 0));
    const nextUsed = snapshot.used + minutes;
    onSaveEntertainmentLog({
      date: snapshot.date,
      type: preset.type || "other",
      minutes,
      note: preset.label || "",
    });
    if (nextUsed > snapshot.totalLimit) {
      setCatMessage(randomEntertainmentOops());
      window.setTimeout(() => setCatMessage(""), 5200);
    }
  }

  function submitLog(event) {
    event.preventDefault();
    const minutes = Math.max(1, Number(logForm.minutes || 0));
    const nextUsed = snapshot.used + minutes;
    onSaveEntertainmentLog({
      date: snapshot.date,
      type: logForm.type,
      minutes,
      note: logForm.note,
    });
    if (nextUsed > snapshot.totalLimit) {
      setCatMessage(randomEntertainmentOops());
      window.setTimeout(() => setCatMessage(""), 5200);
    }
    setLogForm({ type: "game", minutes: 10, note: "" });
  }

  function updateCheck(key, value) {
    setExtensionForm((current) => ({
      ...current,
      checks: { ...current.checks, [key]: value },
    }));
  }

  function submitExtension(event) {
    event.preventDefault();
    if (!canRedeem) return;
    onRedeemEntertainmentExtension({
      date: snapshot.date,
      minutes: Number(extensionForm.minutes),
      pointsSpent: cost,
      reason: extensionForm.reason,
      thesisOutput: extensionForm.thesisOutput,
      checks: extensionForm.checks,
    });
    setExtensionForm({
      minutes: 10,
      reason: "",
      thesisOutput: "",
      checks: {
        math: false,
        english: false,
        noUnrecordedLoss: false,
        noSleepCompression: false,
        professionalOk: true,
      },
    });
  }

  return (
    <div className="panel wide entertainment-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Entertainment Boundary</p>
          <h2>今日娱乐围栏</h2>
        </div>
        <Gamepad2 size={21} />
      </div>
      <div className="entertainment-meter">
        <div className="progress"><i style={{ width: `${Math.min(100, snapshot.totalLimit > 0 ? (snapshot.used / snapshot.totalLimit) * 100 : 0)}%` }} /></div>
        <span>{snapshot.used} / {snapshot.totalLimit}min</span>
        <small>{snapshot.baseReason}</small>
        {snapshot.usedSource === "settlement" && (
          <small>今日复盘已同步围栏：{snapshot.settlementUsed}min{snapshot.loggedUsed > 0 ? `，手动日志 ${snapshot.loggedUsed}min` : ""}</small>
        )}
      </div>
      <div className="entertainment-grid">
        <form className="mini-form" onSubmit={submitLog}>
          <strong>记录娱乐</strong>
          <div className="quick-preset-row">
            {quickPresets.map((preset) => (
              <button className="chip" type="button" key={preset.id} onClick={() => saveQuickLog(preset)}>
                {preset.label || `${entertainmentTypeText[preset.type] || "娱乐"} ${preset.minutes}min`}
              </button>
            ))}
          </div>
          <details className="quick-settings">
            <summary>设置快捷项</summary>
            <label className="field">
              <span>每行一个：类型:分钟:名称</span>
              <textarea value={quickText} onChange={(event) => setQuickText(event.target.value)} />
            </label>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => onSaveProfileSettings({ entertainmentQuickPresets: parseEntertainmentQuickPresetText(quickText) })}
            >
              保存快捷项
            </button>
          </details>
          <SelectField label="类型" value={logForm.type} onChange={(value) => setLogForm({ ...logForm, type: value })} options={entertainmentTypeOptions} />
          <NumberField label="时长分钟" value={logForm.minutes} onChange={(value) => setLogForm({ ...logForm, minutes: value })} />
          <TextField label="备注" value={logForm.note} onChange={(value) => setLogForm({ ...logForm, note: value })} />
          <button className="secondary-button" type="submit"><Plus size={17} />保存娱乐</button>
          {snapshot.used >= snapshot.baseLimit && snapshot.extensionMinutes <= 0 && (
            <p className="field-help">今日自由娱乐90min已用完。继续娱乐会在每日结算里按超时区间扣分。</p>
          )}
          {snapshot.remainingTotal < 0 && <p className="blocker-text">已超过今日娱乐总上限。建议停止娱乐并进入收束。</p>}
        </form>

        <form className="mini-form" onSubmit={submitExtension}>
          <strong>申请当日娱乐加时</strong>
          <SelectField
            label="加时"
            value={String(extensionForm.minutes)}
            onChange={(value) => setExtensionForm({ ...extensionForm, minutes: Number(value) })}
            options={Object.entries(extensionCostMap).map(([minutes, points]) => [minutes, `+${minutes}min｜${points}分`])}
          />
          <TextField label="申请原因" value={extensionForm.reason} onChange={(value) => setExtensionForm({ ...extensionForm, reason: value })} />
          <label className="field">
            <span>论文/作业可见产出</span>
            <textarea value={extensionForm.thesisOutput} onChange={(event) => setExtensionForm({ ...extensionForm, thesisOutput: event.target.value })} placeholder="例如：写完机制变量段 / 整理了表格 / 修改了引言一页" />
          </label>
          <div className="check-list compact">
            <label><input type="checkbox" checked={extensionForm.checks.math} onChange={(event) => updateCheck("math", event.target.checked)} />数学已完成至少 1 个正式块</label>
            <label><input type="checkbox" checked={extensionForm.checks.english} onChange={(event) => updateCheck("english", event.target.checked)} />英语/单词已出现</label>
            <label><input type="checkbox" checked={extensionForm.checks.noUnrecordedLoss} onChange={(event) => updateCheck("noUnrecordedLoss", event.target.checked)} />今天没有未记录娱乐失控</label>
            <label><input type="checkbox" checked={extensionForm.checks.noSleepCompression} onChange={(event) => updateCheck("noSleepCompression", event.target.checked)} />不会挤掉复盘、洗漱、上床</label>
            <label><input type="checkbox" checked={extensionForm.checks.professionalOk} onChange={(event) => updateCheck("professionalOk", event.target.checked)} />专业课已完成或今日未安排</label>
          </div>
          <button className={canRedeem ? "primary-button" : "disabled-button"} type="submit" disabled={!canRedeem}>
            兑换 +{extensionForm.minutes}min（{cost}分）
          </button>
          {!enoughPoints && <p className="field-help">当前积分不足，暂不建议兑换。</p>}
        </form>
      </div>
      {snapshot.logs.length > 0 && (
        <div className="mini-log-row">
          {snapshot.logs.slice(0, 5).map((log) => (
            <span key={log.id}>{entertainmentTypeText(log.type)} {log.minutes}min</span>
          ))}
        </div>
      )}
      {catMessage && (
        <div className="cat-celebration comfort">
          <img className="cat-face-img" src="/yeye/yeye-jump-clean.png" alt="" />
          <strong>{catMessage}</strong>
        </div>
      )}
    </div>
  );
}

function shiftIsoDate(isoDate, offsetDays) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + offsetDays);
  return formatLocalIsoDate(date);
}

function todayIsoDate() {
  return formatLocalIsoDate(new Date());
}

function formatLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function beijingIsoDate(offsetDays = 0) {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function addIsoDays(value, days) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed + Number(days || 0) * 86400000).toISOString().slice(0, 10) : "";
}

function beijingDayMinutes() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function diffIsoDays(laterIso, earlierIso) {
  const later = new Date(`${laterIso}T00:00:00`);
  const earlier = new Date(`${earlierIso}T00:00:00`);
  if (Number.isNaN(later.getTime()) || Number.isNaN(earlier.getTime())) return null;
  return Math.floor((later.getTime() - earlier.getTime()) / 86400000);
}

function buildMaskCyclePlan({ lastMaskDate, reviewDate = todayIsoDate(), health = {} }) {
  const normalizedHealth = mergeHealthForm(health);
  const todayMaskDone = normalizedHealth.maskStatus === "已敷";
  const todaySkipped = normalizedHealth.maskStatus === "跳过";
  const sensitive = normalizedHealth.skinStatus === "敏感";
  const lastMaskDateAfterReview = todayMaskDone ? reviewDate : lastMaskDate || "";
  const tomorrowDate = shiftIsoDate(reviewDate, 1);
  const daysSinceLast = lastMaskDateAfterReview ? diffIsoDays(reviewDate, lastMaskDateAfterReview) : null;
  const daysUntilTomorrow = lastMaskDateAfterReview ? diffIsoDays(tomorrowDate, lastMaskDateAfterReview) : null;
  const nextSuggestedDate = lastMaskDateAfterReview ? shiftIsoDate(lastMaskDateAfterReview, 3) : "";

  if (!lastMaskDateAfterReview) {
    return {
      lastMaskDateAfterReview: "",
      tomorrowDate,
      daysSinceLast,
      shouldScheduleMaskTomorrow: false,
      status: "未开始",
      nextSuggestedDate: "",
      message: "还没有面膜记录，完成一次后将开始周期提醒。",
    };
  }

  if (sensitive) {
    return {
      lastMaskDateAfterReview,
      tomorrowDate,
      daysSinceLast,
      shouldScheduleMaskTomorrow: false,
      status: "暂缓",
      nextSuggestedDate,
      message: "今日皮肤状态偏敏感，明日暂不强排面膜，可视情况只做基础护肤。",
    };
  }

  const shouldScheduleMaskTomorrow = Boolean(lastMaskDateAfterReview && daysUntilTomorrow >= 3 && !todayMaskDone);
  const todayDue = daysSinceLast !== null && daysSinceLast >= 3 && !todayMaskDone;
  return {
    lastMaskDateAfterReview,
    tomorrowDate,
    daysSinceLast,
    shouldScheduleMaskTomorrow,
    status: todayMaskDone ? "今日已敷" : todaySkipped ? "已跳过" : shouldScheduleMaskTomorrow ? "明日应敷" : todayDue ? "今日应敷" : "未到时间",
    nextSuggestedDate,
    message: shouldScheduleMaskTomorrow
      ? `明日建议安排 20min「敷面膜 + 基础护肤」，优先放在晚间洗澡后或复盘前后。`
      : todayMaskDone
        ? `已记录 ${reviewDate} 敷面膜，下次建议 ${nextSuggestedDate || "待计算"}。`
        : todaySkipped
          ? `今天记录为跳过，周期锚点仍是 ${lastMaskDateAfterReview}。`
          : `上次 ${lastMaskDateAfterReview}，下次建议 ${nextSuggestedDate || "待计算"}。`,
  };
}

function buildMaskCycleDisplay(profile = {}) {
  const plan = profile.maskCycle || {};
  const lastMaskDate = profile.lastMaskDate || plan.lastMaskDateAfterReview || "";
  const today = todayIsoDate();
  const daysSinceLast = lastMaskDate ? diffIsoDays(today, lastMaskDate) : null;
  return {
    lastMaskDate,
    daysSinceLast,
    status: plan.status || (lastMaskDate ? (daysSinceLast >= 3 ? "今日应敷" : "未到时间") : "未开始"),
    nextSuggestedDate: plan.nextSuggestedDate || (lastMaskDate ? shiftIsoDate(lastMaskDate, 3) : ""),
    message: plan.message || (lastMaskDate ? `上次 ${lastMaskDate}，按 3 天周期提醒。` : "还没有面膜记录，完成一次后将开始周期提醒。"),
  };
}

function randomEntertainmentOops() {
  return entertainmentOopsMessages[Math.floor(Math.random() * entertainmentOopsMessages.length)];
}

function localIsoDateFromValue(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isTodayReview(reviewDate) {
  return Boolean(reviewDate && reviewDate === todayIsoDate());
}

function reviewTimelinessScore(reviewDate) {
  return isTodayReview(reviewDate) ? 1 : 0.5;
}

function hasCompletedDevelopmentToday(plans = [], ignorePlanId = "") {
  const today = todayIsoDate();
  return (plans || []).some((plan) =>
    plan.id !== ignorePlanId &&
    plan.kind !== "bug" &&
    plan.status === "done" &&
    localIsoDateFromValue(plan.completedAt || plan.updatedAt) === today
  );
}

function buildDiaryEntryFromDraft(diary, date, settlement = null) {
  const normalizedTags = normalizeDiaryTags(diary.normalizedTags || diary.rawTags || []);
  return {
    date,
    title: diary.title || generateDiaryTitle(diary.content, date),
    summary: diary.summary || generateDiarySummary(diary.content),
    content: diary.content || "",
    rawTags: diary.rawTags || normalizedTags,
    normalizedTags,
    tagGroups: diary.tagGroups || groupDiaryTags(normalizedTags),
    people: splitDiaryListValue(diary.people || []),
    places: splitDiaryListValue(diary.places || []),
    favorite: diary.favorite === true,
    isPrivate: diary.isPrivate !== false,
    moodScore: settlement?.state?.mood ?? diary.moodScore ?? null,
    energyScore: settlement?.state?.energy ?? diary.energyScore ?? null,
    sleepImpact: settlement?.state?.sleepImpact || diary.sleepImpact || "",
    phoneInterference: settlement?.state?.phoneInterference || diary.phoneInterference || "",
    dayType: settlement?.nextDayEntertainmentSourceDayType || settlement?.dayTypeDisplayName || diary.dayType || "",
    studyMinutes: Number(settlement?.studyMinutes ?? diary.studyMinutes ?? 0),
    source: "daily-settlement",
    sourceReviewDate: date,
  };
}

function buildReadingEntryFromSettlement(settlement) {
  const reading = settlement.subjects?.reading || {};
  return {
    date: settlement.reviewDate,
    sourceReviewDate: settlement.reviewDate,
    bookTitle: settlement.readingBookTitle || reading.bookTitle || "",
    minutes: Number(settlement.readingMinutes || reading.minutes || 0),
    feeling: settlement.readingFeeling || reading.feeling || "",
    source: "daily-review",
  };
}

function DiarySyncPreview({ diary, onDiaryChange, syncDiary, setSyncDiary, conflict, conflictStrategy, setConflictStrategy }) {
  if (!diary?.content) {
    return (
      <div className="diary-sync-card muted">
        <strong>🧩 日记同步</strong>
        <span>未检测到日记内容，本次不会创建日记。</span>
      </div>
    );
  }

  return (
    <div className="diary-sync-card">
      <div className="diary-sync-head">
        <div>
          <strong>🧩 日记同步</strong>
          <span>状态：已识别 · 字数 {diary.wordCount || countDiaryWords(diary.content)} 字</span>
        </div>
        <label>
          <input type="checkbox" checked={syncDiary} onChange={(event) => setSyncDiary(event.target.checked)} />
          保存结算时同步到日记
        </label>
      </div>
      <label className="field">
        <span>标题</span>
        <input value={diary.title || ""} onChange={(event) => onDiaryChange({ ...diary, title: event.target.value })} />
      </label>
      <label className="field">
        <span>摘要</span>
        <input value={diary.summary || ""} onChange={(event) => onDiaryChange({ ...diary, summary: event.target.value })} />
      </label>
      <label className="field">
        <span>日记预览</span>
        <textarea className="diary-preview-textarea" value={diary.content || ""} onChange={(event) => onDiaryChange({ ...diary, content: event.target.value, wordCount: countDiaryWords(event.target.value) })} />
      </label>
      <div className="two-column-fields">
        <label className="field">
          <span>人物</span>
          <input
            value={(diary.people || []).join("，")}
            onChange={(event) => onDiaryChange({ ...diary, people: splitDiaryListValue(event.target.value) })}
            placeholder="例如：老师，同学，自己"
          />
        </label>
        <label className="field">
          <span>地点</span>
          <input
            value={(diary.places || []).join("，")}
            onChange={(event) => onDiaryChange({ ...diary, places: splitDiaryListValue(event.target.value) })}
            placeholder="例如：图书馆，宿舍"
          />
        </label>
      </div>
      <label className="field">
        <span>标签</span>
        <input
          value={(diary.rawTags || diary.normalizedTags || []).join("，")}
          onChange={(event) => {
            const tags = normalizeDiaryTags(event.target.value);
            onDiaryChange({ ...diary, rawTags: tags, normalizedTags: tags });
          }}
        />
      </label>
      <div className="diary-toggle-row">
        <label><input type="checkbox" checked={diary.isPrivate !== false} onChange={(event) => onDiaryChange({ ...diary, isPrivate: event.target.checked })} /> 私密</label>
        <label><input type="checkbox" checked={diary.favorite === true} onChange={(event) => onDiaryChange({ ...diary, favorite: event.target.checked })} /> 收藏</label>
      </div>
      <div className="detected-chip-list">
        {(diary.normalizedTags || diary.rawTags || []).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      {conflict && syncDiary && (
        <label className="field">
          <span>今天的日记已经手动编辑过</span>
          <select value={conflictStrategy} onChange={(event) => setConflictStrategy(event.target.value)}>
            <option value="overwrite">覆盖更新</option>
            <option value="tags">只补充标签</option>
            <option value="cancel">取消同步</option>
          </select>
        </label>
      )}
    </div>
  );
}

function ReadingSyncPreview({ reading }) {
  if (!reading?.minutes || !reading?.bookTitle) {
    return (
      <div className="reading-sync-card muted">
        <strong>📚 阅读同步</strong>
        <span>未检测到阅读记录，本次不会创建图书馆记录。</span>
      </div>
    );
  }

  return (
    <div className="reading-sync-card">
      <div>
        <strong>📚 阅读同步</strong>
        <span>将同步到小椰图书馆</span>
      </div>
      <div className="reading-sync-grid">
        <InfoLine label="书籍" value={reading.bookTitle} />
        <InfoLine label="时长" value={minutesLabel(reading.minutes)} />
        <InfoLine label="感受" value={reading.feeling || "未填写"} />
      </div>
    </div>
  );
}

function Settlement({ data, profile, settlements, diaryEntries = [], onSubmit, onSaveMathProgress, onSaveProfessionalProgress, onSaveProfile }) {
  const [reviewMarkdown, setReviewMarkdown] = useState("");
  const [parseSummary, setParseSummary] = useState("");
  const [catMessage, setCatMessage] = useState("");
  const [progressDate, setProgressDate] = useState(new Date().toISOString().slice(0, 10));
  const [detectedMathProgress, setDetectedMathProgress] = useState([]);
  const [detectedProfessionalProgress, setDetectedProfessionalProgress] = useState([]);
  const [diaryDraft, setDiaryDraft] = useState(null);
  const [syncDiary, setSyncDiary] = useState(true);
  const [diaryConflictStrategy, setDiaryConflictStrategy] = useState("overwrite");
  const [parsedPreview, setParsedPreview] = useState(null);
  const [reviewAction, setReviewAction] = useState({ status: "idle", message: "" });
  const [isParsingReview, setIsParsingReview] = useState(false);
  const [isCopyingReview, setIsCopyingReview] = useState(false);
  const [isPastingReview, setIsPastingReview] = useState(false);
  const [detectedProgressMode, setDetectedProgressMode] = useState({ course: true, exercise: false, useDate: true });
  const [form, setForm] = useState({
    studyMinutes: 450,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    exerciseIntensityText: "",
    sleepAdjustment: 0.5,
    actualGameMinutesToday: 0,
    beneficialMinutes: 0,
    totalEntertainmentMinutes: 0,
    recognizedEntertainmentMinutes: 0,
    entertainmentFenceNote: "",
    isTravelDay: false,
    travelDayBonusPoints: Number(profile.travelDayBonusPoints ?? 1),
    reviewDate: todayIsoDate(),
    health: blankHealthForm(),
    note: "",
    durationSources: {},
    finalDurationConfirmed: false,
  });
  const timelinePrefill = useMemo(() => buildReviewPrefillFromPlanner(profile.scheduleAssistantDraft, form.reviewDate), [profile.scheduleAssistantDraft, form.reviewDate]);
  const detail = calculateGeneratedMinutes(form);
  const dayClassification = classifyDay({ ...form, totalEntertainmentMinutes: detail.totalEntertainmentMinutes });
  const bankPointsAdded = calculateBankPointsAdded(detail.availableMinutes);
  const reviewTimelinessBonus = reviewTimelinessScore(form.reviewDate);
  const sleepAdjustmentPoints = Number(detail.sleepAdjustment || 0);
  const exerciseBonusPoints = Number(detail.exerciseBonusPoints || 0);
  const workMinutes = Number(form.subjects?.work?.minutes || form.workMinutes || 0);
  const workPoints = calculateWorkPoints(workMinutes);
  const dayTypeBonusPoints = Number(dayClassification.bonusPoints || 0);
  const entertainmentScore = calculateFreeEntertainmentScore(detail.totalEntertainmentMinutes);
  const maskCycle = buildMaskCyclePlan({
    lastMaskDate: profile.lastMaskDate,
    reviewDate: form.reviewDate,
    health: form.health,
  });
  const entertainmentPenalty = {
    overLimitMinutes: entertainmentScore.overtimeMinutes,
    penaltyPoints: Math.max(0, -entertainmentScore.scoreDelta),
    label: entertainmentScore.label,
  };
  const pointsAdded = roundPoints(bankPointsAdded + sleepAdjustmentPoints + exerciseBonusPoints + workPoints + dayTypeBonusPoints + reviewTimelinessBonus + entertainmentScore.scoreDelta);
  const liveSummaryEntry = {
    ...form,
    ...detail,
    reviewDate: form.reviewDate,
    pointsAdded,
    workMinutes,
    workPoints,
    dayTypeDisplayName: dayClassification.displayName,
    bedtime: form.parsedBedtime || form.bedtime || "",
    sleepDuration: form.sleepDuration || "",
    entertainmentBreakdown: form.entertainmentBreakdown || {},
  };
  const liveTimeSummary = buildWeeklySummary([liveSummaryEntry], {
    startDate: form.reviewDate,
    endDate: form.reviewDate,
  });
  const existingDiary = diaryEntries.find((entry) => entry.date === form.reviewDate);
  const diaryHasManualConflict = Boolean(existingDiary && (existingDiary.manuallyEdited || existingDiary.source === "manual"));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function importReviewMarkdown() {
    const source = String(reviewMarkdown || "").trim();
    if (!source) {
      setReviewAction({ status: "error", message: "请先粘贴或填写复盘内容。" });
      return;
    }

    setIsParsingReview(true);
    setReviewAction({ status: "loading", message: "正在识别复盘……" });

    try {
      const parsed = parseReviewMarkdown(source, {
        miscTags: [
          ...mergeMiscReviewTags(profile.miscTags || []),
          ...classificationKeywordTags(profile.classificationTaxonomy || []),
        ],
        entertainmentTags: mergeEntertainmentReviewTags(profile.entertainmentTags || []),
      });

      if (!parsed || typeof parsed !== "object") throw new Error("解析器没有返回有效结果");

      const detected = extractMathProgressFromReview(parsed);
      const detectedProfessional = extractProfessionalProgressFromReview(parsed);
      const parsedDate = parsed.reviewDate || todayIsoDate();
      const parsedDiary = parseDiaryFromMarkdown(source, parsedDate);
      const reviewMinutes = Number(parsed.totalEntertainmentMinutes || 0);

      setForm((current) => ({
        ...current,
        studyMinutes: parsed.studyMinutes === null || parsed.studyMinutes === undefined ? current.studyMinutes : Number(parsed.studyMinutes),
        exerciseMinutes: Number(parsed.exerciseMinutes || 0),
        exerciseIntensity: parsed.exerciseIntensity,
        exerciseIntensityText: parsed.exerciseIntensityText,
        sleepAdjustment: parsed.sleepAdjustment,
        actualGameMinutesToday: Number(parsed.actualGameMinutesToday || 0),
        beneficialMinutes: Number(parsed.beneficialMinutes || 0),
        totalEntertainmentMinutes: reviewMinutes,
        recognizedEntertainmentMinutes: reviewMinutes,
        entertainmentBreakdown: parsed.entertainmentBreakdown || {},
        entertainmentFenceNote: "",
        note: parsed.note || current.note,
        rawReview: parsed.rawReview || source,
        reviewData: parsed.reviewData || {},
        subjects: parsed.subjects || {},
        readingMinutes: Number(parsed.readingMinutes || 0),
        readingBookTitle: parsed.readingBookTitle || "",
        readingFeeling: parsed.readingFeeling || "",
        readingSessions: parsed.readingSessions || [],
        workMinutes: Number(parsed.subjects?.work?.minutes || 0),
        state: parsed.state || {},
        wakeTime: parsed.wakeTime || "",
        sleepDuration: parsed.sleepDuration || "",
        lateSleepReason: parsed.lateSleepReason || "",
        health: mergeHealthForm(current.health),
        reviewDate: parsedDate,
        parsedBedtime: parsed.bedtime || "",
        parsedSleepAdjustmentLabel: parsed.sleepAdjustmentLabel || "",
      }));

      setProgressDate(parsedDate);
      setDetectedMathProgress(detected);
      setDetectedProfessionalProgress(detectedProfessional);
      setDiaryDraft(parsedDiary);
      setSyncDiary(Boolean(parsedDiary?.content));
      setDiaryConflictStrategy("overwrite");
      setParsedPreview(parsed);

      const summary =
        `识别成功：学习 ${formatDuration(parsed.studyMinutes || 0)}` +
        `，阅读 ${formatDuration(parsed.readingMinutes || 0)}` +
        `，运动 ${formatDuration(parsed.exerciseMinutes || 0)}` +
        `，娱乐 ${formatDuration(reviewMinutes)}` +
        `，睡眠 ${parsed.sleepDuration || "未记录"}。`;

      setParseSummary(summary);
      setReviewAction({ status: "success", message: summary });
    } catch (error) {
      console.error("[review-import]", error);
      setParsedPreview(null);
      setParseSummary("");
      setReviewAction({ status: "error", message: `识别失败：${error?.message || "未知错误"}` });
    } finally {
      setIsParsingReview(false);
    }
  }

  async function copyDefaultReviewMarkdown() {
    setIsCopyingReview(true);
    setReviewAction({ status: "idle", message: "" });
    try {
      await writeClipboardText(buildDefaultReviewMarkdown(profile.reviewProjects));
      setReviewAction({ status: "success", message: "默认复盘模板已复制到剪贴板。" });
    } catch (error) {
      console.error("[review-copy]", error);
      setReviewAction({ status: "error", message: `复制失败：${error?.message || "未知错误"}` });
    } finally {
      setIsCopyingReview(false);
    }
  }

  async function pasteReviewMarkdownFromClipboard() {
    setIsPastingReview(true);
    setReviewAction({ status: "idle", message: "" });
    try {
      const markdown = await readClipboardText();
      if (!String(markdown || "").trim()) throw new Error("剪贴板里没有文本");
      setReviewMarkdown(markdown);
      setReviewAction({ status: "success", message: "已从剪贴板粘贴复盘内容，请点击“识别复盘”。" });
    } catch (error) {
      console.error("[review-paste]", error);
      setReviewAction({ status: "error", message: error?.message || "无法读取剪贴板，请手动粘贴。" });
    } finally {
      setIsPastingReview(false);
    }
  }

  function restoreDefaultReviewMarkdown() {
    setReviewMarkdown(buildDefaultReviewMarkdown(profile.reviewProjects));
    setReviewAction({ status: "success", message: "已恢复默认模板，可直接填写或粘贴内容。" });
  }

  function clearReviewMarkdownArea() {
    setReviewMarkdown("");
    setParseSummary("");
    setDetectedMathProgress([]);
    setDetectedProfessionalProgress([]);
    setDiaryDraft(null);
    setParsedPreview(null);
    setReviewAction({ status: "success", message: "粘贴区和识别结果已清空。" });
  }

  function usePreset(preset) {
    setForm((current) => ({
      ...current,
      studyMinutes: preset.studyMinutes,
      exerciseMinutes: preset.exerciseMinutes,
      exerciseIntensity: preset.exerciseIntensity,
      sleepAdjustment: preset.sleepAdjustment,
      beneficialMinutes: preset.beneficialMinutes,
      actualGameMinutesToday: preset.actualGameMinutesToday,
      totalEntertainmentMinutes: Number(preset.beneficialMinutes || 0) + Number(preset.actualGameMinutesToday || 0),
      recognizedEntertainmentMinutes: Number(preset.beneficialMinutes || 0) + Number(preset.actualGameMinutesToday || 0),
      entertainmentFenceNote: "",
    }));
  }

  function applyTimelinePrefill() {
    if (!timelinePrefill.available) return;
    setForm((current) => ({
      ...current,
      studyMinutes: timelinePrefill.available ? timelinePrefill.studyMinutes : current.studyMinutes,
      exerciseMinutes: timelinePrefill.available ? timelinePrefill.exerciseMinutes : current.exerciseMinutes,
      durationSources: { ...current.durationSources, studyMinutes: "排程建议：仅统计学习段，不包含块后休息", exerciseMinutes: "排程时间线建议" },
      finalDurationConfirmed: false,
    }));
    setParseSummary(`已填入排程建议：真实学习 ${timelinePrefill.studyMinutes}min（不含休息）、运动 ${timelinePrefill.exerciseMinutes}min。请核对并修改；保存后以最终复盘为准。`);
  }

  function submit(event) {
    event.preventDefault();
    if (
      Number(form.totalEntertainmentMinutes || 0) > DAILY_FREE_ENTERTAINMENT_LIMIT_MIN
    ) {
      setCatMessage(randomEntertainmentOops());
      window.setTimeout(() => setCatMessage(""), 5200);
    }
    const settlement = {
      ...form,
      ...detail,
      tomorrowGameMinutes: 0,
      freeEntertainmentLimitMinutes: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      nextDayEntertainmentLimitReason: dayClassification.reason,
      nextDayEntertainmentSourceDayType: dayClassification.dayType,
      dayTypeDisplayName: dayClassification.displayName,
      mainlineStamps: dayClassification.stamps,
      readingMinutes: Number(form.readingMinutes || form.subjects?.reading?.minutes || 0),
      readingBookTitle: form.readingBookTitle || form.subjects?.reading?.bookTitle || "",
      readingFeeling: form.readingFeeling || form.subjects?.reading?.feeling || "",
      readingSessions: form.readingSessions || form.subjects?.reading?.sessions || [],
      bankPointsAdded,
      sleepAdjustmentPoints,
      exerciseBonusPoints,
      workMinutes,
      workPoints,
      dayTypeBonusPoints,
      reviewTimelinessBonus,
      entertainmentOverLimitMinutes: entertainmentPenalty.overLimitMinutes,
      entertainmentPenaltyPoints: entertainmentPenalty.penaltyPoints,
      entertainmentPenaltyLabel: entertainmentPenalty.label,
      entertainmentScoreDelta: entertainmentScore.scoreDelta,
      entertainmentScoreLabel: entertainmentScore.label,
      entertainmentBreakdown: form.entertainmentBreakdown || {},
      health: mergeHealthForm(form.health),
      lastMaskDateBeforeReview: profile.lastMaskDate || "",
      lastMaskDateAfterReview: maskCycle.lastMaskDateAfterReview || "",
      shouldScheduleMaskTomorrow: maskCycle.shouldScheduleMaskTomorrow,
      maskTomorrowDate: maskCycle.tomorrowDate,
      maskCycleStatus: maskCycle.status,
      maskCycleMessage: maskCycle.message,
      nextMaskSuggestedDate: maskCycle.nextSuggestedDate,
      pointsAdded,
      durationSources: form.durationSources || {},
      finalDurationConfirmed: true,
    };
    onSubmit(settlement, {
      sync: syncDiary,
      diary: diaryDraft ? buildDiaryEntryFromDraft(diaryDraft, settlement.reviewDate, settlement) : null,
      strategy: diaryHasManualConflict ? diaryConflictStrategy : "overwrite",
    });
  }

  return (
    <section className="settlement-layout">
      <form className="panel form-panel" onSubmit={submit}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Daily Settlement</p>
            <h2>每日结算</h2>
          </div>
          <Save size={21} />
        </div>

        <label className="field">
          <span>粘贴 Markdown 复盘</span>
          <textarea
            className="review-textarea"
            value={reviewMarkdown}
            onChange={(event) => setReviewMarkdown(event.target.value)}
            placeholder="把你每天的复盘模板整段粘贴到这里，小椰会自动识别学习、运动、睡眠和娱乐。"
          />
        </label>
        <div className="review-action-bar">
          <button className="primary-button review-primary-action" type="button" onClick={importReviewMarkdown} disabled={isParsingReview}>
            {isParsingReview ? "识别中…" : "识别复盘"}
          </button>
          <button className="secondary-button" type="button" onClick={pasteReviewMarkdownFromClipboard} disabled={isPastingReview}>
            {isPastingReview ? "读取中…" : "从剪贴板粘贴"}
          </button>
          <button className="secondary-button" type="button" onClick={copyDefaultReviewMarkdown} disabled={isCopyingReview}>
            {isCopyingReview ? "复制中…" : "复制默认 Markdown"}
          </button>
          <button className="secondary-button" type="button" onClick={restoreDefaultReviewMarkdown}>恢复默认模板</button>
          <button className="secondary-button" type="button" onClick={applyTimelinePrefill} disabled={!timelinePrefill.available}>填入排程建议</button>
          <button className="secondary-button danger-text" type="button" onClick={clearReviewMarkdownArea}>清空</button>
        </div>
        {reviewAction.message && (
          <div className={`review-action-message ${reviewAction.status}`} role="status" aria-live="polite">
            {reviewAction.message}
          </div>
        )}
        {parseSummary && <div className="parse-summary">{parseSummary}</div>}
        {Object.values(form.durationSources || {}).some(Boolean) && <p className="field-help">时长建议来源：排程时间线。它不是完成记录，你可以直接修改；保存结算即代表已确认最终实际时长。</p>}
        {parsedPreview && <ReviewParsePreviewBoundary resetKey={parsedPreview}><ReviewParsePreview parsed={parsedPreview} /></ReviewParsePreviewBoundary>}
        <DiarySyncPreview
          diary={diaryDraft}
          onDiaryChange={setDiaryDraft}
          syncDiary={syncDiary}
          setSyncDiary={setSyncDiary}
          conflict={diaryHasManualConflict}
          conflictStrategy={diaryConflictStrategy}
          setConflictStrategy={setDiaryConflictStrategy}
        />
        <ReadingSyncPreview reading={form.subjects?.reading || { minutes: form.readingMinutes, bookTitle: form.readingBookTitle, feeling: form.readingFeeling }} />
        {detectedMathProgress.length > 0 && (
          <div className="detected-progress">
            <div className="detected-progress-head">
              <strong>识别到数学进度</strong>
              <label>
                日期
                <input type="date" value={progressDate} disabled={!detectedProgressMode.useDate} onChange={(event) => setProgressDate(event.target.value)} />
              </label>
            </div>
            <div className="detected-options">
              <label><input type="checkbox" checked={detectedProgressMode.course} onChange={(event) => setDetectedProgressMode((current) => ({ ...current, course: event.target.checked }))} />未标明时算网课</label>
              <label><input type="checkbox" checked={detectedProgressMode.exercise} onChange={(event) => setDetectedProgressMode((current) => ({ ...current, exercise: event.target.checked }))} />未标明时算习题</label>
              <label><input type="checkbox" checked={detectedProgressMode.useDate} onChange={(event) => setDetectedProgressMode((current) => ({ ...current, useDate: event.target.checked }))} />记录日期</label>
            </div>
            <div className="detected-chip-list">
              {detectedMathProgress.map((chapterItem) => (
                <span key={chapterItem.id}>
                  {chapterItem.trackName} · {chapterItem.code} {chapterItem.title}
                  {chapterItem.modeSpecified && ` · ${chapterItem.detectedCourse ? "网课" : ""}${chapterItem.detectedCourse && chapterItem.detectedExercise ? " + " : ""}${chapterItem.detectedExercise ? "习题" : ""}`}
                </span>
              ))}
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onSaveMathProgress(detectedMathProgress.map((chapterItem) => {
                const courseCompleted = chapterItem.modeSpecified ? chapterItem.detectedCourse : detectedProgressMode.course;
                const exerciseCompleted = chapterItem.modeSpecified ? chapterItem.detectedExercise : detectedProgressMode.exercise;
                return {
                  ...chapterItem,
                  itemId: chapterItem.id,
                  completed: courseCompleted && exerciseCompleted,
                  completedDate: courseCompleted && exerciseCompleted && detectedProgressMode.useDate ? progressDate : "",
                  courseCompleted,
                  courseDate: courseCompleted && detectedProgressMode.useDate ? progressDate : "",
                  exerciseCompleted,
                  exerciseDate: exerciseCompleted && detectedProgressMode.useDate ? progressDate : "",
                  source: "review",
                  note: chapterItem.modeSpecified ? "从每日复盘识别完成类型" : "从每日复盘识别",
                };
              }))}
            >
              同步这些进度
            </button>
          </div>
        )}
        {detectedProfessionalProgress.length > 0 && (
          <div className="detected-progress">
            <div className="detected-progress-head">
              <strong>识别到专业课进度</strong>
              <label>
                日期
                <input type="date" value={progressDate} disabled={!detectedProgressMode.useDate} onChange={(event) => setProgressDate(event.target.value)} />
              </label>
            </div>
            <div className="detected-chip-list">
              {detectedProfessionalProgress.map((courseItem) => (
                <span key={courseItem.itemId}>
                  {courseItem.moduleTitle} · {courseItem.lectureTitle} · {courseItem.label} {courseItem.title}
                </span>
              ))}
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onSaveProfessionalProgress(detectedProfessionalProgress.map((courseItem) => ({
                ...courseItem,
                completed: true,
                completedDate: detectedProgressMode.useDate ? progressDate : "",
                note: `从每日复盘识别：${courseItem.sourceText || ""}`,
              })))}
            >
              同步专业课进度
            </button>
          </div>
        )}

        <div className="preset-row">
          {intensityPresets.map((preset) => (
            <button className="chip" type="button" key={preset.id} onClick={() => usePreset(preset)}>{preset.name}</button>
          ))}
        </div>

        <NumberField label="真实学习分钟（不含休息）" value={form.studyMinutes} step={1} onChange={(value) => update("studyMinutes", value)} />
        <NumberField label="运动分钟" value={form.exerciseMinutes} step={1} onChange={(value) => update("exerciseMinutes", value)} />
        <label className="field">
          <span>运动强度</span>
          <select value={form.exerciseIntensity} onChange={(event) => update("exerciseIntensity", event.target.value)}>
            <option value="none">无运动</option>
            <option value="low">低强度</option>
            <option value="medium_high">中高强度</option>
          </select>
        </label>
        <label className="field">
          <span>睡眠积分</span>
          <select value={form.sleepAdjustment} onChange={(event) => update("sleepAdjustment", toNumber(event.target.value))}>
            {sleepAdjustmentOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {form.parsedBedtime && (
          <p className="field-help">从复盘识别到入睡时间：{form.parsedBedtime}，{form.parsedSleepAdjustmentLabel}</p>
        )}
        <div className="settlement-switch-card">
          <div>
            <span>当天性质手动标记</span>
            <strong>{form.isTravelDay ? "出游日" : "自动判定"}</strong>
            <small>出游日只由你手动标记，默认额外 +{form.travelDayBonusPoints || 1} 分；普通工作不会再自动变成特殊事务日。</small>
          </div>
          <label>
            <input type="checkbox" checked={form.isTravelDay} onChange={(event) => update("isTravelDay", event.target.checked)} />
            今天是出游日
          </label>
        </div>
        {form.isTravelDay && (
          <NumberField label="出游日额外奖励" value={form.travelDayBonusPoints} onChange={(value) => update("travelDayBonusPoints", value)} />
        )}
        <div className="settlement-switch-card">
          <div>
            <span>复盘识别娱乐</span>
            <strong>{form.recognizedEntertainmentMinutes || 0} min</strong>
            <small>每日固定自由娱乐额度 {DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min。默认按复盘识别值入账，若你想手动修正，就直接改下面的实际娱乐分钟。</small>
          </div>
          <span className="settlement-limit-badge">按90min加扣分</span>
        </div>
        <NumberField label="实际娱乐分钟" value={form.totalEntertainmentMinutes} step={1} onChange={(value) => update("totalEntertainmentMinutes", value)} />
        <TextField label="修正原因（可空）" value={form.entertainmentFenceNote} onChange={(value) => update("entertainmentFenceNote", value)} />
        <p className="field-help">如果复盘里漏写了，或者你想按回忆修正真实娱乐时间，就在这里直接改。系统会按固定90min自由娱乐额度计算加扣分。</p>
        <HealthQuickCards
          health={form.health}
          items={profile.healthMaintenanceItems}
          periodCycle={profile.periodCycle}
          reviewDate={form.reviewDate}
          onChange={(health) => update("health", health)}
          onSaveProfile={onSaveProfile}
          maskCycle={maskCycle}
        />
        <label className="field">
          <span>备注</span>
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="今天的状态、复盘或小椰要记住的边界" />
        </label>
        <button className="primary-button full" type="submit">
          <Check size={18} />
          保存结算并更新银行积分
        </button>
        {catMessage && (
          <div className="cat-celebration comfort">
            <img className="cat-face-img" src="/yeye/yeye-jump-clean.png" alt="" />
            <strong>{catMessage}</strong>
          </div>
        )}
      </form>

      <TodaySettlementSummary
        summary={liveTimeSummary}
        form={form}
        detail={detail}
        profile={profile}
        pointsAdded={pointsAdded}
        workMinutes={workMinutes}
        workPoints={workPoints}
        dayClassification={dayClassification}
        entertainmentScore={entertainmentScore}
        entertainmentPenalty={entertainmentPenalty}
        bankPointsAdded={bankPointsAdded}
        sleepAdjustmentPoints={sleepAdjustmentPoints}
        exerciseBonusPoints={exerciseBonusPoints}
        dayTypeBonusPoints={dayTypeBonusPoints}
        reviewTimelinessBonus={reviewTimelinessBonus}
        maskCycle={maskCycle}
      />
    </section>
  );
}

function TodaySettlementSummary({
  summary,
  form,
  detail,
  profile,
  pointsAdded,
  workMinutes,
  workPoints,
  dayClassification,
  entertainmentScore,
  entertainmentPenalty,
  bankPointsAdded,
  sleepAdjustmentPoints,
  exerciseBonusPoints,
  dayTypeBonusPoints,
  reviewTimelinessBonus,
  maskCycle,
}) {
  const [breakdownLevel, setBreakdownLevel] = useState("primary");
  const totals = breakdownLevel === "primary" ? summary.activityTotals : summary.secondaryActivityTotals;
  const rawItems = breakdownLevel === "primary"
    ? totals
    : totals.filter((item) => Number(item.minutes || 0) > 0);
  const breakdownItems = buildWeeklyDistributionItems(rawItems, true, breakdownLevel === "primary" ? "primary" : "secondary");
  const totalMinutes = breakdownItems.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const bankAfterSettlement = roundPoints(Number(profile.points || 0) + Number(pointsAdded || 0));
  const studyMinutes = Number(form.studyMinutes || 0);
  const entertainmentMinutes = Number(detail.totalEntertainmentMinutes || 0);
  const bedtime = form.parsedBedtime || form.bedtime || "未记录";
  const summaryBits = [
    studyMinutes > 0 ? `真实学习 ${studyMinutes}min` : "未填写真实学习时长",
    entertainmentScore.overtimeMinutes > 0
      ? entertainmentScore.overtimeMinutes <= 5
        ? `娱乐超出 ${entertainmentScore.overtimeMinutes}min，处于宽限范围`
        : `娱乐超出 ${entertainmentScore.overtimeMinutes}min`
      : `自由娱乐未超 ${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min 额度`,
    Number(form.exerciseMinutes || 0) > 0 ? `完成运动 ${form.exerciseMinutes}min` : "今日未记录运动",
    bedtime !== "未记录" ? `入睡 ${bedtime}` : "未记录入睡时间",
  ];

  return (
    <aside className="settlement-summary today-summary-panel">
      <section className="summary-card today-summary-overview">
        <div className="today-summary-heading">
          <div>
            <span>今日概览</span>
            <strong>{pointsAdded >= 0 ? "+" : ""}{formatPoints(pointsAdded)} 分</strong>
          </div>
          <span className="today-summary-date">{form.reviewDate || "待填写日期"}</span>
        </div>
        <div className="today-summary-stat-grid">
          <InfoLine label="保存后银行余额" value={`${formatPoints(bankAfterSettlement)} 分`} />
          <InfoLine label="真实学习" value={`${studyMinutes} min`} />
          <InfoLine label="自由娱乐" value={`${entertainmentMinutes} / ${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN} min`} />
          <InfoLine label="入睡时间" value={bedtime} />
          <InfoLine label="运动" value={`${Number(form.exerciseMinutes || 0)} min`} />
          <InfoLine label="今日类型" value={dayClassification.displayName} />
        </div>
        <p className="today-summary-sentence">{summaryBits.join("；")}。</p>
      </section>

      <section className="summary-card today-time-breakdown">
        <div className="panel-title compact-panel-title">
          <div><span>今日时间构成</span><small>复用周总结的分类口径</small></div>
          <div className="segmented-control" aria-label="时间构成层级">
            <button type="button" className={breakdownLevel === "primary" ? "active" : ""} onClick={() => setBreakdownLevel("primary")}>一级分类</button>
            <button type="button" className={breakdownLevel === "secondary" ? "active" : ""} onClick={() => setBreakdownLevel("secondary")}>二级明细</button>
          </div>
        </div>
        <div className="today-time-bar" aria-label="今日时间构成比例">
          {breakdownItems.map((item) => (
            <span key={item.key} title={`${item.label} ${item.minutes}min`} style={{ width: `${totalMinutes ? Number(item.minutes || 0) / totalMinutes * 100 : 0}%`, background: item.color }} />
          ))}
        </div>
        <div className="today-breakdown-list">
          {breakdownItems.length ? breakdownItems.map((item) => (
            <div key={item.key}>
              <span className="today-breakdown-label"><i style={{ background: item.color }} />{item.label}</span>
              <strong>{item.minutes}min</strong>
              <small>{totalMinutes ? Math.round(Number(item.minutes || 0) / totalMinutes * 100) : 0}%</small>
            </div>
          )) : <p className="field-help">填写或识别复盘后，这里会即时显示时间构成。</p>}
        </div>
      </section>

      <section className="summary-card today-goal-status">
        <span>今日目标与状态</span>
        <div className="today-status-list">
          <InfoLine label="学习" value={`${studyMinutes} min`} />
          <InfoLine label="自由娱乐" value={`${entertainmentMinutes} / ${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN} min${entertainmentPenalty.overLimitMinutes > 0 && entertainmentPenalty.overLimitMinutes <= 5 ? "（宽限）" : ""}`} />
          <InfoLine label="运动" value={Number(form.exerciseMinutes || 0) > 0 ? `${form.exerciseMinutes} min` : "未运动"} />
          <InfoLine label="睡眠" value={bedtime === "未记录" ? "未记录" : `${bedtime} · ${sleepLabel(form.sleepAdjustment)}`} />
          <InfoLine label="面膜周期" value={maskCycle.status || "未开始"} />
        </div>
      </section>

      <details className="summary-card today-points-details">
        <summary><span>今日积分变化</span><strong>{pointsAdded >= 0 ? "+" : ""}{formatPoints(pointsAdded)} 分</strong><small>查看明细</small></summary>
        <div className="today-points-list">
          <FormulaLine label="学习入账" value={`${detail.studyCredit} min`} />
          <FormulaLine label="运动入账" value={`${detail.exerciseCredit} min`} />
          <FormulaLine label="时间价值转分" value={`+${formatPoints(bankPointsAdded)} 分`} />
          <FormulaLine label="睡眠积分" value={`${sleepAdjustmentPoints >= 0 ? "+" : ""}${formatPoints(sleepAdjustmentPoints)} 分`} />
          <FormulaLine label="运动额外积分" value={`${exerciseBonusPoints ? "+1 分" : "0 分"}`} />
          <FormulaLine label="工作积分" value={`+${formatPoints(workPoints)} 分`} />
          <FormulaLine label="日型额外奖励" value={`${dayTypeBonusPoints > 0 ? "+" : ""}${formatPoints(dayTypeBonusPoints)} 分`} />
          <FormulaLine label="自由娱乐积分" value={`${entertainmentScore.scoreDelta > 0 ? "+" : ""}${formatPoints(entertainmentScore.scoreDelta)} 分`} />
          <FormulaLine label="复盘归档奖励" value={`+${formatPoints(reviewTimelinessBonus)} 分`} />
        </div>
        <p className="field-help">工作 {workMinutes}min，按每50min=0.6分，单日上限4分。自由娱乐：{entertainmentScore.label}。</p>
      </details>
    </aside>
  );
}

const healthOptionSets = {
  mealStatus: [["", "未填写"], ["正常", "正常"], ["不规律", "不规律"], ["漏餐", "漏餐"]],
  waterStatus: [["", "未填写"], ["充足", "充足"], ["一般", "一般"], ["不足", "不足"]],
  caffeineStatus: [["", "未填写"], ["无", "无"], ["少量", "少量"], ["较多", "较多"]],
  basicSkincareDone: [["", "未填写"], ["完成", "完成"], ["未完成", "未完成"]],
  maskStatus: [["", "未填写"], ["已敷", "已敷"], ["跳过", "跳过"]],
  skinStatus: [["", "未填写"], ["稳定", "稳定"], ["干", "干"], ["油", "油"], ["爆痘", "爆痘"], ["敏感", "敏感"]],
};

const bodySignalOptions = ["头痛", "胃不舒服", "困倦", "眼疲劳", "腰背酸", "其他"];

function blankHealthForm() {
  return {
    mealStatus: "",
    waterStatus: "",
    caffeineStatus: "",
    bodySignals: [],
    basicSkincareDone: "",
    maskStatus: "",
    skinStatus: "",
    healthNote: "",
    maintenanceCompleted: [],
    period: { active: false, day: null, flow: "", discomfort: "", note: "" },
  };
}

function mergeHealthForm(health = {}) {
  return {
    ...blankHealthForm(),
    ...health,
    mealStatus: health.mealStatus || health.meals || "",
    waterStatus: health.waterStatus || health.water || "",
    caffeineStatus: health.caffeineStatus || health.caffeine || "",
    basicSkincareDone: health.basicSkincareDone || health.skincare || "",
    skinStatus: health.skinStatus || health.skinState || "",
    bodySignals: Array.isArray(health.bodySignals) ? health.bodySignals : [],
    maintenanceCompleted: Array.isArray(health.maintenanceCompleted) ? health.maintenanceCompleted : [],
    period: { ...blankHealthForm().period, ...(health.period || {}) },
  };
}

function mergeHealthMaintenanceItems(items = []) {
  return mergeLifeMaintenanceItems(items);
}

function activePeriodState(cycle = {}, date = todayIsoDate()) {
  if (cycle.status !== "active" || !cycle.startedOn) return { active: false, day: null };
  const start = new Date(`${cycle.startedOn}T00:00:00`);
  const current = new Date(`${date}T00:00:00`);
  return { active: true, day: Math.max(1, Math.floor((current - start) / 86400000) + 1) };
}

export class ReviewParsePreviewBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { hasError: false, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error) {
    console.error("Review preview failed to render", error);
  }

  render() {
    if (this.state.hasError) return <div className="review-action-message error" role="alert">复盘预览加载失败</div>;
    return this.props.children;
  }
}

export function ReviewParsePreview({ parsed }) {
  const subjects = asRecord(parsed?.subjects);
  const projects = asArray(parsed?.projects);
  const ieltsSkills = asRecord(subjects.ielts?.skills);
  const warnings = reviewValueLines(parsed?.durationWarnings);
  const unrecognized = asArray(parsed?.unrecognized);
  return (
    <details className="parse-preview" open>
      <summary>识别预览：{parsed.reviewDate} · 学习 {parsed.studyMinutes || 0}min</summary>
      <div className="parse-preview-grid">
        <InfoLine label="学习" value={Object.values(subjects).filter((item) => item?.name).map((item) => `${item.name} ${item.minutes || 0}min`).join("；")} />
        <InfoLine label="项目" value={projects.length ? projects.map((item) => `${item.name} ${item.minutes || 0}min`).join("；") : "未填写"} />
        <InfoLine label="工作" value={reviewValueText(subjects.work?.progress) || "未填写"} />
        <InfoLine label="家庭与杂项" value={[...reviewValueLines(subjects.family?.progress), ...reviewValueLines(subjects.misc?.progress)].join("；") || "未填写"} />
        <InfoLine label="睡眠与娱乐" value={`${parsed.sleepDuration || "未填写"}；娱乐 ${parsed.totalEntertainmentMinutes || 0}min`} />
        <InfoLine label="状态与评分" value={[parsed.state?.energy && `精力 ${parsed.state.energy}`, parsed.state?.mood && `情绪 ${parsed.state.mood}`, parsed.state?.studyQuality && `学习质量 ${parsed.state.studyQuality}`].filter(Boolean).join("；") || "未填写"} />
      </div>
      {Object.keys(ieltsSkills).length > 0 && <p className="field-help">雅思：{Object.entries(ieltsSkills).map(([name, item]) => `${name} ${item?.minutes || 0}min${item?.text ? `（${item.text}）` : ""}`).join("；")}</p>}
      {(unrecognized.length > 0 || warnings.length > 0) && <div className="field-help">新内容 / 提示：{[...unrecognized.map((item) => item?.title || String(item || "")), ...warnings].filter(Boolean).join("；")}</div>}
      <p className="field-help">原始 Markdown 会随结算保存；身体维护与经期不属于 Markdown 预览。</p>
    </details>
  );
}

function HealthQuickCards({ health, items, periodCycle, reviewDate, onChange, onSaveProfile, maskCycle }) {
  const value = mergeHealthForm(health);
  const visibleItems = mergeHealthMaintenanceItems(items).filter((item) => item.hidden !== true);
  const period = activePeriodState(periodCycle, reviewDate);
  const [undoCycle, setUndoCycle] = useState(null);
  const update = (patch) => onChange({ ...value, ...patch });
  const toggleMaintenance = (id) => {
    const completed = new Set(value.maintenanceCompleted || []);
    if (completed.has(id)) completed.delete(id); else completed.add(id);
    update({ maintenanceCompleted: [...completed] });
  };
  const updatePeriod = (patch) => update({ period: { ...value.period, ...patch } });
  const startPeriod = () => {
    const next = { status: "active", startedOn: reviewDate, endedOn: "" };
    onSaveProfile?.({ periodCycle: next });
    updatePeriod({ active: true, day: 1 });
  };
  const endPeriod = () => {
    setUndoCycle(periodCycle);
    onSaveProfile?.({ periodCycle: { ...periodCycle, status: "inactive", endedOn: reviewDate } });
    updatePeriod({ active: false, day: null });
  };
  const undoEnd = () => {
    if (!undoCycle) return;
    onSaveProfile?.({ periodCycle: undoCycle });
    updatePeriod({ active: true, day: activePeriodState(undoCycle, reviewDate).day });
    setUndoCycle(null);
  };
  return (
    <section className="health-quick-section">
      <div className="health-quick-heading"><div><strong>身体维护</strong><small>只记录当天是否完成，不参与 Markdown 识别或积分。</small></div></div>
      <div className="health-quick-cards">
        {visibleItems.map((item) => <button key={item.id} type="button" className={(value.maintenanceCompleted || []).includes(item.id) ? "active" : ""} onClick={() => toggleMaintenance(item.id)}>{(value.maintenanceCompleted || []).includes(item.id) ? "✓ " : ""}{item.name}</button>)}
      </div>
      <section className={`period-card ${period.active ? "active" : "collapsed"}`}>
        <div className="settlement-switch-card"><div><span>经期状态</span><strong>{period.active ? `经期第 ${period.day} 天` : "非经期"}</strong><small>{period.active ? "持续到你手动结束为止。" : "开启后自动展开并从今天计为第 1 天。"}</small></div><label><input type="checkbox" checked={period.active} onChange={(event) => event.target.checked ? startPeriod() : endPeriod()} />经期中</label></div>
        {period.active && <div className="two-column-fields"><SelectField label="经量（可空）" value={value.period.flow || ""} onChange={(next) => updatePeriod({ flow: next })} options={[["", "未填写"], ["少", "少"], ["中", "中"], ["多", "多"]]} /><SelectField label="不适（可空）" value={value.period.discomfort || ""} onChange={(next) => updatePeriod({ discomfort: next })} options={[["", "未填写"], ["无", "无"], ["轻微", "轻微"], ["明显", "明显"], ["严重", "严重"]]} /><label className="field"><span>备注（可空）</span><input value={value.period.note || ""} onChange={(event) => updatePeriod({ note: event.target.value })} /></label></div>}
        {undoCycle && !period.active && <button className="text-button" type="button" onClick={undoEnd}>撤销结束</button>}
      </section>
      <p className="field-help">面膜周期：{maskCycle.message}</p>
    </section>
  );
}

function HealthSupplementEditor({ health, onChange, maskCycle }) {
  const value = mergeHealthForm(health);
  const update = (field, fieldValue) => onChange({ ...value, [field]: fieldValue });
  const toggleSignal = (signal) => {
    const current = new Set(value.bodySignals || []);
    if (current.has(signal)) current.delete(signal);
    else current.add(signal);
    update("bodySignals", [...current]);
  };
  return (
    <details className="health-supplement-panel">
      <summary>🫧 身体维护 / 健康洞悉补充</summary>
      <p className="field-help">可选填写，只用于健康洞悉和面膜周期提醒，不参与积分和 dayType。</p>
      <div className="two-column-fields">
        <SelectField label="三餐" value={value.mealStatus} onChange={(next) => update("mealStatus", next)} options={healthOptionSets.mealStatus} />
        <SelectField label="饮水" value={value.waterStatus} onChange={(next) => update("waterStatus", next)} options={healthOptionSets.waterStatus} />
        <SelectField label="咖啡因/奶茶" value={value.caffeineStatus} onChange={(next) => update("caffeineStatus", next)} options={healthOptionSets.caffeineStatus} />
        <SelectField label="基础护肤" value={value.basicSkincareDone} onChange={(next) => update("basicSkincareDone", next)} options={healthOptionSets.basicSkincareDone} />
        <SelectField label="面膜" value={value.maskStatus} onChange={(next) => update("maskStatus", next)} options={healthOptionSets.maskStatus} />
        <SelectField label="皮肤状态" value={value.skinStatus} onChange={(next) => update("skinStatus", next)} options={healthOptionSets.skinStatus} />
      </div>
      <div className="health-signal-grid">
        {bodySignalOptions.map((signal) => (
          <label key={signal} className="mini-check">
            <input type="checkbox" checked={(value.bodySignals || []).includes(signal)} onChange={() => toggleSignal(signal)} />
            <span>{signal}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span>健康备注</span>
        <textarea value={value.healthNote || ""} onChange={(event) => update("healthNote", event.target.value)} placeholder="可写身体信号、皮肤状态、恢复行为，留空也可以。" />
      </label>
      <p className="field-help">{maskCycle.message}</p>
    </details>
  );
}

function FormulaLine({ label, value }) {
  return (
    <div className="formula-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const PLANNER_PX_PER_MINUTE = 1.5;
const MAX_PLANNER_HISTORY = 20;

class SchedulePageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, diagnostic: null, copied: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    const diagnostic = buildPlannerErrorDiagnostic(error, info?.componentStack, this.props.diagnosticContext);
    console.error("Schedule page failed to render", diagnostic);
    this.setState({ diagnostic });
  }

  async copyDiagnostic() {
    const diagnostic = this.state.diagnostic;
    if (!diagnostic || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="panel wide schedule-error-panel">
          <p className="eyebrow">Daily Planner</p>
          <h2>Daily planner unavailable</h2>
          <p className="field-help">页面渲染时遇到异常。你的计划数据没有被清空，请刷新页面或稍后重新打开。</p>
          <p className="field-help">构建：{__DAILY_BUILD_INFO__.commit} · {__DAILY_BUILD_INFO__.builtAt}</p>
          {this.state.diagnostic && <p className="field-help">{this.state.diagnostic.errorName}：{this.state.diagnostic.errorMessage}</p>}
          <div className="modal-actions">
            <button className="secondary-button compact" type="button" onClick={() => this.copyDiagnostic()} disabled={!this.state.diagnostic}>{this.state.copied ? "诊断信息已复制" : "复制诊断信息"}</button>
            <button className="secondary-button compact" type="button" onClick={() => this.setState({ hasError: false, diagnostic: null, copied: false })}>重新加载排程页</button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

function plannerValueSummary(value) {
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (value && typeof value === "object") return { type: "object", count: Object.keys(value).length };
  return { type: value === null ? "null" : typeof value, count: 0 };
}

function buildPlannerDiagnosticContext(data) {
  const profile = asRecord(data?.profile);
  const draft = asRecord(profile.scheduleAssistantDraft);
  const settings = asRecord(profile.scheduleAssistantSettings);
  const templates = asArray(settings.dayTemplates);
  const taskPoolCount = asArray(draft.todayCustomBlocks).length + templates.reduce((count, template) => count + asArray(asRecord(template).content?.defaultTaskGroups).length, 0);
  return {
    build: __DAILY_BUILD_INFO__,
    targetDate: typeof draft.targetDate === "string" ? draft.targetDate : null,
    sourceMode: isFirebaseConfigured ? "firebase" : "demo",
    draftSchemaSummary: {
      draft: plannerValueSummary(profile.scheduleAssistantDraft),
      settings: plannerValueSummary(profile.scheduleAssistantSettings),
      fixedEvents: plannerValueSummary(draft.fixedEvents),
      timeline: plannerValueSummary(draft.timelineSegments),
      todayCustomBlocks: plannerValueSummary(draft.todayCustomBlocks),
      dayTemplates: plannerValueSummary(settings.dayTemplates),
      deletedDayTemplateSystemKeys: plannerValueSummary(settings.deletedDayTemplateSystemKeys),
    },
    timelineBlockCount: asArray(asRecord(draft.autoSchedule).blocks).length || null,
    taskPoolCount,
  };
}

function buildPlannerErrorDiagnostic(error, componentStack, context) {
  const top = (value) => String(value || "").split("\n").filter(Boolean).slice(0, 5).join("\n") || null;
  return {
    build: context?.build || __DAILY_BUILD_INFO__,
    errorName: String(error?.name || "Error"),
    errorMessage: String(error?.message || "Unknown planner render error"),
    stackTop: top(error?.stack),
    componentStackTop: top(componentStack),
    targetDate: context?.targetDate || null,
    sourceMode: context?.sourceMode || (isFirebaseConfigured ? "firebase" : "demo"),
    draftSchemaSummary: context?.draftSchemaSummary || {},
    timelineBlockCount: context?.timelineBlockCount ?? null,
    taskPoolCount: context?.taskPoolCount ?? 0,
  };
}

function ScheduleAssistant({ data, onSaveProfile, onAgentSnapshot, onSnapshotPersisted, snapshotSyncIssue, onOpenSettlement }) {
  const plannerFeatureFlags = useMemo(() => readPlannerFeatureFlags(), []);
  const autoContext = useMemo(() => buildScheduleAutoContext(data), [data]);
  const [beijingDay, setBeijingDay] = useState(() => beijingIsoDate());
  const snapshotReasonRef = useRef("plan_updated");
  const [currentBeijingMinute, setCurrentBeijingMinute] = useState(() => beijingDayMinutes());
  const [settings, setSettings] = useState(() => mergeScheduleSettings(data.profile.scheduleAssistantSettings));
  const classificationTaxonomy = useMemo(() => normalizeClassificationTaxonomy(data.profile.classificationTaxonomy), [data.profile.classificationTaxonomy]);
  // plannerCategoryColors is a stored profile setting keyed by categoryId; that key
  // may still be a pre-v3 legacy id even after classificationTaxonomy itself has
  // been migrated to canonical ids. Normalize the keys once here so timeline blocks,
  // the task pool, and PlannerOverview all keep resolving colors for renamed categories.
  const categoryColors = useMemo(() => {
    const raw = data.profile.plannerCategoryColors || {};
    const normalized = {};
    Object.keys(raw).forEach((categoryId) => {
      const canonicalId = normalizeCategoryId(categoryId);
      if (!(canonicalId in normalized)) normalized[canonicalId] = raw[categoryId];
    });
    return normalized;
  }, [data.profile.plannerCategoryColors]);
  const [draft, setDraft] = useState(() => makeScheduleDraft(data.profile.scheduleAssistantDraft, data.profile.scheduleAssistantSettings, autoContext));
  const [scheduleDraftArchive, setScheduleDraftArchive] = useState(() => normalizeScheduleDraftArchive(data.profile.scheduleAssistantDraftArchive));
  const [generatedPrompt, setGeneratedPrompt] = useState(() => shouldReuseScheduleDraft(data.profile.scheduleAssistantDraft) ? data.profile.scheduleAssistantDraft?.generatedPrompt || "" : "");
  const [saveState, setSaveState] = useState("已载入");
  const [lastSavedAt, setLastSavedAt] = useState(() => data.profile.scheduleAssistantDraft?.updatedAt || "");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [uploadState, setUploadState] = useState("");
  const [uploadChoiceOpen, setUploadChoiceOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editingMorningRoutine, setEditingMorningRoutine] = useState(null);
  const [morningRoutineConflict, setMorningRoutineConflict] = useState(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [dropPreview, setDropPreview] = useState(null);
  const previewPlanRef = useRef(null);
  const [editingFixedEvent, setEditingFixedEvent] = useState(null);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templateSaveDialog, setTemplateSaveDialog] = useState(null);
  const [templateApplyDialog, setTemplateApplyDialog] = useState(null);
  const [plannerAdvancedOpen, setPlannerAdvancedOpen] = useState(false);
  const [maintenanceManagerOpen, setMaintenanceManagerOpen] = useState(false);
  const [categoryTargetManagerOpen, setCategoryTargetManagerOpen] = useState(false);
  const [reviewTrackerManagerOpen, setReviewTrackerManagerOpen] = useState(false);
  const [categoryOrderManagerOpen, setCategoryOrderManagerOpen] = useState(false);
  const [futurePlanDays, setFuturePlanDays] = useState(3);
  const [plannerPast, setPlannerPast] = useState([]);
  const [plannerFuture, setPlannerFuture] = useState([]);
  const [lastPlannerAction, setLastPlannerAction] = useState("");
  const [recoveryDialog, setRecoveryDialog] = useState(null);
  const [dragConflict, setDragConflict] = useState(null);
  const [taskMoveSheet, setTaskMoveSheet] = useState(null);
  const timelineRef = useRef(null);
  const dragGrabOffsetRef = useRef(0);
  const dragPointerYRef = useRef(null);
  const dragPointerListenerRef = useRef(null);
  const initializedRef = useRef(false);
  const persistenceTimerRef = useRef(null);
  const previousBeijingDayRef = useRef(beijingDay);
  const profileIdRef = useRef(data.profile.id);
  const saveProfileRef = useRef(onSaveProfile);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    saveProfileRef.current = onSaveProfile;
  }, [onSaveProfile]);

  useEffect(() => {
    const refreshClock = () => {
      setBeijingDay((current) => {
        const next = beijingIsoDate();
        return current === next ? current : next;
      });
      setCurrentBeijingMinute(beijingDayMinutes());
    };
    const timer = window.setInterval(refreshClock, 15 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextSettings = mergeScheduleSettings(data.profile.scheduleAssistantSettings);
    const isNewCalendarDay = profileIdRef.current === data.profile.id && previousBeijingDayRef.current !== beijingDay;
    const savedDraftNeedsArchive = data.profile.scheduleAssistantDraft?.targetDate && !shouldReuseScheduleDraft(data.profile.scheduleAssistantDraft);
    const recoveryTargetDate = data.profile.scheduleAssistantDraft?.targetDate || beijingIsoDate(1);
    const localRecovery = plannerFeatureFlags.localRecovery ? loadPlannerRecovery(data.profile.id || "demo", recoveryTargetDate) : null;
    const newest = isNewCalendarDay
      ? { source: "remote" }
      : chooseNewestPlannerState(data.profile.scheduleAssistantDraft, localRecovery, beijingDay);
    const recoveredDraft = newest.source === "local" ? localRecovery?.draft : data.profile.scheduleAssistantDraft;
    if (isNewCalendarDay || savedDraftNeedsArchive) {
      setScheduleDraftArchive((current) => archivePlannerDraft(
        current,
        isNewCalendarDay ? draft : data.profile.scheduleAssistantDraft,
        isNewCalendarDay ? previousBeijingDayRef.current : data.profile.scheduleAssistantDraft?.savedOn || previousBeijingDayRef.current
      ));
    } else if (profileIdRef.current !== data.profile.id) {
      setScheduleDraftArchive(normalizeScheduleDraftArchive(data.profile.scheduleAssistantDraftArchive));
    }
    previousBeijingDayRef.current = beijingDay;
    profileIdRef.current = data.profile.id;
    const recoveredSettings = newest.source === "local" ? mergeScheduleSettings(localRecovery?.settings) : nextSettings;
    setSettings(recoveredSettings);
    setDraft(makeScheduleDraft(recoveredDraft, recoveredSettings, autoContext));
    setScheduleDraftArchive(normalizeScheduleDraftArchive(newest.source === "local" ? localRecovery?.scheduleDraftArchive : data.profile.scheduleAssistantDraftArchive));
    setGeneratedPrompt(shouldReuseScheduleDraft(recoveredDraft) ? recoveredDraft?.generatedPrompt || "" : "");
    setLastSavedAt(recoveredDraft?.updatedAt || "");
    setHasUnsavedChanges(newest.source === "local");
    setSaveState(newest.source === "local" ? "已从本机恢复，待同步" : "已载入");
  }, [data.profile.id, beijingDay, plannerFeatureFlags.localRecovery]);

  const safeMathTemplates = Array.isArray(settings.mathTemplates) && settings.mathTemplates.length ? settings.mathTemplates : defaultMathTemplates;
  const safeEnglishTemplates = Array.isArray(settings.englishTemplates) && settings.englishTemplates.length ? settings.englishTemplates : defaultEnglishTemplates;
  const safeDayTemplates = Array.isArray(settings.dayTemplates) && settings.dayTemplates.length ? settings.dayTemplates : normalizePlannerTemplates([]);
  const selectedTemplate = safeMathTemplates.find((item) => item.id === draft.mathTemplateId) || safeMathTemplates[0];
  const selectedEnglishTemplate = safeEnglishTemplates.find((item) => item.id === draft.englishTemplateId) || safeEnglishTemplates[0];
  const currentPlannerTemplate = safeDayTemplates.find((item) => item.id === draft.sourceTemplateId) || safeDayTemplates.find((item) => item.id === settings.defaultDayTemplateId) || safeDayTemplates[0];
  const englishSkills = useMemo(
    () => resolveEnglishSkills(draft, settings, data.settlements, selectedEnglishTemplate),
    [draft, settings, data.settlements, selectedEnglishTemplate]
  );
  const effectiveMorningPrepMinutes = resolveMorningPrepMinutes(draft);
  // 生活维护只从复盘健康字段派生提醒；不会作为任务池或时间线块参与排程。
  const showerPlan = useMemo(() => ({ shouldShower: false, reason: "生活维护不自动排入时间线" }), []);
  const maskPlan = useMemo(() => ({ shouldSchedule: false, suggestedTime: "", reason: "生活维护不自动排入时间线" }), []);
  const plannerDraft = useMemo(
    () => plannerFeatureFlags.dynamicContinuousBlocks ? draft : { ...draft, formalRestBlocks: 1 },
    [draft, plannerFeatureFlags.dynamicContinuousBlocks]
  );
  const scheduleEstimate = estimateScheduleDuration(plannerDraft, selectedTemplate, selectedEnglishTemplate, effectiveMorningPrepMinutes, showerPlan, maskPlan);
  const autoSchedule = useMemo(
    () => buildAutoSchedulePlan({
      draft: plannerDraft,
      mathTemplate: selectedTemplate,
      englishTemplate: selectedEnglishTemplate,
      englishSkills,
      autoContext,
      effectiveMorningPrepMinutes,
      showerPlan,
      maskPlan,
    }),
    [plannerDraft, selectedTemplate, selectedEnglishTemplate, englishSkills, autoContext, effectiveMorningPrepMinutes, showerPlan, maskPlan]
  );
  const plannerCategoryCatalog = useMemo(
    () => buildPlannerCategoryCatalog({ taxonomy: classificationTaxonomy, tasks: autoSchedule.taskGroups, savedOrder: data.profile.plannerCategoryOrder }),
    [classificationTaxonomy, autoSchedule.taskGroups, data.profile.plannerCategoryOrder]
  );
  const currentAgentSnapshot = useMemo(
    () => plannerFeatureFlags.agentSnapshot ? safeBuildAgentDaySnapshotFromDailyData({
      plan: { ...autoSchedule, targetDate: draft.targetDate },
      profile: data.profile,
      classificationTaxonomy,
      settlements: data.settlements,
      sourceMode: isFirebaseConfigured ? "firebase" : "demo",
      now: new Date(),
    }) : null,
    [plannerFeatureFlags.agentSnapshot, autoSchedule, draft.targetDate, data.profile, data.settlements, currentBeijingMinute]
  );
  const plannerBoundaries = useMemo(() => resolvePlannerBoundaryCards(autoSchedule), [autoSchedule]);
  const maintenanceItemOrder = useMemo(
    () => normalizeMaintenanceItemOrder(data.profile.maintenanceItemOrder, data.profile.healthMaintenanceItems),
    [data.profile.maintenanceItemOrder, data.profile.healthMaintenanceItems]
  );
  const lifeMaintenance = useMemo(
    () => buildLifeMaintenanceSummary({ items: data.profile.healthMaintenanceItems, settlements: data.settlements, today: beijingDay, order: maintenanceItemOrder }),
    [data.profile.healthMaintenanceItems, data.settlements, beijingDay, maintenanceItemOrder]
  );
  const plannerCategoryOrder = useMemo(
    () => normalizePlannerCategoryOrder(data.profile.plannerCategoryOrder, plannerCategoryCatalog.map((category) => category.id)),
    [data.profile.plannerCategoryOrder, plannerCategoryCatalog]
  );
  const categoryTargets = draft.categoryTargets && typeof draft.categoryTargets === "object" ? draft.categoryTargets : {};
  const reviewTrackers = useMemo(() => normalizeReviewTrackers(data.profile.reviewTrackers, data.profile.healthMaintenanceItems), [data.profile.reviewTrackers, data.profile.healthMaintenanceItems]);
  const reviewTrackerSummaries = useMemo(() => reviewTrackers.filter((tracker) => tracker.paused !== true).map((tracker, orderIndex) => ({ ...tracker, orderIndex, ...buildReviewTrackerSummary({ tracker, settlements: data.settlements, dayPlans: [{ date: draft.targetDate, blocks: autoSchedule.blocks }], today: beijingDay }) })).sort((left, right) => compareReviewTrackerStatus(left, right) || left.orderIndex - right.orderIndex), [reviewTrackers, data.settlements, draft.targetDate, autoSchedule.blocks, beijingDay]);
  useEffect(() => {
    if (plannerFeatureFlags.agentSnapshot) onAgentSnapshot?.(currentAgentSnapshot);
  }, [plannerFeatureFlags.agentSnapshot, currentAgentSnapshot, onAgentSnapshot]);
  useEffect(() => {
    if (!import.meta.env.DEV || !plannerFeatureFlags.agentSnapshot) return undefined;
    window.getDailyAgentDaySnapshot = () => currentAgentSnapshot;
    return () => {
      delete window.getDailyAgentDaySnapshot;
    };
  }, [plannerFeatureFlags.agentSnapshot, currentAgentSnapshot]);
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__dailyPlannerFeatureFlags = plannerFeatureFlags;
    return () => {
      delete window.__dailyPlannerFeatureFlags;
    };
  }, [plannerFeatureFlags]);
  const segmentGoals = useMemo(() => buildSegmentGoals(scheduleEstimate.studyMinutes), [scheduleEstimate.studyMinutes]);
  function buildPlannerPersistencePayload(updatedAt = new Date().toISOString()) {
    const savedDraft = unifyPlannerDraftCards({
      ...draft,
      segmentGoals,
      reviewPrefill: buildReviewPrefillFromBlocks(autoSchedule.blocks, draft.targetDate),
      generatedPrompt,
      savedOn: draft.targetDate,
      updatedAt,
    });
    return {
      scheduleAssistantSettings: settings,
      scheduleAssistantDraft: savedDraft,
      scheduleAssistantDraftArchive: scheduleDraftArchive,
      scheduleSegmentGoals: upsertScheduleSegmentGoalEntry(data.profile.scheduleSegmentGoals, draft.targetDate, segmentGoals),
    };
  }

  async function persistPlannerNow(mode = "manual") {
    if (persistenceTimerRef.current) window.clearTimeout(persistenceTimerRef.current);
    const updatedAt = new Date().toISOString();
    const payload = buildPlannerPersistencePayload(updatedAt);
    savePlannerRecovery(data.profile.id || "demo", {
      draft: payload.scheduleAssistantDraft,
      settings: payload.scheduleAssistantSettings,
      scheduleDraftArchive: payload.scheduleAssistantDraftArchive,
      updatedAt,
    }, payload.scheduleAssistantDraft.targetDate);
    setHasUnsavedChanges(true);
    setSaveState(mode === "manual" ? "正在手动保存..." : "正在自动保存...");
    try {
      await saveProfileRef.current(payload);
      setLastSavedAt(updatedAt);
      setHasUnsavedChanges(false);
      onSnapshotPersisted?.({
        ...currentAgentSnapshot,
        generatedAt: updatedAt,
        planUpdatedAt: updatedAt,
        source: { ...currentAgentSnapshot?.source, revision: updatedAt },
      }, snapshotReasonRef.current);
      snapshotReasonRef.current = "plan_updated";
      setSaveState(mode === "manual" ? "已手动保存" : "已自动保存");
      return true;
    } catch {
      setSaveState(mode === "manual" ? "手动保存失败，已保留本机恢复副本" : "自动保存失败，已保留本机恢复副本");
      return false;
    }
  }

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (!draft._morningRoutineMigrationPending) return undefined;
    }
    if (!plannerFeatureFlags.autosave) return undefined;
    const updatedAt = new Date().toISOString();
    const payload = buildPlannerPersistencePayload(updatedAt);
    savePlannerRecovery(data.profile.id || "demo", {
      draft: payload.scheduleAssistantDraft,
      settings: payload.scheduleAssistantSettings,
      scheduleDraftArchive: payload.scheduleAssistantDraftArchive,
      updatedAt,
    }, payload.scheduleAssistantDraft.targetDate);
    setHasUnsavedChanges(true);
    setSaveState("本机已保护，等待自动保存...");
    persistenceTimerRef.current = window.setTimeout(() => {
      persistPlannerNow("auto");
    }, 1000);
    return () => {
      if (persistenceTimerRef.current) window.clearTimeout(persistenceTimerRef.current);
    };
  }, [plannerFeatureFlags.autosave, settings, draft, generatedPrompt, scheduleDraftArchive, segmentGoals]);

  useEffect(() => () => {
    if (persistenceTimerRef.current) window.clearTimeout(persistenceTimerRef.current);
  }, []);
  const recoveryPreview = useMemo(
    () => recoveryDialog ? buildPlannerRecoveryPreview(autoSchedule, clockToDayMinutes(recoveryDialog.cutoffTime)) : null,
    [autoSchedule, recoveryDialog]
  );

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function switchPlannerTargetDate(targetDate) {
    if (!targetDate || targetDate === draft.targetDate) return;
    const updatedAt = new Date().toISOString();
    const currentSavedDraft = unifyPlannerDraftCards({
      ...draft,
      segmentGoals,
      reviewPrefill: buildReviewPrefillFromBlocks(autoSchedule.blocks, draft.targetDate),
      generatedPrompt,
      savedOn: draft.targetDate,
      updatedAt,
    });
    const archivedCurrent = archivePlannerDraft(scheduleDraftArchive, currentSavedDraft, draft.targetDate);
    savePlannerRecovery(data.profile.id || "demo", {
      draft: currentSavedDraft,
      settings,
      scheduleDraftArchive: archivedCurrent,
      updatedAt,
    }, currentSavedDraft.targetDate);

    const localRecovery = plannerFeatureFlags.localRecovery ? loadPlannerRecovery(data.profile.id || "demo", targetDate) : null;
    const remoteSameDate = (data.profile.scheduleAssistantDraft?.targetDate || data.profile.scheduleAssistantDraft?.savedOn) === targetDate
      ? data.profile.scheduleAssistantDraft
      : null;
    const archiveWithLocal = mergeScheduleDraftArchives(archivedCurrent, localRecovery?.scheduleDraftArchive, data.profile.scheduleAssistantDraftArchive);
    const archivedDraft = findScheduleDraftByDate(archiveWithLocal, targetDate);
    const newest = chooseNewestPlannerState(remoteSameDate || archivedDraft || { targetDate }, localRecovery, beijingDay);
    const restoredDraft = newest.source === "local" ? localRecovery?.draft : newest.draft;
    const restoredArchive = mergeScheduleDraftArchives(archiveWithLocal, newest.source === "local" ? localRecovery?.scheduleDraftArchive : []);
    setScheduleDraftArchive(restoredArchive);
    setDraft(makeScheduleDraft({ ...(restoredDraft || {}), targetDate }, settings, autoContext));
    setGeneratedPrompt(shouldReuseScheduleDraft(restoredDraft) ? restoredDraft?.generatedPrompt || "" : "");
    setLastSavedAt(restoredDraft?.updatedAt || "");
    setHasUnsavedChanges(true);
    setSaveState(`Switched to ${targetDate}; local drafts are date-isolated.`);
  }

  function updatePlannerTargetDate(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      switchPlannerTargetDate(value);
      return;
    }
    updateDraft("targetDate", value);
  }

  function patchDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function commitDraftChange(change, label = "已更新排程") {
    setDraft((current) => {
      const next = typeof change === "function" ? change(current) : { ...current, ...change };
      setPlannerPast((past) => [...past.slice(-(MAX_PLANNER_HISTORY - 1)), current]);
      setPlannerFuture([]);
      setLastPlannerAction(label);
      setSaveState(`${label} · 可撤销`);
      return next;
    });
  }

  function undoPlannerChange() {
    setPlannerPast((past) => {
      if (!past.length) return past;
      const previous = past[past.length - 1];
      setPlannerFuture((future) => [draft, ...future].slice(0, MAX_PLANNER_HISTORY));
      setDraft(previous);
      setSaveState("已撤销上一步排程修改");
      setLastPlannerAction("已撤销");
      return past.slice(0, -1);
    });
  }

  function redoPlannerChange() {
    setPlannerFuture((future) => {
      if (!future.length) return future;
      const next = future[0];
      setPlannerPast((past) => [...past.slice(-(MAX_PLANNER_HISTORY - 1)), draft]);
      setDraft(next);
      setSaveState("已恢复刚才撤销的排程修改");
      setLastPlannerAction("已恢复");
      return future.slice(1);
    });
  }

  function updateSettings(field, value) {
    setSettings((current) => ({ ...current, [field]: value }));
  }

  function updateEnglish(field, value) {
    setSettings((current) => ({
      ...current,
      englishRotationSettings: { ...current.englishRotationSettings, [field]: value },
    }));
  }

  function updateEnglishTemplate(field, value) {
    setSettings((current) => ({
      ...current,
      englishTemplates: current.englishTemplates.map((template) =>
        template.id === selectedEnglishTemplate.id ? { ...template, [field]: value } : template
      ),
    }));
  }

  function addEnglishTemplate(copyCurrent = false) {
    const source = copyCurrent ? selectedEnglishTemplate : defaultEnglishTemplates[0];
    const nextTemplate = {
      ...source,
      id: `english-template-${Date.now()}`,
      name: copyCurrent ? `${source.name} 副本` : "自定义英语日",
    };
    setSettings((current) => ({
      ...current,
      englishTemplates: [...current.englishTemplates, nextTemplate],
      defaultEnglishTemplateId: nextTemplate.id,
    }));
    updateDraft("englishTemplateId", nextTemplate.id);
  }

  function deleteEnglishTemplate() {
    if (settings.englishTemplates.length <= 1) return;
    const nextTemplates = settings.englishTemplates.filter((item) => item.id !== selectedEnglishTemplate.id);
    const nextId = nextTemplates[0].id;
    setSettings((current) => ({
      ...current,
      englishTemplates: nextTemplates,
      defaultEnglishTemplateId: current.defaultEnglishTemplateId === selectedEnglishTemplate.id ? nextId : current.defaultEnglishTemplateId,
    }));
    updateDraft("englishTemplateId", nextId);
  }

  function updateMathTemplate(field, value) {
    setSettings((current) => ({
      ...current,
      mathTemplates: current.mathTemplates.map((template) =>
        template.id === selectedTemplate.id ? { ...template, [field]: value } : template
      ),
    }));
  }

  function addMathTemplate(copyCurrent = false) {
    const source = copyCurrent ? selectedTemplate : defaultMathTemplates[0];
    const nextTemplate = {
      ...source,
      id: `math-template-${Date.now()}`,
      name: copyCurrent ? `${source.name} 副本` : "自定义数学日",
    };
    setSettings((current) => ({
      ...current,
      mathTemplates: [...current.mathTemplates, nextTemplate],
      defaultMathTemplateId: nextTemplate.id,
    }));
    updateDraft("mathTemplateId", nextTemplate.id);
  }

  function deleteMathTemplate() {
    if (settings.mathTemplates.length <= 1) return;
    const nextTemplates = settings.mathTemplates.filter((item) => item.id !== selectedTemplate.id);
    const nextId = nextTemplates[0].id;
    setSettings((current) => ({
      ...current,
      mathTemplates: nextTemplates,
      defaultMathTemplateId: current.defaultMathTemplateId === selectedTemplate.id ? nextId : current.defaultMathTemplateId,
    }));
    updateDraft("mathTemplateId", nextId);
  }

  function saveCurrentAsDefaults() {
    setSettings((current) => ({
      ...current,
      defaultWakeUpTime: draft.wakeUpTime,
      defaultBedTime: draft.targetBedTime,
      defaultScene: draft.scene,
      defaultLunchBlockMinutes: Number(draft.lunchBlockMinutes ?? 90),
      defaultDinnerMinutes: Number(draft.dinnerMinutes ?? 40),
      defaultStartupBufferMinutes: Number(draft.startupBufferMinutes ?? 20),
      defaultFormalRestMinutes: Number(draft.formalRestMinutes ?? 30),
      defaultFormalRestBlocks: Number(draft.formalRestBlocks ?? 1),
      defaultMorningPrepMinutes: Number(draft.morningPrepMinutes ?? 20),
      defaultShowerMinutes: Number(draft.showerMinutes ?? 25),
      defaultMaskMinutes: Number(draft.maskMinutes ?? 20),
      defaultMathTemplateId: draft.mathTemplateId,
      defaultEnglishTemplateId: draft.englishTemplateId,
      defaultThesisMinutes: Number(draft.thesisMinutes || 90),
      defaultProfessionalMinutes: Number(draft.professionalMinutes || 50),
      defaultSystemDevelopmentLimit: draft.systemDevelopmentLimit,
      defaultRestPreference: draft.restPreference,
    }));
  }

  function buildTemplateFromToday(name, scopes, templateId) {
    const baseContent = buildTemplateSnapshotContent({ draft, autoSchedule, scopes });
    const now = new Date().toISOString();
    return {
      id: templateId || `template-${Date.now()}`,
      isBuiltIn: false,
      name: name || "未命名模板",
      description: "",
      icon: "",
      content: normalizeTemplateContent(baseContent),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
  }

  function openSaveTemplate(template = null, onSaved) {
    setTemplateSaveDialog({
      templateId: template?.id || "",
      name: template?.name || `自定义模板 ${(settings.dayTemplates || []).length + 1}`,
      scopes: { ...defaultTemplateSaveScopes },
      onSaved,
    });
  }

  function saveTodayAsTemplate() {
    if (!templateSaveDialog) return;
    const target = settings.dayTemplates.find((template) => template.id === templateSaveDialog.templateId);
    const nextTemplate = buildTemplateFromToday(templateSaveDialog.name, templateSaveDialog.scopes, target?.id);
    if (target) {
      const previousContent = normalizeTemplateContent(target.content);
      const nextContent = normalizeTemplateContent(nextTemplate.content);
      nextTemplate.content = normalizeTemplateContent(mergeTemplateSnapshotContent(previousContent, nextContent, templateSaveDialog.scopes));
      nextTemplate.isBuiltIn = target.isBuiltIn;
      nextTemplate.systemKey = target.systemKey;
      nextTemplate.createdAt = target.createdAt;
      nextTemplate.revision = Number(target.revision || 1) + 1;
    }
    setSettings((current) => ({
      ...current,
      dayTemplates: target ? current.dayTemplates.map((template) => template.id === target.id ? nextTemplate : template) : [...(current.dayTemplates || []), nextTemplate],
    }));
    templateSaveDialog.onSaved?.(nextTemplate);
    setTemplateSaveDialog(null);
    const content = normalizeTemplateContent(nextTemplate.content);
    const summary = `固定节点 ${(content.fixedEvents || []).length} 项，任务池 ${(content.defaultTaskGroups || []).length} 项，时间线 ${(content.timelineSegments || []).length} 项`;
    setSaveState(target ? `已更新模板「${nextTemplate.name}」：${summary}。今天未改变` : `已保存模板「${nextTemplate.name}」：${summary}。今天未改变`);
  }

  function updateDayTemplate(templateId, nextTemplate) {
    setSettings((current) => ({
      ...current,
      dayTemplates: (current.dayTemplates || []).map((template) => template.id === templateId ? { ...clonePlannerValue(nextTemplate), updatedAt: new Date().toISOString(), revision: Number(template.revision || 1) + 1 } : template),
    }));
    setSaveState("模板已保存，今天的排程未改变");
  }

  function duplicateDayTemplate(template) {
    const now = new Date().toISOString();
    const copy = {
      ...clonePlannerValue(template),
      id: `template-${Date.now()}`,
      systemKey: undefined,
      isBuiltIn: false,
      isDefault: false,
      name: `${template.name} 副本`,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    setSettings((current) => ({ ...current, dayTemplates: [...(current.dayTemplates || []), copy] }));
    setSaveState(`已复制模板「${template.name}」`);
  }

  function createEmptyDayTemplate() {
    const now = new Date().toISOString();
    const template = {
      id: `template-${Date.now()}`,
      isBuiltIn: false,
      name: "新建空白模板",
      description: "",
      icon: "",
      content: normalizeTemplateContent({ wakeUpTime: "08:00", targetBedTime: "23:20", scene: "home", fixedEvents: [], defaultTaskGroups: [], timelineSegments: [] }),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    setSettings((current) => ({ ...current, dayTemplates: [...(current.dayTemplates || []), template] }));
    setSaveState("已新建空白模板，今天未改变");
    return template;
  }

  function restoreDayTemplate(template) {
    const factory = getFactoryPlannerTemplate(template.systemKey);
    if (!factory || !window.confirm(`恢复“${template.name}”的系统默认设置？\n\n你对该模板做过的修改将被覆盖。当前已排好的今日时间线不会发生变化。`)) return;
    const restored = createEditableTemplateFromSeed(factory);
    restored.id = template.id;
    restored.createdAt = template.createdAt;
    restored.revision = Number(template.revision || 1) + 1;
    setSettings((current) => ({ ...current, dayTemplates: current.dayTemplates.map((item) => item.id === template.id ? restored : item) }));
    setSaveState(`已恢复「${template.name}」的系统默认，今天未改变`);
  }

  function deleteDayTemplate(template) {
    if ((settings.dayTemplates || []).length <= 1) {
      window.alert("至少保留一个模板，才能继续作为默认模板和新建排程的起点。");
      return;
    }
    if (!template || !window.confirm(`删除“${template.name}”？\n\n该操作只会删除模板，不会影响已经生成的今日排程。`)) return;
    const remainingTemplates = (settings.dayTemplates || []).filter((item) => item.id !== template.id);
    const nextDefaultTemplateId = settings.defaultDayTemplateId === template.id
      ? remainingTemplates[0]?.id || ""
      : settings.defaultDayTemplateId;
    setSettings((current) => ({
      ...current,
      dayTemplates: (current.dayTemplates || []).filter((item) => item.id !== template.id),
      defaultDayTemplateId: nextDefaultTemplateId,
      deletedDayTemplateSystemKeys: template.systemKey
        ? [...new Set([...(current.deletedDayTemplateSystemKeys || []), template.systemKey])]
        : current.deletedDayTemplateSystemKeys || [],
    }));
    if (draft.sourceTemplateId === template.id) patchDraft({ sourceTemplateId: nextDefaultTemplateId });
    setSaveState(`已删除模板「${template.name}」`);
  }

  function openApplyTemplate(template) {
    setTemplateApplyDialog({ template, scopes: { boundaries: true, fixedEvents: true, defaultTasks: true, timeline: false } });
  }

  function applyDayTemplate() {
    if (!templateApplyDialog) return;
    const { template, scopes } = templateApplyDialog;
    commitDraftChange((current) => instantiateTemplateForDay(template, current, scopes), `已应用模板「${template.name}」`);
    setTemplateApplyDialog(null);
    setTemplateManagerOpen(false);
  }

  function addFixedEvent() {
    updateDraft("fixedEvents", [
      ...(draft.fixedEvents || []),
      { id: `event-${Date.now()}`, title: "", startTime: "", endTime: "", location: "", note: "", categoryId: "personal" },
    ]);
  }

  function updateFixedEvent(id, field, value) {
    updateDraft("fixedEvents", (draft.fixedEvents || []).map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function deleteFixedEvent(id) {
    updateDraft("fixedEvents", (draft.fixedEvents || []).filter((item) => item.id !== id));
  }

  function generatePrompt() {
    const prompt = buildSchedulePrompt({
      draft,
      settings,
      autoContext,
      mathTemplate: selectedTemplate,
      englishTemplate: selectedEnglishTemplate,
      englishSkills,
      effectiveMorningPrepMinutes,
      scheduleEstimate,
      autoSchedule,
      showerPlan,
      maskPlan,
    });
    setGeneratedPrompt(prompt);
  }

  async function copyPrompt() {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setSaveState("已复制 prompt");
  }

  function refreshTimeline() {
    setSaveState("已重新生成时间线");
  }

  function saveTaskOverride(taskId, patch) {
    commitDraftChange((current) => ({
      ...current,
      todayTaskOverrides: {
        ...(current.todayTaskOverrides || {}),
        [taskId]: {
          ...(current.todayTaskOverrides?.[taskId] || {}),
          ...patch,
        },
      },
    }), "已保存今天的任务调整");
    setEditingTask(null);
  }

  function saveSegmentOverride(blockId, patch) {
    commitDraftChange((current) => ({
      ...current,
      todaySegmentOverrides: {
        ...(current.todaySegmentOverrides || {}),
        [blockId]: {
          ...(current.todaySegmentOverrides?.[blockId] || {}),
          ...patch,
        },
      },
    }), "已保存当前块调整");
    setEditingTask(null);
  }

  function applyResizePlan(blockId, workMinutes) {
    const block = autoSchedule.blocks.find((item) => item.id === blockId);
    if (!block) return;
    if (isMorningRoutineCard(block)) {
      setEditingMorningRoutine(block);
      return;
    }
    const interaction = planTaskMove(autoSchedule, blockId, block.start, Math.max(5, Number(workMinutes || 0)) + Number(block.breakMinutes || 0));
    if (interaction.type === "hard-conflict") {
      setDragConflict({ active: { source: "timeline", blockId, duration: block.end - block.start, title: block.title, category: block.category }, preview: { start: block.start, end: block.start + Number(workMinutes || 0) + Number(block.breakMinutes || 0), conflict: true, conflictBlock: interaction.boundary } });
      return;
    }
    if (interaction.type === "noop") return;
    commitDraftChange((current) => ({ ...current, todaySegmentOverrides: { ...(current.todaySegmentOverrides || {}), ...Object.fromEntries(interaction.positions.map((item) => [item.id, { ...(current.todaySegmentOverrides?.[item.id] || {}), placement: "timeline", manualStart: item.start, ...(item.id === blockId ? { workMinutes: Number(workMinutes) } : {}) }])) } }), interaction.type === "success-ripple" ? `已调整为 ${workMinutes}+${block.breakMinutes}，并顺延 ${interaction.shifted.length} 项任务` : `已调整为 ${workMinutes}+${block.breakMinutes}`);
  }

  function morningRoutineMovePlan(startMinute, duration) {
    const morning = autoSchedule.blocks.find(isMorningRoutineCard);
    if (!morning) return { type: "missing" };
    const start = Math.max(0, Math.round(Number(startMinute) / 5) * 5);
    const end = start + Math.max(5, Number(duration || 0));
    const others = autoSchedule.blocks.filter((block) => block.id !== morning.id).sort((left, right) => left.start - right.start || left.end - right.end);
    const hardBeforeStart = others.find((block) => (block.kind === "fixed" || block.locked || block.status === "completed") && block.start < start);
    if (hardBeforeStart) return { type: "hard-conflict", blocker: hardBeforeStart, start, end, reason: "晨间卡必须位于第一张" };
    let cursor = end;
    const positions = [{ id: morning.id, start, end }];
    const shifted = [];
    for (const block of others) {
      if (block.start >= cursor) continue;
      if (block.kind === "fixed" || block.locked || block.status === "completed") return { type: "hard-conflict", blocker: block, start, end, reason: "后续卡无法安全顺延", positions, shifted };
      const next = { id: block.id, start: cursor, end: cursor + (block.end - block.start) };
      if (next.end > autoSchedule.timelineEnd) return { type: "hard-conflict", blocker: { title: "上床边界", start: autoSchedule.timelineEnd, end: autoSchedule.timelineEnd }, start, end, reason: "顺延后超出当天边界", positions, shifted };
      positions.push(next);
      shifted.push(next);
      cursor = next.end;
    }
    return { type: shifted.length ? "success-ripple" : "success-exact", start, end, positions, shifted, blocker: shifted.length ? autoSchedule.blocks.find((block) => block.id === shifted[0].id) : null, reason: shifted.length ? "将顺延已占用的后续任务" : "" };
  }

  function commitMorningRoutineMove(plan, duration, setDefault) {
    const morningId = autoSchedule.blocks.find(isMorningRoutineCard)?.id;
    commitDraftChange((current) => ({
      ...current,
      wakeUpTime: formatClockMinutes(plan.start),
      morningPrepMinutes: duration,
      todaySegmentOverrides: {
        ...(current.todaySegmentOverrides || {}),
        ...Object.fromEntries(plan.positions.map((item) => [item.id, {
          ...(current.todaySegmentOverrides?.[item.id] || {}),
          placement: "timeline",
          manualStart: item.start,
          ...(item.id === morningId ? { workMinutes: duration, locked: true } : {}),
        }])),
      },
    }), plan.type === "success-ripple" ? `已更新晨间洗漱，并顺延 ${plan.shifted.length} 张后续卡` : "已更新晨间洗漱");
    if (setDefault) setSettings((current) => ({ ...current, defaultWakeUpTime: formatClockMinutes(plan.start), defaultMorningPrepMinutes: duration }));
    setEditingMorningRoutine(null);
    setMorningRoutineConflict(null);
  }

  function saveMorningRoutine(startMinute, duration, setDefault) {
    const plan = morningRoutineMovePlan(startMinute, duration);
    if (plan.type === "hard-conflict" || plan.type === "missing" || plan.type === "success-ripple") {
      setMorningRoutineConflict({ plan, duration, setDefault });
      return;
    }
    commitMorningRoutineMove(plan, duration, setDefault);
  }

  function deleteTodayTask(taskId) {
    if ((draft.todayCustomBlocks || []).some((task) => task.id === taskId && isMorningRoutineCard(task))) {
      setSaveState("晨间洗漱是当天起点，不能删除");
      return;
    }
    commitDraftChange((current) => ({
      ...current,
      deletedTodayTaskIds: [...new Set([...(current.deletedTodayTaskIds || []), taskId])],
    }), "已删除今天这个任务");
  }

  function copyTodayTask(task) {
    if (!task) return;
    const id = `copy-${Date.now()}-${task.id}`;
    commitDraftChange((current) => ({ ...current, todayCustomBlocks: [...(current.todayCustomBlocks || []), { ...clonePlannerValue(task), id, title: `${task.title} 副本`, source: "today-copy", manualStart: null, locked: false, segmentOverrides: {} }] }), "已复制卡片到任务池");
    setEditingTask(null);
  }

  function generateFuturePlans() {
    const count = Math.max(1, Math.min(7, Number(futurePlanDays) || 1));
    const startDate = draft.targetDate >= beijingIsoDate() ? draft.targetDate : beijingIsoDate();
    const dates = Array.from({ length: count }, (_, index) => addIsoDays(startDate, index + 1));
    const assigned = allocateTasksAcrossDates(draft.todayCustomBlocks || [], dates);
    let nextArchive = archivePlannerDraft(scheduleDraftArchive, { ...draft, generatedPrompt, savedOn: draft.targetDate, updatedAt: new Date().toISOString() }, draft.targetDate);
    for (const targetDate of dates) {
      const futureDraft = makeScheduleDraft({
        ...draft,
        targetDate,
        savedOn: targetDate,
        updatedAt: new Date().toISOString(),
        todayCustomBlocks: assigned[targetDate],
        todayTaskOverrides: {},
        todaySegmentOverrides: {},
        deletedTodayTaskIds: [],
        taskPoolOrder: assigned[targetDate].map((task) => task.id),
      }, settings, autoContext);
      buildAutoSchedulePlan({ draft: futureDraft, mathTemplate: selectedTemplate, englishTemplate: selectedEnglishTemplate, englishSkills, autoContext, effectiveMorningPrepMinutes, showerPlan, maskPlan });
      nextArchive = archivePlannerDraft(nextArchive, futureDraft, targetDate);
    }
    setScheduleDraftArchive(nextArchive);
    setHasUnsavedChanges(true);
    setSaveState(`已为未来 ${count} 天生成独立草稿；自定义任务按稳定 ID 只分配一次`);
  }

  function moveSegmentToPool(blockId) {
    const block = autoSchedule.blocks.find((item) => item.id === blockId);
    if (isMorningRoutineCard(block)) {
      setSaveState("晨间洗漱必须留在时间线第一张");
      return;
    }
    saveSegmentOverride(blockId, { placement: "pool", manualStart: null, locked: false });
    setSaveState("当前任务已移回任务池");
  }

  function clearTaskPool() {
    const poolSegmentIds = autoSchedule.poolSegments.map((segment) => segment.blockId);
    if (!poolSegmentIds.length || !window.confirm(`清空任务池中待安排的 ${poolSegmentIds.length} 个分段？\n\n只影响今天的任务池，不会修改模板、已排入时间线的任务或历史记录。`)) return;
    commitDraftChange((current) => ({
      ...current,
      todaySegmentOverrides: {
        ...(current.todaySegmentOverrides || {}),
        ...Object.fromEntries(poolSegmentIds.map((id) => [id, { ...(current.todaySegmentOverrides?.[id] || {}), placement: "deleted", manualStart: null }])),
      },
    }), "已清空今天任务池");
  }

  function toggleSegmentLock(block) {
    if (block.categoryId === LIFE_CATEGORY_IDS.morningRoutine) return;
    saveSegmentOverride(block.id, { locked: !block.locked, placement: "timeline" });
    setSaveState(block.locked ? "已解锁位置 · 可撤销" : "已锁定位置 · 可撤销");
  }

  function openTaskMoveSheet(blockId, source = "timeline") {
    const segment = autoSchedule.taskSegments.find((item) => item.blockId === blockId);
    if (!segment) return;
    setTaskMoveSheet({ blockId, source, title: segment.segmentTitle, duration: segment.occupiedDuration, time: formatClockMinutes(autoSchedule.timelineStart) });
  }

  function requestTaskMove(blockId, startMinute, source = "timeline") {
    const segment = autoSchedule.taskSegments.find((item) => item.blockId === blockId);
    if (!segment) return;
    const start = Math.max(autoSchedule.timelineStart, Math.min(Number(startMinute), autoSchedule.timelineEnd - segment.occupiedDuration));
    const end = start + segment.occupiedDuration;
    const blocker = autoSchedule.blocks.find((block) => block.id !== blockId && intervalsOverlap({ start, end }, block));
    if (blocker) {
      const active = { source: source === "pool" ? "task-pool" : "timeline", blockId, taskId: segment.id, duration: segment.occupiedDuration, workMinutes: segment.duration, restMinutes: segment.breakAfter, title: segment.segmentTitle, category: segment.category, categoryId: segment.categoryId };
      setDragConflict({ active, nearestGap: findNearestPlannerGap(autoSchedule, active, start, Number(segment.duration || 0)), preview: { start, end, title: segment.segmentTitle, category: segment.category, conflict: true, conflictBlock: blocker, period: periodKeyForPlannerMinute(start) } });
      return;
    }
    saveSegmentOverride(blockId, { placement: "timeline", manualStart: start, preferredPeriods: [periodKeyForPlannerMinute(start)], locked: false, status: "pending" });
    setTaskMoveSheet(null);
    setSaveState(`已安排到 ${formatClockMinutes(start)} · 可撤销`);
  }

  function toggleSegmentCompletion(block) {
    snapshotReasonRef.current = "completion_changed";
    saveSegmentOverride(block.id, { status: block.status === "completed" ? "pending" : "completed" });
    setSaveState(block.status === "completed" ? "已恢复为待完成" : "已标记完成");
  }

  function defaultRecoveryCutoffTime() {
    const actualStart = clockToDayMinutes(draft.actualStartTime);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const isTodayPlan = draft.targetDate === beijingIsoDate();
    const useActualStart = Number.isFinite(actualStart) && (!isTodayPlan || nowMinutes < 12 * 60);
    const rawCutoff = useActualStart ? actualStart : isTodayPlan ? nowMinutes : autoSchedule.timelineStart;
    return formatClockMinutes(Math.max(autoSchedule.timelineStart, Math.min(rawCutoff, autoSchedule.timelineEnd)));
  }

  function openRecoveryPlanner() {
    setRecoveryDialog({ cutoffTime: defaultRecoveryCutoffTime() });
  }

  function applyRecoveryPlanner() {
    if (!recoveryPreview) return;
    commitDraftChange((current) => {
      const nextOverrides = { ...(current.todaySegmentOverrides || {}) };
      recoveryPreview.candidateSegments.forEach((segment) => {
        nextOverrides[segment.blockId] = {
          ...(nextOverrides[segment.blockId] || {}),
          placement: "pool",
          manualStart: null,
          locked: false,
        };
      });
      recoveryPreview.plannedSegments.forEach((segment) => {
        nextOverrides[segment.blockId] = {
          ...(nextOverrides[segment.blockId] || {}),
          placement: "timeline",
          manualStart: segment.start,
          locked: false,
        };
      });
      return { ...current, todaySegmentOverrides: nextOverrides };
    }, `已从 ${recoveryDialog.cutoffTime} 接着排`);
    setRecoveryDialog(null);
  }

  function clearFutureSchedule() {
    const cutoff = clockToDayMinutes(defaultRecoveryCutoffTime());
    const futureBlocks = autoSchedule.blocks.filter((block) => (
      block.kind === "task" &&
      block.start >= cutoff &&
      !block.locked &&
      block.status !== "completed"
    ));
    if (!futureBlocks.length) {
      setSaveState("未来没有可收回的普通任务");
      return;
    }
    commitDraftChange((current) => {
      const nextOverrides = { ...(current.todaySegmentOverrides || {}) };
      futureBlocks.forEach((block) => {
        nextOverrides[block.id] = {
          ...(nextOverrides[block.id] || {}),
          placement: "pool",
          manualStart: null,
          locked: false,
        };
      });
      return { ...current, todaySegmentOverrides: nextOverrides };
    }, `已清空未来，收回 ${futureBlocks.length} 段任务`);
  }

  function saveFixedEventOverride(eventId, patch) {
    const nextOverrides = {
      ...(draft.fixedEventOverrides || {}),
      [eventId]: {
        ...(draft.fixedEventOverrides?.[eventId] || {}),
        ...patch,
      },
    };
    const extraPatch = {};
    if (eventId === "wake-prep" && patch.startTime && patch.endTime) {
      extraPatch.morningPrepMinutes = Math.max(0, (clockToDayMinutes(patch.endTime) ?? 0) - (clockToDayMinutes(patch.startTime) ?? 0));
    }
    if (eventId === "bed-prep" && patch.endTime) {
      extraPatch.targetBedTime = patch.endTime;
    }
    if (eventId === "lunch" && patch.startTime && patch.endTime) {
      extraPatch.lunchStartTime = patch.startTime;
      extraPatch.lunchBlockMinutes = Math.max(0, (clockToDayMinutes(patch.endTime) ?? 0) - (clockToDayMinutes(patch.startTime) ?? 0));
    }
    commitDraftChange({ fixedEventOverrides: nextOverrides, ...extraPatch }, "已保存固定事件修改");
    setEditingFixedEvent(null);
  }

  function resolveDragPointerY(event) {
    if (Number.isFinite(dragPointerYRef.current)) return dragPointerYRef.current;
    const rectState = event.active?.rect?.current;
    const renderedTop = rectState?.translated?.top ?? rectState?.initial?.top;
    return Number.isFinite(renderedTop) ? renderedTop + dragGrabOffsetRef.current : null;
  }

  function calculateDragPreview(event) {
    if (!timelineRef.current || !event.active?.data?.current) return null;
    const active = event.active.data.current;
    const rectState = event.active.rect.current;
    const translated = rectState?.translated;
    const initial = rectState?.initial;
    const rect = timelineRef.current.getBoundingClientRect();
    const duration = Number(active.duration || 50);
    let boundedStart;
    let end;

    if (active.source === "task-pool") {
      const target = calculatePoolDropTarget({
        pointerClientY: resolveDragPointerY(event),
        timelineTop: rect.top,
        timelineScrollTop: timelineRef.current.scrollTop || 0,
        timelineStartMinutes: autoSchedule.timelineStart,
        timelineEndMinutes: autoSchedule.timelineEnd,
        pxPerMinute: PLANNER_PX_PER_MINUTE,
        durationMinutes: duration,
      });
      if (!target) {
        if (import.meta.env.DEV) {
          console.error("INVALID_POOL_DROP_TIME", {
            pointerClientY: dragPointerYRef.current,
            timelineRect: rect,
            timelineScrollTop: timelineRef.current.scrollTop || 0,
            pxPerMinute: PLANNER_PX_PER_MINUTE,
            duration,
            dragContext: active,
          });
        }
        return null;
      }
      ({ start: boundedStart, end } = target);
    } else {
      if (!translated && !initial) return null;
      const grabOffsetY = dragGrabOffsetRef.current;
      const pointerY = translated ? translated.top + grabOffsetY : initial.top + grabOffsetY;
      const start = calculateDropTime({
        pointerClientY: pointerY,
        timelineRectTop: rect.top,
        timelineScrollTop: timelineRef.current.scrollTop || 0,
        grabOffsetY,
        timelineStartMinutes: autoSchedule.timelineStart,
        pxPerMinute: PLANNER_PX_PER_MINUTE,
      });
      boundedStart = Math.max(autoSchedule.timelineStart, Math.min(start, autoSchedule.timelineEnd - duration));
      end = boundedStart + duration;
    }
    if (!Number.isFinite(boundedStart) || !Number.isFinite(end)) return null;
    const activeBlockId = active.blockId;
    const origin = autoSchedule.blocks.find((block) => block.id === activeBlockId);
    const conflictBlock = autoSchedule.blocks.find((block) => block.id !== activeBlockId && intervalsOverlap({ start: boundedStart, end }, block));
    return {
      start: boundedStart,
      end,
      title: active.title || "任务块",
      category: active.category || "生活",
      categoryId: active.categoryId,
      workMinutes: Number(active.workMinutes ?? duration),
      restMinutes: Number(active.restMinutes || 0),
      period: periodKeyForPlannerMinute(boundedStart),
      deltaMinutes: origin ? boundedStart - origin.start : null,
      conflict: Boolean(conflictBlock),
      conflictBlock,
    };
  }

  function buildInteractionPlan(event) {
    const active = event.active?.data?.current;
    const overId = String(event.over?.id || "");
    if (active?.source === "task-pool" && overId !== "timeline" && !overId.startsWith("insert-")) return null;
    const preview = calculateDragPreview(event);
    if (!active || !preview || !["task-pool", "timeline"].includes(active.source)) return null;
    let targetStart = preview.start;
    let insertionLabel = "";
    let allowRipple = false;
    let intent = "exact";
    if (overId.startsWith("insert-")) {
      const target = autoSchedule.blocks.find((block) => block.id === overId.replace("insert-", ""));
      if (target) {
        const pointerY = resolveDragPointerY(event);
        const ratio = event.over?.rect?.height ? (pointerY - event.over.rect.top) / event.over.rect.height : 0.5;
        const sameLength = Math.abs((target.end - target.start) - (preview.end - preview.start)) < 0.01;
        const canSwap = sameLength && target.kind === "task" && !target.locked && target.status !== "completed";
        const position = canSwap ? (ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "swap") : (ratio < 0.5 ? "before" : "after");
        if (position === "swap") {
          const result = active.source === "task-pool"
            ? planPoolTaskSwap(autoSchedule, active.blockId, target.id)
            : planTaskSwap(autoSchedule, active.blockId, target.id);
          if (["success-swap", "success-pool-swap"].includes(result.type)) {
            const activePosition = result.positions.find((item) => item.id === active.blockId);
            return {
              ...preview,
              ...activePosition,
              type: "swap",
              activeSegmentId: active.blockId,
              positions: result.positions,
              returnedToPool: result.returnedToPool || [],
              shifted: [],
              conflict: false,
              insertionLabel: active.source === "task-pool"
                ? `替换“${target.title}”，并将它移回任务池`
                : `与“${target.title}”交换位置`,
            };
          }
        } else {
          targetStart = position === "before" ? target.start : target.end;
          intent = position === "before" ? "insert-before" : "insert-after";
          insertionLabel = position === "before" ? `插入“${target.title}”之前` : `插入“${target.title}”之后`;
        }
      }
    }
    const result = planTaskMove(autoSchedule, active.blockId, targetStart, undefined, allowRipple, true);
    if (!result || result.type === "noop") return { ...preview, type: "noop", activeSegmentId: active.blockId };
    if (["hard-conflict", "needs-compression"].includes(result.type)) return { ...preview, type: result.type, activeSegmentId: active.blockId, conflict: true, conflictBlock: result.boundary, availableMinutes: result.availableMinutes, gapEnd: result.gapEnd, requestedWork: result.requestedWork, requestedRest: result.requestedRest };
    const activePosition = result.positions.find((item) => item.id === active.blockId);
    return { ...preview, ...activePosition, type: result.type === "success-ripple" ? "ripple" : intent, activeSegmentId: active.blockId, positions: result.positions, shifted: result.shifted || [], conflict: false, insertionLabel };
  }

  function handleDragStart(event) {
    const initialRect = event.active?.rect?.current?.initial;
    const activatorY = event.activatorEvent?.touches?.[0]?.clientY ?? event.activatorEvent?.clientY;
    dragGrabOffsetRef.current = initialRect && Number.isFinite(activatorY)
      ? Math.max(0, Math.min(initialRect.height, activatorY - initialRect.top))
      : initialRect?.height ? initialRect.height / 2 : 0;
    dragPointerYRef.current = Number.isFinite(activatorY) ? activatorY : null;
    dragPointerListenerRef.current = (pointerEvent) => {
      if (Number.isFinite(pointerEvent.clientY)) dragPointerYRef.current = pointerEvent.clientY;
    };
    window.addEventListener("pointermove", dragPointerListenerRef.current, { passive: true });
    setActiveDrag(event.active.data.current || null);
    setDropPreview(null);
    previewPlanRef.current = null;
  }

  function handleDragMove(event) {
    const interactionPlan = buildInteractionPlan(event);
    previewPlanRef.current = interactionPlan;
    setDropPreview(interactionPlan);
  }

  function handleDragEnd(event) {
    const active = event.active?.data?.current;
    const overId = event.over?.id;
    const preview = previewPlanRef.current;
    setActiveDrag(null);
    setDropPreview(null);
    previewPlanRef.current = null;
    dragGrabOffsetRef.current = 0;
    if (dragPointerListenerRef.current) window.removeEventListener("pointermove", dragPointerListenerRef.current);
    dragPointerListenerRef.current = null;
    dragPointerYRef.current = null;
    if (!active) return;
    if (overId === "task-pool" && active.source === "timeline") {
      moveSegmentToPool(active.blockId);
      return;
    }
    const applyMovePlan = (result) => {
      if (result.type === "hard-conflict") {
        setDragConflict({ active, preview: { ...(preview || {}), conflict: true, conflictBlock: result.boundary } });
        return;
      }
      if (result.type === "noop") return;
      commitDraftChange((current) => ({ ...current, todaySegmentOverrides: { ...(current.todaySegmentOverrides || {}), ...Object.fromEntries(result.positions.map((item) => [item.id, { ...(current.todaySegmentOverrides?.[item.id] || {}), placement: "timeline", manualStart: item.start, locked: false, status: "pending" }])) } }), result.type === "success-ripple" ? `已插入并顺延后续 ${result.shifted.length} 项任务` : `已移动至 ${formatClockMinutes(result.positions[0].start)}–${formatClockMinutes(result.positions[0].end)}`);
    };
    if (String(overId).startsWith("task-sort-") && active.source === "task-pool") {
      const overTaskId = String(overId).replace("task-sort-", "");
      const currentOrder = resolveTaskPoolOrder(autoSchedule.taskGroups, draft.taskPoolOrder);
      const fromIndex = currentOrder.indexOf(active.taskId);
      const toIndex = currentOrder.indexOf(overTaskId);
      if (fromIndex >= 0 && toIndex >= 0) {
        commitDraftChange({ taskPoolOrder: arrayMove(currentOrder, fromIndex, toIndex) }, "已调整今天任务池顺序");
      }
      return;
    }
    if (["task-pool", "timeline"].includes(active.source) && preview) {
      if (["exact", "ripple", "insert-before", "insert-after", "swap"].includes(preview.type)) {
        commitDraftChange((current) => {
          const overrides = { ...(current.todaySegmentOverrides || {}) };
          preview.positions.forEach((item) => {
            overrides[item.id] = { ...(overrides[item.id] || {}), placement: "timeline", manualStart: item.start, locked: false, status: "pending" };
          });
          (preview.returnedToPool || []).forEach((segmentId) => {
            overrides[segmentId] = { ...(overrides[segmentId] || {}), placement: "pool", manualStart: null, locked: false, status: "pending" };
          });
          return { ...current, todaySegmentOverrides: overrides };
        }, preview.type === "ripple" ? `已插入并顺延后续 ${preview.shifted.length} 项任务` : preview.returnedToPool?.length ? "已替换时间线任务，并将原任务放回任务池" : `已移动至 ${formatClockMinutes(preview.start)}–${formatClockMinutes(preview.end)}`);
        return;
      }
      if (["hard-conflict", "needs-compression"].includes(preview.type)) {
        setDragConflict({ active, preview });
        return;
      }
      return;
    }
    if (String(overId).startsWith("insert-") && ["task-pool", "timeline"].includes(active.source)) {
      const targetId = String(overId).replace("insert-", "");
      const targetBlock = autoSchedule.blocks.find((block) => block.id === targetId);
      const targetRect = event.over?.rect;
      const activeRect = event.active?.rect?.current?.translated;
      const after = Boolean(targetRect && activeRect && activeRect.top + activeRect.height / 2 > targetRect.top + targetRect.height / 2);
      applyMovePlan(planTaskMove(autoSchedule, active.blockId, after ? targetBlock?.end : targetBlock?.start, undefined, true, true));
      return;
    }
    if (overId === "timeline" && preview) {
      if (["task-pool", "timeline"].includes(active.source)) {
        applyMovePlan(planTaskMove(autoSchedule, active.blockId, preview.start, undefined, true, true));
        return;
      }
      if (active.source === "task-pool") {
        saveSegmentOverride(active.blockId, {
          placement: "timeline",
          preferredPeriods: [preview.period],
          manualStart: preview.start,
          locked: false,
        });
        setSaveState(`已放入 ${formatClockMinutes(preview.start)}`);
      }
      if (active.source === "timeline") {
        saveSegmentOverride(active.blockId, { placement: "timeline", preferredPeriods: [preview.period], manualStart: preview.start });
        setSaveState(`当前块已移到 ${formatClockMinutes(preview.start)}`);
      }
      if (active.source === "fixed") {
        saveFixedEventOverride(active.blockId, {
          startTime: formatClockMinutes(preview.start),
          endTime: formatClockMinutes(preview.end),
          locked: false,
        });
        setSaveState(`固定事件已移到 ${formatClockMinutes(preview.start)}`);
      }
    }
  }

  function placeAtNearestGap() {
    if (!dragConflict) return;
    const { active, preview } = dragConflict;
    const nearest = findNearestPlannerPlacement(autoSchedule, active, preview.start);
    setDragConflict(null);
    if (!nearest) {
      setSaveState("没有足够容纳这一块的空档");
      return;
    }
    const nextPreview = { ...preview, ...nearest, period: periodKeyForPlannerMinute(nearest.start) };
    if (active.source === "task-pool") {
      saveSegmentOverride(active.blockId, { placement: "timeline", preferredPeriods: [nextPreview.period], manualStart: nextPreview.start, locked: false });
    } else if (active.source === "timeline") {
      saveSegmentOverride(active.blockId, { placement: "timeline", preferredPeriods: [nextPreview.period], manualStart: nextPreview.start });
    } else if (active.source === "fixed") {
      saveFixedEventOverride(active.blockId, { startTime: formatClockMinutes(nextPreview.start), endTime: formatClockMinutes(nextPreview.end), locked: false });
    }
    setSaveState(`已放入最近空档 ${formatClockMinutes(nextPreview.start)}`);
  }

  function compressTaskIntoGap() {
    if (!dragConflict) return;
    const { active, preview } = dragConflict;
    const segment = autoSchedule.taskSegments.find((item) => item.blockId === active.blockId);
    const gap = preview.gapEnd ? { start: preview.start, end: preview.gapEnd } : findNearestPlannerGap(autoSchedule, active, preview.start);
    if (!segment || !gap) {
      setSaveState("没有可用于压缩的真实空档");
      return;
    }
    const restMinutes = Number(segment.breakAfter || 0);
    const workMinutes = gap.end - gap.start - restMinutes;
    if (workMinutes < 5) {
      setSaveState("保留休息后学习时长不足 5 分钟，请选择不休息。");
      return;
    }
    saveSegmentOverride(active.blockId, { placement: "timeline", manualStart: gap.start, workMinutes, restMinutes, locked: false, status: "pending" });
    setDragConflict(null);
    setSaveState(`已将本段压缩为${workMinutes}+${restMinutes}并放入 · 可撤销`);
  }

  function manuallyCompressTask(workMinutes, restMinutes) {
    if (!dragConflict) return;
    const { active, preview } = dragConflict;
    const work = Math.max(0, Number(workMinutes || 0));
    const rest = Math.max(0, Number(restMinutes || 0));
    if (work + rest <= 0) {
      setSaveState("请先填写大于0的学习或休息分钟");
      return;
    }
    const gap = preview.gapEnd ? { start: preview.start, end: preview.gapEnd } : findNearestPlannerGap(autoSchedule, active, preview.start, work + rest);
    if (!gap) {
      setSaveState("没有能容纳该自定义节奏的空档");
      return;
    }
    if (work + rest > gap.end - gap.start) {
      setSaveState("手动节奏超过当前落点的可用时间，请再缩短一点。");
      return;
    }
    saveSegmentOverride(active.blockId, { placement: "timeline", manualStart: gap.start, workMinutes: work, restMinutes: rest, locked: false, status: "pending" });
    setDragConflict(null);
    setSaveState(`已将本段调整为${work}+${rest}并放入 · 可撤销`);
  }

  function placeTaskWithoutRest() {
    if (!dragConflict) return;
    const { active, preview } = dragConflict;
    const segment = autoSchedule.taskSegments.find((item) => item.blockId === active.blockId);
    const gap = preview.gapEnd ? { start: preview.start, end: preview.gapEnd } : findNearestPlannerGap(autoSchedule, active, preview.start);
    const work = Number(gap?.end || 0) - Number(gap?.start || 0);
    if (!segment || !gap || work < 5) {
      setSaveState("当前真实空档不足 5 分钟，不能作为任务段。");
      return;
    }
    saveSegmentOverride(active.blockId, { placement: "timeline", manualStart: gap.start, workMinutes: work, restMinutes: 0, locked: false, status: "pending" });
    setDragConflict(null);
    setSaveState(`已按 ${work}+0 放入当前落点 · 可撤销`);
  }

  function plannerRange(scope) {
    if (String(scope).startsWith("after:")) {
      const blockId = String(scope).replace("after:", "");
      const block = autoSchedule.blocks.find((item) => item.id === blockId);
      if (block) return { start: block.end, end: autoSchedule.timelineEnd, anchorBlockId: blockId };
    }
    if (scope === "now") {
      const normalizedNow = draft.targetDate === beijingIsoDate() ? normalizePlannerMinute(currentBeijingMinute, autoSchedule.timelineStart) : autoSchedule.timelineStart;
      return { start: Math.max(autoSchedule.timelineStart, normalizedNow), end: autoSchedule.timelineEnd };
    }
    if (scope === "before-now") {
      const now = draft.targetDate === beijingIsoDate() ? normalizePlannerMinute(currentBeijingMinute, autoSchedule.timelineStart) : autoSchedule.timelineStart;
      return { start: autoSchedule.timelineStart, end: Math.min(autoSchedule.timelineEnd, now) };
    }
    if (scope === "after-now") {
      const now = draft.targetDate === beijingIsoDate() ? normalizePlannerMinute(currentBeijingMinute, autoSchedule.timelineStart) : autoSchedule.timelineStart;
      return { start: Math.max(autoSchedule.timelineStart, now), end: autoSchedule.timelineEnd };
    }
    const boundaries = resolvePlannerBoundaryCards(autoSchedule);
    if (scope === "morning") return { start: autoSchedule.timelineStart, end: boundaries.morningEnd, boundarySource: boundaries.morningSource };
    if (scope === "afternoon") return { start: boundaries.morningEnd, end: boundaries.dayEnd, boundarySource: boundaries.dayEndSource };
    if (scope === "evening") {
      const evening = autoSchedule.segmentFree.find((item) => item.key === "evening");
      return { start: Math.max(boundaries.morningEnd, evening?.start || boundaries.morningEnd), end: boundaries.dayEnd, boundarySource: boundaries.dayEndSource };
    }
    const period = autoSchedule.segmentFree.find((item) => item.key === scope);
    if (period) return { start: period.start, end: period.end };
    return { start: autoSchedule.timelineStart, end: autoSchedule.timelineEnd };
  }

  function clearSchedule(scope) {
    if (scope === "all-today" && !window.confirm("清空今天全部排程内容？模板库和历史记录不会删除。")) return;
    commitDraftChange((current) => {
      if (scope === "all-today") {
        const preserved = ensureMorningRoutineCard(current);
        const morning = findDayStartAnchor(preserved.todayCustomBlocks || []);
        const morningOverride = morning ? preserved.todaySegmentOverrides?.[`${morning.id}-1`] : null;
        return {
          ...preserved,
          todayTaskOverrides: {},
          todaySegmentOverrides: morning && morningOverride ? { [`${morning.id}-1`]: morningOverride } : {},
          deletedTodayTaskIds: [],
          todayCustomBlocks: morning ? [morning] : [],
          fixedEvents: [],
          fixedEventOverrides: {},
          taskPoolOrder: [],
          generatedPrompt: "",
        };
      }
      if (scope === "restore-template") {
        return {
          ...current,
          todayTaskOverrides: {},
          todaySegmentOverrides: {},
          deletedTodayTaskIds: [],
          fixedEventOverrides: {},
          taskPoolOrder: [],
          generatedPrompt: "",
        };
      }
      const range = ["morning", "afternoon", "evening", "before-now", "after-now"].includes(scope) ? plannerRange(scope) : null;
      const nextOverrides = { ...(current.todaySegmentOverrides || {}) };
      autoSchedule.blocks
        .filter((block) => block.kind === "task" && !block.locked)
        .filter((block) => !range || intervalsOverlap(block, range))
        .forEach((block) => {
          nextOverrides[block.id] = { ...(nextOverrides[block.id] || {}), unscheduled: true, manualStart: null };
        });
      return { ...current, todaySegmentOverrides: nextOverrides };
    }, clearScheduleLabel(scope));
  }

  function rescheduleScope(scope) {
    commitDraftChange((current) => {
      const range = scope === "unplaced" ? null : plannerRange(scope);
      const nextOverrides = { ...(current.todaySegmentOverrides || {}) };
      if (scope === "unplaced") {
        Object.entries(nextOverrides).forEach(([blockId, override]) => {
          if (override?.unscheduled) nextOverrides[blockId] = { ...override, unscheduled: false, manualStart: null, locked: false };
        });
      } else {
        autoSchedule.blocks
          .filter((block) => block.kind === "task" && !block.locked)
          .filter((block) => intervalsOverlap(block, range))
          .forEach((block) => {
            const currentOverride = nextOverrides[block.id] || {};
            nextOverrides[block.id] = { ...currentOverride, placement: "timeline", manualStart: null, unscheduled: false, locked: false };
          });
      }
      return { ...current, todaySegmentOverrides: nextOverrides };
    }, rescheduleScopeLabel(scope));
  }

  function addTodayCustomTask(task) {
    const rhythm = parsePlannerRhythm(task.rhythm || "50+10");
    const normalizedTask = {
      title: task.title || "自定义任务",
      category: task.category || "生活",
      categoryId: plannerCategoryId(task),
      segments: rhythm.studySegments,
      breakMinutes: rhythm.breakMinutes,
      splittable: task.splittable !== false,
      priority: Number(task.priority || 2),
      manualOrder: Number(task.manualOrder ?? (draft.todayCustomBlocks || []).length + 1),
      preferredPeriods: task.preferredPeriods?.length ? task.preferredPeriods : ["afternoon"],
    };
    commitDraftChange((current) => ({
      ...current,
      todayCustomBlocks: [...(current.todayCustomBlocks || []), { id: `custom-${Date.now()}`, ...normalizedTask, note: "仅保存到今天", source: "today-custom" }],
    }), "已新增当天任务块");
    setCreateTaskOpen(false);
    setSaveState("已新增当天任务块");
  }

  function applyQuickDayTemplate(templateKey) {
    const templates = {
      standard: { scene: "school", commuteStatus: "no", wakeUpTime: "07:30", targetBedTime: "23:20", exerciseMinutes: 40, exerciseType: "正式运动" },
      commute: { scene: "school", commuteStatus: "yes", wakeUpTime: "07:10", targetBedTime: "23:20", morningPrepMinutes: 70 },
      outing: { scene: "outing", commuteStatus: "yes", wakeUpTime: "08:00", targetBedTime: "23:30", exerciseMinutes: 0, exerciseType: "出游步行" },
      work: { scene: "work", commuteStatus: "uncertain", wakeUpTime: "07:40", targetBedTime: "23:20", professionalMinutes: 30, thesisMinutes: 40 },
      low: { scene: "home", commuteStatus: "no", wakeUpTime: "08:30", targetBedTime: "23:00", exerciseMinutes: 20, exerciseType: "恢复 / 拉伸", formalRestBlocks: 2 },
    };
    setDraft((current) => ({ ...current, ...(templates[templateKey] || {}) }));
    setSaveState("已套用日模板");
  }

  function freshSnapshotForUpload() {
    return safeBuildAgentDaySnapshotFromDailyData({
      plan: { ...autoSchedule, targetDate: draft.targetDate },
      profile: data.profile,
      classificationTaxonomy,
      settlements: data.settlements,
      sourceMode: isFirebaseConfigured ? "firebase" : "demo",
      now: new Date(),
    });
  }

  async function uploadCurrentPlan(saveFirst = false) {
    setUploadChoiceOpen(false);
    if (saveFirst && !(await persistPlannerNow("manual"))) {
      setUploadState("保存失败，未上传；本机恢复副本仍在。");
      return;
    }
    setUploadState("正在上传当前排程...");
    const snapshot = freshSnapshotForUpload();
    if (!snapshot) {
      setUploadState("当前排程快照不可用，请先保存或刷新后再试。");
      return;
    }
    const blockCount = Array.isArray(snapshot.timeline) ? snapshot.timeline.length : 0;
    if (typeof window !== "undefined" && !window.confirm(`Upload snapshot for ${snapshot.date}? Timeline blocks: ${blockCount}.`)) {
      setUploadState("Upload cancelled");
      return;
    }
    const result = await sendSnapshot(snapshot);
    const message = {
      accepted: "JXC 已接收当前排程",
      duplicate: "JXC 已有相同快照",
      ignored_stale: "JXC 已有较新的同日期快照",
      unauthorized: "JXC token 无效",
      schema_rejected: "JXC 拒绝了快照结构",
      receiver_unavailable: "JXC 未启动或无法连接",
      cors_or_network_error: "浏览器跨域或网络错误",
      timeout: "连接 JXC 超时",
      not_configured: "请先在设置中启用并填写 JXC 连接",
    }[result.status] || "上传未完成";
    setUploadState(`${message} - date ${snapshot.date}`);
  }

  const todayDate = beijingIsoDate();
  const tomorrowDate = beijingIsoDate(1);

  return (
    <section className="schedule-layout">
      <div className="panel wide schedule-hero">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Daily Planner</p>
            <h2>Daily planner</h2>
          </div>
          <Wand2 size={22} />
        </div>
        <p>任务池、时间线和固定边界均以当前草稿为准；修改先写入本机恢复副本，再自动同步到当前账号。</p>
        <div className="schedule-meta-row">
          <span>{saveState}</span>
          {snapshotSyncIssue && <span>Cyberboss同步失败：{snapshotSyncIssue}</span>}
          {lastSavedAt && <span>最近保存：{new Date(lastSavedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>}
          <span>固定自由娱乐：{DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min</span>
        </div>
      </div>

      <div className="panel wide quick-adjust-bar">
        <div className="quick-adjust-head">
          <strong>排程日期与实际开始</strong>
          <span>生活时段和固定边界在“高级设置”中调整</span>
        </div>
        <div className="quick-adjust-grid">
          <div className="planner-date-control"><div className="planner-date-segmented"><button className={draft.targetDate === todayDate ? "active" : ""} type="button" onClick={() => switchPlannerTargetDate(todayDate)}>Today<small>{todayDate}</small></button><button className={draft.targetDate === tomorrowDate ? "active" : ""} type="button" onClick={() => switchPlannerTargetDate(tomorrowDate)}>Tomorrow<small>{tomorrowDate}</small></button></div><div className="planner-date-readout"><span>Plan date</span><strong>{draft.targetDate}</strong></div></div>
          <button className="secondary-button compact" type="button" onClick={() => persistPlannerNow("manual")} disabled={saveState === "正在手动保存..."}><Save size={16} />手动保存</button>
          {plannerFeatureFlags.catkeeperSender && <button className="primary-button compact" type="button" onClick={() => hasUnsavedChanges ? setUploadChoiceOpen(true) : uploadCurrentPlan(false)}><Upload size={16} />Upload {draft.targetDate || "current date"}</button>}
        </div>
        {uploadState && <p className="field-help schedule-upload-state">{uploadState}</p>}
      </div>

      <div className="panel wide schedule-template-bar">
        <div>
          <strong>今日模板：{currentPlannerTemplate?.name || "未选择"}</strong>
          <span>编辑或保存模板不会影响今天；只有确认“应用到今天”才会生成新的当天安排。</span>
        </div>
        <div className="schedule-template-buttons">
          <select aria-label="选择今日模板" value="" onChange={(event) => { const template = safeDayTemplates.find((item) => item.id === event.target.value); if (template) openApplyTemplate(template); }}>
            <option value="">选择模板并预览应用</option>
            {safeDayTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <button className="secondary-button compact" type="button" onClick={saveCurrentAsDefaults}>设为默认</button>
          <button className="secondary-button compact" type="button" onClick={() => openSaveTemplate()}>保存今天为模板</button>
          {currentPlannerTemplate && <button className="secondary-button compact" type="button" onClick={() => openSaveTemplate(currentPlannerTemplate)}>更新当前模板</button>}
           <button className="secondary-button compact" type="button" onClick={() => setTemplateManagerOpen(true)}>管理模板</button>
           <button className="secondary-button compact" type="button" onClick={() => setPlannerAdvancedOpen(true)}>高级设置</button>
           <button className="primary-button compact" type="button" onClick={openRecoveryPlanner}>从现在接着排</button>
          <label className="future-plan-control">预排未来 <input aria-label="预排未来天数" type="number" min="1" max="7" value={futurePlanDays} onChange={(event) => setFuturePlanDays(Math.max(1, Math.min(7, Number(event.target.value) || 1)))} /> 天</label>
          <button className="secondary-button compact" type="button" onClick={generateFuturePlans}>逐日生成</button>
        </div>
      </div>

      <div className="panel wide schedule-engine-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Auto Timeline</p>
            <h2>自动排程引擎</h2>
          </div>
          <div className="planner-action-row">
            <button className="primary-button compact" type="button" onClick={openRecoveryPlanner}>从现在接着排</button>
            <button className="secondary-button compact" type="button" onClick={clearFutureSchedule}>清空未来</button>
            <PlannerMenu label="清空">
              <button type="button" onClick={() => clearSchedule("timeline")}>清空时间线任务</button>
              <button type="button" onClick={() => clearSchedule("morning")}>清空上午</button>
              <button type="button" onClick={() => clearSchedule("afternoon")}>清空下午</button>
              <button type="button" onClick={() => clearSchedule("evening")}>清空晚间</button>
              <button type="button" onClick={() => clearSchedule("before-now")}>清空当前时间之前</button>
              <button type="button" onClick={() => clearSchedule("after-now")}>清空当前时间之后</button>
              <button type="button" onClick={() => clearSchedule("unlocked")}>清空未锁定任务</button>
              <button type="button" onClick={() => clearTaskPool()}>清空任务池</button>
              <hr />
              <button type="button" onClick={() => clearSchedule("all-today")}>清空今天全部内容</button>
              <button type="button" onClick={() => clearSchedule("restore-template")}>恢复模板初始状态</button>
            </PlannerMenu>
            <PlannerMenu label="重新排程">
              <button type="button" onClick={() => rescheduleScope("all")}>重新排整天</button>
              <button type="button" onClick={openRecoveryPlanner}>从现在接着排</button>
              <button type="button" onClick={() => rescheduleScope("morning")}>只重排上午</button>
              <button type="button" onClick={() => rescheduleScope("afternoon")}>只重排下午</button>
              <button type="button" onClick={() => rescheduleScope("evening")}>只重排晚间</button>
              <button type="button" onClick={() => editingTask?.block ? rescheduleScope(`after:${editingTask.block.id}`) : rescheduleScope("unplaced")}>重排当前块之后</button>
              <button type="button" onClick={() => rescheduleScope("unplaced")}>只安排未排入任务</button>
            </PlannerMenu>
            <button className="secondary-button compact" type="button" disabled={!plannerPast.length} onClick={undoPlannerChange}>撤销</button>
            <button className="secondary-button compact" type="button" disabled={!plannerFuture.length} onClick={redoPlannerChange}>恢复</button>
          </div>
        </div>
        {lastPlannerAction && <div className="planner-undo-banner"><span>{lastPlannerAction}</span><button type="button" disabled={!plannerPast.length} onClick={undoPlannerChange}>撤销</button></div>}
        <p className="field-help planner-boundary-note">分界依据：上午截至{formatClockMinutes(plannerBoundaries.morningEnd)}（{plannerBoundaries.morningSource}）；普通任务不安排到{formatClockMinutes(plannerBoundaries.dayEnd)}之后（{plannerBoundaries.dayEndSource}）。</p>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          autoScroll={{ threshold: { x: 0.1, y: 0.15 }, acceleration: 12, interval: 5 }}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveDrag(null);
            setDropPreview(null);
            previewPlanRef.current = null;
            dragGrabOffsetRef.current = 0;
            if (dragPointerListenerRef.current) window.removeEventListener("pointermove", dragPointerListenerRef.current);
            dragPointerListenerRef.current = null;
            dragPointerYRef.current = null;
          }}
        >
          <div className="schedule-engine-layout">
            <TaskPoolPreview tasks={autoSchedule.taskGroups} segments={autoSchedule.poolSegments} order={resolveTaskPoolOrder(autoSchedule.taskGroups, draft.taskPoolOrder)} categoryOrder={plannerCategoryOrder} categoryCatalog={plannerCategoryCatalog} categoryColors={categoryColors} onEdit={setEditingTask} onCreate={() => setCreateTaskOpen(true)} onDelete={deleteTodayTask} onClear={clearTaskPool} onArrange={(blockId) => openTaskMoveSheet(blockId, "pool")} onEditCategoryOrder={() => setCategoryOrderManagerOpen(true)} />
            <div className="schedule-engine-scroll">
              <div className="schedule-engine-grid">
                <TimelinePreview plan={autoSchedule} dropPreview={dropPreview} timelineRef={timelineRef} nowMinute={currentBeijingMinute} categoryColors={categoryColors} onEditTask={(editing) => isMorningRoutineCard(editing.block) ? setEditingMorningRoutine(editing.block) : setEditingTask(editing)} onEditFixed={setEditingFixedEvent} onToggleComplete={toggleSegmentCompletion} onToggleLock={toggleSegmentLock} onReturnToPool={moveSegmentToPool} onMoveTask={(blockId) => openTaskMoveSheet(blockId, "timeline")} onResizeTask={applyResizePlan} />
                {plannerFeatureFlags.newStatistics && <PlannerOverview plan={autoSchedule} categoryOrder={plannerCategoryOrder} categoryCatalog={plannerCategoryCatalog} categoryColors={categoryColors} categoryTree={classificationTaxonomy} categoryTargets={categoryTargets} trackers={reviewTrackerSummaries} onEditTargets={() => setCategoryTargetManagerOpen(true)} onManageTrackers={() => setReviewTrackerManagerOpen(true)} />}
              </div>
            </div>
          </div>
          <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
            {activeDrag ? <TaskDragPreview item={activeDrag} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {plannerAdvancedOpen && <div className="modal-backdrop" role="presentation"><section className="modal-card planner-advanced-modal" role="dialog" aria-modal="true" aria-labelledby="planner-advanced-title"><div className="planner-advanced-head"><div><h3 id="planner-advanced-title">排程高级设置</h3><p>低频边界、模板与 Prompt 集中在这里，不占用时间线下方空间。</p></div><button className="secondary-button compact" type="button" onClick={() => setPlannerAdvancedOpen(false)}>关闭</button></div>
      <details className="panel form-panel schedule-collapse" open>
        <summary><span><strong>排程边界</strong><small>日期、上床与准备时间</small></span><CalendarClock size={21} /></summary>
        <form onSubmit={(event) => { event.preventDefault(); generatePrompt(); }}>
        <TextField label="排程目标日期" value={draft.targetDate} onChange={updatePlannerTargetDate} />
        <div className="two-column-fields">
          <TextField label="目标上床时间" value={draft.targetBedTime} onChange={(value) => updateDraft("targetBedTime", value)} />
        </div>
        <SelectField label="明天场景" value={draft.scene} onChange={(value) => updateDraft("scene", value)} options={scheduleSceneOptions} />
        <SelectField label="是否有通勤" value={draft.commuteStatus} onChange={(value) => updateDraft("commuteStatus", value)} options={[["no", "否"], ["yes", "是"], ["uncertain", "不确定"]]} />
        <NumberField label="起床后到可学习地点准备时间" value={effectiveMorningPrepMinutes} onChange={(value) => updateDraft("morningPrepMinutes", value)} />
        <p className="field-help">如果场景是在校且不通勤，默认按 40min：洗漱20min + 到教室10min + 缓冲10min，不能起床后立刻安排学习。</p>
        <div className="two-column-fields">
          <NumberField label="午间时长分钟" value={draft.lunchBlockMinutes} onChange={(value) => updateDraft("lunchBlockMinutes", value)} />
          <NumberField label="启动缓冲分钟" value={draft.startupBufferMinutes} onChange={(value) => updateDraft("startupBufferMinutes", value)} />
          <NumberField label="晚饭分钟" value={draft.dinnerMinutes} onChange={(value) => updateDraft("dinnerMinutes", value)} />
        </div>
        <label className="field">
          <span>补充说明</span>
          <textarea value={draft.specialNotes} onChange={(event) => updateDraft("specialNotes", event.target.value)} placeholder="例如：下午可能出门 / 晚饭较晚 / 今天只要稳住主线" />
        </label>
        {(draft.fixedEvents || []).length > 0 && <p className="field-help">旧版事件已自动转换为普通时间线卡片，保存后不再生成旧格式。</p>}
        <button className="secondary-button" type="button" onClick={saveCurrentAsDefaults}>把当前填写保存为默认值</button>
        </form>
      </details>

      <details className="panel schedule-collapse schedule-legacy-hidden">
        <summary><span><strong>学习模板</strong><small>模板选择、任务权重、优先级</small></span><Check size={21} /></summary>
        <div className="template-config-grid">
        <div>
        <h3>数学比例</h3>
        <SelectField label="今日使用模板" value={draft.mathTemplateId} onChange={(value) => updateDraft("mathTemplateId", value)} options={safeMathTemplates.map((template) => [template.id, template.name])} />
        <p className="field-help">{mathTemplateText(selectedTemplate)}</p>
        <div className="two-column-fields">
          <TextField label="模板名称" value={selectedTemplate.name} onChange={(value) => updateMathTemplate("name", value)} />
          <NumberField label="网课 50min 块数" value={selectedTemplate.lectureBlocks50} onChange={(value) => updateMathTemplate("lectureBlocks50", value)} />
          <NumberField label="习题 50min 块数" value={selectedTemplate.exerciseBlocks50} onChange={(value) => updateMathTemplate("exerciseBlocks50", value)} />
          <NumberField label="复习 30min 块数" value={selectedTemplate.reviewBlocks30} onChange={(value) => updateMathTemplate("reviewBlocks30", value)} />
          <NumberField label="错题 50min 块数" value={selectedTemplate.errorReviewBlocks50} onChange={(value) => updateMathTemplate("errorReviewBlocks50", value)} />
          <NumberField label="总结 30min 块数" value={selectedTemplate.summaryBlocks30} onChange={(value) => updateMathTemplate("summaryBlocks30", value)} />
        </div>
        <TextField label="模板备注" value={selectedTemplate.note} onChange={(value) => updateMathTemplate("note", value)} />
        <div className="button-row">
          <button className="secondary-button compact" type="button" onClick={() => addMathTemplate(true)}>复制模板</button>
          <button className="secondary-button compact" type="button" onClick={() => addMathTemplate(false)}>新增模板</button>
          <button className="secondary-button compact" type="button" onClick={() => updateSettings("defaultMathTemplateId", selectedTemplate.id)}>设为默认</button>
          <button className="secondary-button compact danger-text" type="button" onClick={deleteMathTemplate}>删除</button>
        </div>
        </div>

        <div>
        <h3>英语 / 雅思</h3>
        <SelectField label="今日英语模板" value={draft.englishTemplateId} onChange={(value) => updateDraft("englishTemplateId", value)} options={safeEnglishTemplates.map((template) => [template.id, template.name])} />
        <div className="two-column-fields">
          <TextField label="模板名称" value={selectedEnglishTemplate.name} onChange={(value) => updateEnglishTemplate("name", value)} />
          <NumberField label="单词分钟" value={selectedEnglishTemplate.wordMinutes} onChange={(value) => updateEnglishTemplate("wordMinutes", value)} />
          <NumberField label="专项数量" value={selectedEnglishTemplate.skillCount} onChange={(value) => updateEnglishTemplate("skillCount", Math.max(1, Math.min(4, Number(value || 1))))} />
          <NumberField label="每项专项分钟" value={selectedEnglishTemplate.skillMinutes} onChange={(value) => updateEnglishTemplate("skillMinutes", value)} />
        </div>
        <SelectField
          label="项目选择方式"
          value={selectedEnglishTemplate.skillMode || "recommended"}
          onChange={(value) => updateEnglishTemplate("skillMode", value)}
          options={[["recommended", "系统推荐"], ["manual", "手动选择"]]}
        />
        {selectedEnglishTemplate.skillMode === "manual" && (
          <div className="two-column-fields">
            <SelectField label="专项 1" value={draft.englishSkill} onChange={(value) => updateDraft("englishSkill", value)} options={englishSkillOptions} />
            <SelectField label="专项 2" value={draft.englishSecondSkill} onChange={(value) => updateDraft("englishSecondSkill", value)} options={englishSkillOptions} />
          </div>
        )}
        <TextField label="模板备注" value={selectedEnglishTemplate.note} onChange={(value) => updateEnglishTemplate("note", value)} />
        <p className="field-help">
          推荐项目：{englishSkills.map((skill) => englishSkillText[skill]).join(" + ")}。本次将生成：单词 {selectedEnglishTemplate.wordMinutes}min + {englishSkills.map((skill) => `${englishSkillText[skill]} ${selectedEnglishTemplate.skillMinutes}min`).join(" + ")}。
        </p>
        <div className="button-row">
          <button className="secondary-button compact" type="button" onClick={() => addEnglishTemplate(true)}>复制模板</button>
          <button className="secondary-button compact" type="button" onClick={() => addEnglishTemplate(false)}>新增模板</button>
          <button className="secondary-button compact" type="button" onClick={() => updateSettings("defaultEnglishTemplateId", selectedEnglishTemplate.id)}>设为默认</button>
          <button className="secondary-button compact danger-text" type="button" onClick={deleteEnglishTemplate}>删除</button>
        </div>
        </div>
        </div>
      </details>

      <details className="panel schedule-collapse">
        <summary><span><strong>论文与专业课</strong><small>补充明天的可见产出和专业课保线</small></span><BookOpen size={21} /></summary>
        <div className="two-column-fields">
          <NumberField label="论文 / 作业计划分钟" value={draft.thesisMinutes} onChange={(value) => updateDraft("thesisMinutes", value)} />
          <NumberField label="经济 / 专业课计划分钟" value={draft.professionalMinutes} onChange={(value) => updateDraft("professionalMinutes", value)} />
        </div>
        <label className="field">
          <span>论文补充</span>
          <textarea value={draft.thesisNote} onChange={(event) => updateDraft("thesisNote", event.target.value)} placeholder="只写需要调整、下一步或可见产出要求，不需要网页推荐具体写哪段。" />
        </label>
        <label className="field">
          <span>经济 / 专业课补充</span>
          <textarea value={draft.professionalNote} onChange={(event) => updateDraft("professionalNote", event.target.value)} placeholder="只写推进、需要调整或今天是否保线，不需要网页推荐具体章节。" />
        </label>
      </details>

      <details className="panel schedule-collapse">
        <summary><span><strong>运动与边界</strong><small>运动、正式休息娱乐、系统开发上限</small></span><Gamepad2 size={21} /></summary>
        <div className="two-column-fields">
          <TextField label="运动类型" value={draft.exerciseType} onChange={(value) => updateDraft("exerciseType", value)} />
          <NumberField label="运动计划分钟" value={draft.exerciseMinutes} onChange={(value) => updateDraft("exerciseMinutes", value)} />
          <NumberField label="正式休息块数" value={draft.formalRestBlocks} onChange={(value) => updateDraft("formalRestBlocks", Math.max(0, Number(value || 0)))} />
          <NumberField label="每块休息分钟" value={draft.formalRestMinutes} onChange={(value) => updateDraft("formalRestMinutes", value)} />
          <NumberField label="洗澡分钟" value={draft.showerMinutes} onChange={(value) => updateDraft("showerMinutes", value)} />
          <NumberField label="面膜 / 护肤分钟" value={draft.maskMinutes} onChange={(value) => updateDraft("maskMinutes", value)} />
        </div>
        <SelectField label="系统开发上限" value={draft.systemDevelopmentLimit} onChange={(value) => updateDraft("systemDevelopmentLimit", value)} options={systemDevelopmentLimitOptions} />
        <p className="field-help">正式休息娱乐只给排程留出时段，不指定形式：{draft.formalRestBlocks ?? 1}块 × {draft.formalRestMinutes || 0}min。</p>
        {autoContext.boundaryIssue && <p className="blocker-text">今日存在失控/修复信号，建议系统开发最多 30min，22:00 后不碰复杂系统。</p>}
      </details>

      <details className="panel wide estimate-panel schedule-collapse schedule-legacy-hidden">
        <summary><span><strong>明日预估</strong><small>学习容量、生活收束、面膜/洗澡提醒</small></span><Target size={21} /></summary>
        <div className="estimate-grid">
          <InfoLine label="预计纯学习时长" value={minutesLabel(scheduleEstimate.studyMinutes)} />
          <InfoLine label="上午累计目标" value={minutesLabel(segmentGoals.morning.targetMinutes)} />
          <InfoLine label="下午累计目标" value={minutesLabel(segmentGoals.afternoon.targetMinutes)} />
          <InfoLine label="晚上累计目标" value={minutesLabel(segmentGoals.evening.targetMinutes)} />
          <InfoLine label="运动 / 恢复" value={minutesLabel(scheduleEstimate.exerciseMinutes)} />
          <InfoLine label="正式休息娱乐" value={minutesLabel(scheduleEstimate.formalRestMinutes)} />
          {scheduleEstimate.weeklyReviewMinutes > 0 && <InfoLine label="周日总复盘" value={minutesLabel(scheduleEstimate.weeklyReviewMinutes)} />}
          <InfoLine label="洗澡安排" value={showerPlan.shouldShower ? `安排，${showerPlan.reason}` : `不默认安排，${showerPlan.reason}`} />
          <InfoLine label="面膜周期" value={maskPlan.shouldSchedule ? `安排 ${maskPlan.suggestedTime}，20min` : maskPlan.reason} />
          <InfoLine label="生活 / 收束 / 准备" value={minutesLabel(scheduleEstimate.lifeMinutes)} />
          <InfoLine label="全天已占用" value={minutesLabel(scheduleEstimate.totalOccupiedMinutes)} />
          <InfoLine label="状态" value={scheduleEstimate.warning} />
        </div>
      </details>

      <details className="panel wide schedule-collapse prompt-collapse">
        <summary>
          <div>
            <p className="eyebrow">Prompt</p>
            <strong>生成排程 Prompt</strong>
            <small>排程目标与偏好、AI 生成参数</small>
          </div>
          <button className="secondary-button compact" type="button" onClick={generatePrompt}>生成</button>
        </summary>
        <textarea
          className="generated-prompt"
          value={generatedPrompt}
          onChange={(event) => setGeneratedPrompt(event.target.value)}
          placeholder="点击生成后，这里会出现可以直接复制给 AI/小椰的排程请求。"
        />
        <button className="primary-button full" type="button" disabled={!generatedPrompt} onClick={copyPrompt}>
          <Copy size={18} />
          复制 prompt
        </button>
      </details>
      </section></div>}

      {uploadChoiceOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card compact-modal" role="dialog" aria-modal="true" aria-labelledby="upload-current-plan-title">
            <h3 id="upload-current-plan-title">上传当前计划前有未保存修改</h3>
            <p>可先保存到当前账号后上传，或直接把当前内存中的排程上传给 JXC。两种方式都不会改变任务、积分或复盘状态。</p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setUploadChoiceOpen(false)}>取消</button>
              <button className="secondary-button" type="button" onClick={() => uploadCurrentPlan(false)}>直接上传当前计划</button>
              <button className="primary-button" type="button" onClick={() => uploadCurrentPlan(true)}>先保存再上传</button>
            </div>
          </section>
        </div>
      )}
      {editingTask && <EditTaskBlockModal editing={editingTask} taxonomy={classificationTaxonomy} rhythmPresets={settings.rhythmPresets} onSaveRhythmPresets={(rhythmPresets) => setSettings((current) => ({ ...current, rhythmPresets }))} onCancel={() => setEditingTask(null)} onSaveTask={saveTaskOverride} onSaveSegment={saveSegmentOverride} onMoveSegmentToPool={moveSegmentToPool} onDeleteTask={(task) => { deleteTodayTask(task.id); setEditingTask(null); }} onCopyTask={copyTodayTask} onRescheduleAfter={(blockId) => { rescheduleScope(`after:${blockId}`); setEditingTask(null); }} />}
      {editingMorningRoutine && <MorningRoutineModal block={editingMorningRoutine} onCancel={() => setEditingMorningRoutine(null)} onSave={saveMorningRoutine} />}
      {morningRoutineConflict && <MorningRoutineConflictModal conflict={morningRoutineConflict} onCancel={() => setMorningRoutineConflict(null)} onConfirm={() => { const { plan, duration, setDefault } = morningRoutineConflict; if (plan.positions?.length) commitMorningRoutineMove({ ...plan, type: "success-ripple" }, duration, setDefault); }} />}
      {recoveryDialog && <RecoveryScheduleModal cutoffTime={recoveryDialog.cutoffTime} preview={recoveryPreview} onChangeCutoff={(cutoffTime) => setRecoveryDialog({ cutoffTime })} onCancel={() => setRecoveryDialog(null)} onConfirm={applyRecoveryPlanner} />}
      {dragConflict && <DragConflictModal conflict={dragConflict} onCancel={() => setDragConflict(null)} onPlaceNearest={placeAtNearestGap} onCompress={compressTaskIntoGap} onNoRest={placeTaskWithoutRest} onManualCompress={manuallyCompressTask} />}
      {taskMoveSheet && <TaskMoveSheet state={taskMoveSheet} plan={autoSchedule} onCancel={() => setTaskMoveSheet(null)} onReturn={() => { moveSegmentToPool(taskMoveSheet.blockId); setTaskMoveSheet(null); }} onMove={(minute) => requestTaskMove(taskMoveSheet.blockId, minute, taskMoveSheet.source)} />}
      {templateManagerOpen && <DayTemplateManager templates={safeDayTemplates} defaultTemplateId={settings.defaultDayTemplateId} onCancel={() => setTemplateManagerOpen(false)} onApply={openApplyTemplate} onSaveCurrent={(onSaved) => openSaveTemplate(null, onSaved)} onNew={createEmptyDayTemplate} onUpdate={updateDayTemplate} onDelete={deleteDayTemplate} onCopy={duplicateDayTemplate} onRestore={restoreDayTemplate} onSetDefault={(templateId) => setSettings((current) => ({ ...current, defaultDayTemplateId: templateId }))} />}
      {templateSaveDialog && <SaveTodayAsTemplateModal state={templateSaveDialog} onChange={setTemplateSaveDialog} onCancel={() => setTemplateSaveDialog(null)} onSave={saveTodayAsTemplate} />}
      {templateApplyDialog && <ApplyTemplateModal state={templateApplyDialog} onChange={setTemplateApplyDialog} onCancel={() => setTemplateApplyDialog(null)} onConfirm={applyDayTemplate} />}
      {createTaskOpen && <CreateTodayTaskDrawer tasks={autoSchedule.taskGroups} taxonomy={classificationTaxonomy} commonTasks={settings.commonTasks || []} rhythmPresets={settings.rhythmPresets} onCancel={() => setCreateTaskOpen(false)} onSave={addTodayCustomTask} />}
      {maintenanceManagerOpen && <LifeMaintenanceManager items={data.profile.healthMaintenanceItems} itemOrder={maintenanceItemOrder} onSave={({ healthMaintenanceItems, maintenanceItemOrder: nextOrder }) => { onSaveProfile({ healthMaintenanceItems, maintenanceItemOrder: nextOrder }); setMaintenanceManagerOpen(false); }} onCancel={() => setMaintenanceManagerOpen(false)} onRecordToday={() => { setMaintenanceManagerOpen(false); onOpenSettlement?.(); }} />}
      {categoryTargetManagerOpen && <CategoryTargetManager taxonomy={classificationTaxonomy} targets={categoryTargets} onCancel={() => setCategoryTargetManagerOpen(false)} onSave={(nextTargets) => { setDraft((current) => ({ ...current, categoryTargets: nextTargets })); setCategoryTargetManagerOpen(false); }} />}
      {reviewTrackerManagerOpen && <ReviewTrackerManager taxonomy={classificationTaxonomy} trackers={reviewTrackers} onCancel={() => setReviewTrackerManagerOpen(false)} onSave={(reviewTrackers) => { onSaveProfile({ reviewTrackers, reviewTrackerOrder: reviewTrackers.map((tracker) => tracker.id) }); setReviewTrackerManagerOpen(false); }} />}
      {categoryOrderManagerOpen && <PlannerCategoryOrderManager categoryOrder={plannerCategoryOrder} categories={plannerCategoryCatalog} onSave={(plannerCategoryOrder) => { onSaveProfile({ plannerCategoryOrder }); setCategoryOrderManagerOpen(false); }} onCancel={() => setCategoryOrderManagerOpen(false)} />}
    </section>
  );
}

function InfoLine({ label, value }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value || "未提供"}</strong>
    </div>
  );
}

function PlannerMenu({ label, children }) {
  return (
    <details className="planner-menu">
      <summary>{label}<ChevronRight size={14} /></summary>
      <div className="planner-menu-list">
        {children}
      </div>
    </details>
  );
}

function TaskPoolPreview({ tasks, segments, order, categoryOrder = [], categoryCatalog = [], categoryColors = {}, onEdit, onCreate, onDelete, onClear, onArrange, onEditCategoryOrder }) {
  const { setNodeRef: setPoolNodeRef, isOver: isPoolOver } = useDroppable({ id: "task-pool" });
  const poolSegmentsByTask = (segments || []).reduce((result, segment) => {
    result[segment.id] = [...(result[segment.id] || []), segment];
    return result;
  }, {});
  const visibleTasks = tasks
    .filter((task) => poolSegmentsByTask[task.id]?.length)
    .map((task) => ({ ...task, poolSegments: poolSegmentsByTask[task.id] }));
  const sortedTasks = order.map((id) => visibleTasks.find((task) => task.id === id)).filter(Boolean);
  const groupedTasks = sortedTasks.reduce((groups, task) => {
    const category = plannerCategoryForCatalog(task, categoryCatalog);
    const current = groups.find((item) => item.id === category.id);
    if (current) current.tasks.push(task);
    else groups.push({ id: category.id, label: category.name, tasks: [task] });
    return groups;
  }, []);
  const orderedGroups = sortCategoriesByOrder(groupedTasks, categoryOrder);
  return (
    <div ref={setPoolNodeRef} className={`schedule-task-pool ${isPoolOver ? "drag-over" : ""}`}>
      <div className="mini-section-title">
        <div>
          <strong>任务池</strong>
          <span>拖拽到时间线</span>
        </div>
        <button className="secondary-button compact category-order-button" type="button" onClick={onEditCategoryOrder}>调整分类顺序</button>
      </div>
      <div className="button-row"><button className="primary-button compact" type="button" onClick={onCreate}><Plus size={16} />新增当天任务块</button><button className="secondary-button compact danger-text" type="button" disabled={!segments.length} onClick={onClear}>清空任务池</button></div>
      <SortableContext items={sortedTasks.map((task) => `task-sort-${task.id}`)} strategy={verticalListSortingStrategy}>
        <div className="task-pool-list">
          {orderedGroups.map((group) => <Fragment key={group.id}>
            <div className="task-pool-category-title">{group.label}<span>{group.tasks.reduce((sum, task) => sum + task.poolSegments.length, 0)} 段</span></div>
            {group.tasks.map((task) => (
              <SortableTaskCard task={task} orderIndex={sortedTasks.indexOf(task)} key={task.id} categoryCatalog={categoryCatalog} categoryColors={categoryColors} onEdit={onEdit} onDelete={onDelete} onArrange={onArrange} />
            ))}
          </Fragment>)}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableTaskCard({ task, orderIndex, categoryCatalog = [], categoryColors = {}, onEdit, onDelete, onArrange }) {
  const nextSegment = task.poolSegments?.[0];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-sort-${task.id}`,
    data: {
      source: "task-pool",
      taskId: task.id,
      blockId: nextSegment?.blockId,
      title: task.title,
      category: task.category,
      duration: nextSegment?.occupiedDuration || plannerTaskPrimaryDuration(task),
      workMinutes: nextSegment?.duration ?? plannerTaskPrimaryDuration(task),
      restMinutes: nextSegment?.breakAfter || 0,
    },
  });
  return (
    <div
      ref={setNodeRef}
      className={`task-card ${plannerCategoryClass(task.categoryId || task.category)} ${isDragging ? "dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, borderLeftColor: categoryColors[plannerCategoryId(task)] || plannerCategoryForCatalog(task, categoryCatalog).foreground }}
    >
      <button className="drag-handle" type="button" {...attributes} {...listeners} aria-label={`拖动“${task.title}”`}><GripVertical size={16} /></button>
      <button className="task-card-main" type="button" onClick={() => onEdit({ scope: "group", task })}>
        <strong>{task.title}</strong>
        <span>剩 {task.poolSegments?.length || 0}/{task.segments?.length || 0} 块 · {plannerPoolRemainingText(task)} · 连{task.splittable ? Math.min(2, task.segments?.length || 1) : 1} · P{task.priority}</span>
      </button>
      <button className="task-more-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (window.confirm(`删除“${task.title}”？\n\n只会从当前日期的任务池移除，不会删除模板或历史记录。`)) onDelete(task.id); }} aria-label={`删除任务：${task.title}`}>⋮</button>
      <button className="mobile-arrange-button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onArrange(nextSegment?.blockId); }}>安排</button>
    </div>
  );
}

function TimelinePreview({ plan, dropPreview, timelineRef, nowMinute, categoryColors = {}, onEditTask, onEditFixed, onToggleComplete, onToggleLock, onReturnToPool, onMoveTask, onResizeTask }) {
  const minuteHeight = PLANNER_PX_PER_MINUTE;
  const totalHeight = Math.max(34, (plan.timelineEnd - plan.timelineStart) * minuteHeight);
  const ticks = buildTimelineTicks(plan.timelineStart, plan.timelineEnd);
  const { setNodeRef, isOver } = useDroppable({ id: "timeline" });
  function setTimelineNode(node) {
    setNodeRef(node);
    timelineRef.current = node;
  }
  return (
    <div className="schedule-timeline-wrap">
      <div className="mini-section-title">
        <strong>真实时间线</strong>
        <span>{formatClockMinutes(plan.timelineStart)} - {formatClockMinutes(plan.timelineEnd)}</span>
      </div>
      {plan.conflicts.length > 0 && (
        <div className="timeline-conflict-banner">发现 {plan.conflicts.length} 处排程冲突，请点击一键重新排程或调整固定事件。</div>
      )}
      <div
        ref={setTimelineNode}
        className={`schedule-timeline ${isOver ? "drag-over" : ""}`}
        style={{ height: `${totalHeight}px` }}
      >
        {plan.segmentFree.map((segment) => (
          <div
            className="timeline-segment-band"
            style={{
              top: `${(segment.start - plan.timelineStart) * minuteHeight}px`,
              height: `${Math.max(1, (segment.end - segment.start) * minuteHeight)}px`,
            }}
            key={segment.key}
          >
            <span>{segment.label}</span>
            <small>可用 {minutesLabel(segment.minutes)}</small>
          </div>
        ))}
        {ticks.map((tick) => (
          <div className="timeline-tick" style={{ top: `${(tick - plan.timelineStart) * minuteHeight}px` }} key={tick}>
            <span>{formatClockMinutes(tick)}</span>
            <i />
          </div>
        ))}
        {Number.isFinite(nowMinute) && nowMinute >= plan.timelineStart && nowMinute <= plan.timelineEnd && (
          <div className="timeline-current-time" style={{ top: `${(nowMinute - plan.timelineStart) * minuteHeight}px` }}>
            <span>现在 {formatClockMinutes(nowMinute)}</span>
            <i />
          </div>
        )}
        {plan.blocks.map((block) => (
          <TimelineBlock
            block={block}
            key={block.id}
            timelineStart={plan.timelineStart}
            minuteHeight={minuteHeight}
            categoryColors={categoryColors}
            onEditTask={onEditTask}
            onEditFixed={onEditFixed}
            onToggleComplete={onToggleComplete}
            onToggleLock={onToggleLock}
            onReturnToPool={onReturnToPool}
            onMoveTask={onMoveTask}
            onResizeTask={onResizeTask}
            allBlocks={plan.blocks}
          />
        ))}
        {Number.isFinite(dropPreview?.start) && Number.isFinite(dropPreview?.end) && dropPreview.end > dropPreview.start && (
          <div
            className={`timeline-drop-preview timeline-block-preview ${dropPreview.conflict ? "conflict" : "valid"} ${plannerCategoryClass(dropPreview.categoryId || dropPreview.category)}`}
            style={{
              top: `${(dropPreview.start - plan.timelineStart) * minuteHeight}px`,
              height: `${Math.max(24, (dropPreview.end - dropPreview.start) * minuteHeight - 2)}px`,
            }}
          >
            <strong>{dropPreview.type === "needs-compression" ? "当前落点空间不足，可压缩后放入" : dropPreview.conflict ? "硬边界冲突" : dropPreview.insertionLabel || `精确放置到 ${formatClockMinutes(dropPreview.start)}`}</strong>
            <span>{dropPreview.title} · {formatClockMinutes(dropPreview.start)} - {formatClockMinutes(dropPreview.end)}{dropPreview.deltaMinutes === null ? "" : dropPreview.deltaMinutes === 0 ? " · 位置未变化" : ` · ${dropPreview.deltaMinutes > 0 ? "延后" : "提前"}${Math.abs(dropPreview.deltaMinutes)}min`}</span>
            <small>{dropPreview.workMinutes}{dropPreview.restMinutes ? `+${dropPreview.restMinutes}` : ""} · {dropPreview.type === "exact" ? "松开后放入这里" : "当前放置意图"}</small>
            {dropPreview.type === "ripple" && <small>将顺延 {dropPreview.shifted?.length || 0} 项任务</small>}
            {dropPreview.type === "swap" && <small>{dropPreview.returnedToPool?.length ? "松开后会替换当前位置，并将原任务移回任务池" : "松开后将直接交换两个同长度任务的位置"}</small>}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineBlock({ block, timelineStart, minuteHeight, categoryColors = {}, onEditTask, onEditFixed, onToggleComplete, onToggleLock, onReturnToPool, onMoveTask, onResizeTask, allBlocks = [] }) {
  const [resizePreview, setResizePreview] = useState(null);
  const suppressNextCardClickRef = useRef(false);
  const isMorningRoutine = isMorningRoutineCard(block);
  const draggable = Boolean(!isMorningRoutine && ((block.taskGroup && !block.locked) || (block.kind === "fixed" && !block.locked)));
  const canInsert = block.kind === "task" && block.status !== "completed" && !block.locked;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `timeline-${block.id}`,
    disabled: !draggable,
    data: {
      source: block.kind === "fixed" ? "fixed" : "timeline",
      blockId: block.id,
      title: block.title,
      category: block.category,
      categoryId: block.categoryId,
      duration: block.end - block.start,
      grabOffsetY: 0,
    },
  });
  const { setNodeRef: setInsertNodeRef, isOver: isInsertOver } = useDroppable({ id: `insert-${block.id}`, disabled: !canInsert });
  const setCombinedNodeRef = (node) => { setNodeRef(node); setInsertNodeRef(node); };
  const style = {
    top: `${(block.start - timelineStart) * minuteHeight}px`,
    height: `${Math.max(block.kind === "task" ? 28 : 8, ((resizePreview?.workMinutes ?? block.studyMinutes ?? block.end - block.start) + Number(block.breakMinutes || 0)) * minuteHeight - 2)}px`,
    transform: CSS.Transform.toString(transform),
    borderLeftColor: categoryColors[plannerCategoryId(block)] || plannerCategoryFor(block).foreground,
  };
  const className = `timeline-block ${block.kind} ${plannerCategoryClass(block.categoryId || block.category)} ${block.locked ? "locked" : ""} ${block.status === "completed" ? "completed" : ""} ${block.end - block.start < 20 ? "short" : block.end - block.start < 40 ? "compact" : ""} ${block.conflict ? "conflict" : ""} ${isDragging ? "dragging" : ""}`;
  function beginResize(event) {
    if (block.kind !== "task" || block.status === "completed" || isMorningRoutine) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextCardClickRef.current = true;
    const startY = event.clientY;
    const originalWork = Number(block.studyMinutes ?? block.taskGroup?.segments?.[block.segmentIndex - 1] ?? block.end - block.start);
    const restMinutes = Number(block.breakMinutes || 0);
    let candidate = originalWork;
    const handleMove = (moveEvent) => {
      const next = Math.max(5, Math.round((originalWork + (moveEvent.clientY - startY) / minuteHeight) / 5) * 5);
      const nextEnd = block.start + next + restMinutes;
      const blocker = allBlocks.find((item) => item.id !== block.id && intervalsOverlap({ start: block.start, end: nextEnd }, item));
      if (!blocker) candidate = next;
      setResizePreview({ workMinutes: blocker ? candidate : next, restMinutes, blocker });
    };
    const handleCancel = () => { window.removeEventListener("pointermove", handleMove); setResizePreview(null); };
    const handleUp = () => { window.removeEventListener("pointermove", handleMove); window.removeEventListener("pointercancel", handleCancel); if (candidate !== originalWork) onResizeTask(block.id, candidate); setResizePreview(null); window.setTimeout(() => { suppressNextCardClickRef.current = false; }, 250); };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointercancel", handleCancel, { once: true });
  }
  return (
    <div
      ref={setCombinedNodeRef}
      className={`${className} ${isInsertOver ? "insert-target" : ""}`}
      style={style}
      role="button"
      tabIndex={0}
      onClick={() => { if (suppressNextCardClickRef.current) return; if (block.taskGroup) onEditTask({ scope: "segment", task: block.taskGroup, block }); else onEditFixed(block); }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (block.taskGroup) onEditTask({ scope: "segment", task: block.taskGroup, block });
        else onEditFixed(block);
      }}
    >
      {(block.end - block.start) >= 20 && <span>{formatClockMinutes(block.start)} - {formatClockMinutes(resizePreview ? block.start + resizePreview.workMinutes + resizePreview.restMinutes : block.end)}</span>}
      <div className="timeline-block-title">
        {draggable && <button className="timeline-drag-handle task-drag-handle-hit-area" type="button" {...attributes} {...listeners} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} aria-label={`拖动“${block.title}”`}><GripVertical size={14} /></button>}
        {block.kind === "task" && (
          <button
            type="button"
            className={`timeline-task-checkbox-hit-area ${block.status === "completed" ? "checked" : ""}`}
            aria-label={block.status === "completed" ? `取消完成「${block.title}」` : `标记「${block.title}」完成`}
            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleComplete(block); }}
          >
            <span className="timeline-task-checkbox-visual" aria-hidden="true">{block.status === "completed" && <Check size={11} strokeWidth={3} />}</span>
          </button>
        )}
        <strong>{block.title}{resizePreview ? ` · ${resizePreview.workMinutes}${resizePreview.restMinutes ? `+${resizePreview.restMinutes}` : ""}` : ""}</strong>
        {isMorningRoutine
          ? <button className="timeline-lock-button" type="button" title="设置晨间开始时间和时长" aria-label="设置晨间洗漱时间" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onEditTask({ scope: "segment", task: block.taskGroup, block }); }}><CalendarClock size={14} /></button>
          : block.kind === "task" && <button className="timeline-lock-button" type="button" title={block.locked ? "解锁此时间位置" : "锁定此时间位置"} aria-label={`${block.locked ? "解锁" : "锁定"}“${block.title}”的时间位置`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleLock(block); }}>{block.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>}
        {block.kind === "task" && block.status !== "completed" && !isMorningRoutine && <button className="return-to-pool-button" type="button" aria-label={`将“${block.title}”放回任务池`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onReturnToPool(block.id); }}><Undo2 size={14} /></button>}
        {block.kind === "task" && <button className="mobile-move-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMoveTask(block.id); }}>移动</button>}
      </div>
      {(block.end - block.start) >= 40 && block.note && <small>{block.note}</small>}
      {resizePreview && <div className="resize-preview-popover"><strong>{resizePreview.workMinutes}{resizePreview.restMinutes ? `+${resizePreview.restMinutes}` : ""}</strong><span>{resizePreview.workMinutes > Number(block.studyMinutes || 0) ? `增加 ${resizePreview.workMinutes - Number(block.studyMinutes || 0)}min` : resizePreview.workMinutes < Number(block.studyMinutes || 0) ? `减少 ${Number(block.studyMinutes || 0) - resizePreview.workMinutes}min` : "时长不变"}</span><small>{formatClockMinutes(block.start)}–{formatClockMinutes(block.start + resizePreview.workMinutes + resizePreview.restMinutes)}{resizePreview.blocker ? ` · 到 ${resizePreview.blocker.title} 为止` : ""}</small></div>}
      {block.kind === "task" && block.status !== "completed" && !block.locked && <button className="resize-handle-hit-area" data-resizing={Boolean(resizePreview)} type="button" aria-label={`调整 ${block.title} 的学习时长`} onPointerDown={beginResize}><span className="resize-handle-visual" /></button>}
    </div>
  );
}

function PlannerOverview({ plan, categoryOrder = [], categoryCatalog = [], categoryColors = {}, categoryTree = [], categoryTargets = {}, trackers = [], onEditTargets, onManageTrackers }) {
  const studyComposition = buildStudyComposition(plan, (block) => plannerCategoryForCatalog(block, categoryCatalog).statGroup === "study" || plannerCategoryId(block) === "reading");
  const orderedStudyComposition = sortCategoriesByOrder(studyComposition.rows.map((row) => ({ ...row, label: plannerCategoryForCatalog({ categoryId: row.id, category: row.label }, categoryCatalog).name })), categoryOrder);
  const categoryProgress = sortCategoriesByOrder(buildCategoryTimeProgress({ timelineBlocks: plan.blocks, categoryTree, categoryTargets }).map((item) => ({ ...item, id: item.categoryId, label: item.categoryLabel })), categoryOrder);
  return (
    <aside className="schedule-availability planner-overview">
      <div className="planner-overview-actions">
        <button className="secondary-button compact" type="button" onClick={onEditTargets}>
          设置计划目标
        </button>
      </div>
      <section className="study-composition-card">
        <div className="mini-section-title"><strong>学习构成</strong><span>纯学习时间</span></div>
        <div className="study-composition-body"><div className="study-donut" style={{ background: donutBackground(orderedStudyComposition, categoryColors, studyComposition.totalMinutes, categoryCatalog) }}><strong>{minutesLabel(studyComposition.totalMinutes)}</strong><span>真实学习</span></div><div className="study-legend">{orderedStudyComposition.length ? orderedStudyComposition.map((item) => <span key={item.id}><i style={{ background: categoryColors[item.id] || plannerCategoryForCatalog(item.id, categoryCatalog).foreground }} />{item.label}<strong>{minutesLabel(item.minutes)} · {studyComposition.totalMinutes ? Math.round(item.minutes / studyComposition.totalMinutes * 100) : 0}%</strong></span>) : <small>尚无真实学习任务</small>}</div></div>
      </section>
      {categoryProgress.length > 0 && (
        <section className="placement-progress-card">
          <div className="mini-section-title"><strong>计划时长进度</strong><button className="text-button" type="button" onClick={onEditTargets}>编辑目标</button></div>
          <div className="placement-category-list">{categoryProgress.map((category) => <div className="placement-category" key={category.categoryId} style={{ borderLeftColor: categoryColors[category.categoryId] || plannerCategoryForCatalog(category.categoryId, categoryCatalog).foreground }}><div><strong>{category.categoryLabel}</strong><span>{formatDuration(category.scheduledMinutes)} / {formatDuration(category.targetMinutes)}</span></div><i><em style={{ width: `${Math.min(100, category.ratio * 100)}%` }} /></i><small>{category.targetMinutes ? category.differenceMinutes > 0 ? `已超出 ${formatDuration(category.differenceMinutes)}` : `还差 ${formatDuration(Math.abs(category.differenceMinutes))}` : "请填写目标分钟"}</small></div>)}</div>
        </section>
      )}
      <section className="life-maintenance-card">
        <div className="mini-section-title"><strong>复盘追踪</strong><button className="text-button" type="button" onClick={onManageTrackers}>管理</button></div>
        {trackers.length ? trackers.map((item) => <div className={`maintenance-row ${item.status?.kind || "unavailable"}`} key={item.id}><div><strong>{item.name}</strong><span>{item.status?.label || "暂无记录"}</span><small>{trackerMetricText(item)}</small></div></div>) : <p className="field-help">暂无追踪项目</p>}
      </section>
    </aside>
  );
}

function donutBackground(rows, categoryColors, total, categoryCatalog = []) {
  if (!total) return "#edf1f5";
  let cursor = 0;
  return `conic-gradient(${rows.map((row) => { const start = cursor; cursor += row.minutes / total * 100; return `${categoryColors[row.id] || plannerCategoryForCatalog(row.id, categoryCatalog).foreground} ${start}% ${cursor}%`; }).join(", ")})`;
}

function normalizeReviewTrackers(value = [], legacyMaintenance = []) {
  const source = Array.isArray(value) ? value.filter((item) => item && item.id) : [];
  if (source.length) return source.filter((item) => item.enabled !== false);
  const legacy = mergeLifeMaintenanceItems(legacyMaintenance).filter((item) => item.hidden !== true).map((item) => ({ id: item.id, name: item.name, enabled: true, fieldPath: ["health", item.id === "mask" ? "maskStatus" : "maintenanceCompleted"], displayMetrics: ["lastCompleted", "sinceLast"], goal: { kind: "interval", every: Math.max(1, Number(item.intervalDays) || 1), unit: "day", requiredCount: 1 } }));
  return legacy.length ? legacy : defaultReviewTrackerTemplates();
}

function defaultReviewTrackerTemplates() {
  return [
    { id: "review-mask", name: "面膜", enabled: true, fieldPath: ["selfcare", "today", "mask"], displayMetrics: ["lastCompleted", "sinceLast"], goal: { kind: "interval", every: 3, unit: "day", remindAheadDays: 0 } },
    { id: "review-exercise", name: "完整运动", enabled: true, fieldPath: ["exercise", "today", "totalMinutes"], displayMetrics: ["activeDays", "targetProgress"], goal: { kind: "period", period: "week", measure: "activeDays", target: 4, remindAheadDays: 1 } },
    { id: "review-reading", name: "阅读", enabled: true, fieldPath: ["study", "reading", "totalMinutes"], displayMetrics: ["duration", "weeklyAverage"], goal: { kind: "period", period: "month", measure: "duration", targetMinutes: 720, remindAheadDays: 3 } },
  ];
}

function compareReviewTrackerStatus(left, right) {
  const rank = { overdue: 0, due: 1, near_due: 2, in_progress: 3, normal: 4, unavailable: 5 };
  return (rank[left.status?.kind] ?? 5) - (rank[right.status?.kind] ?? 5);
}

function trackerMetricText(item) {
  if (item.sourceKind === "planner_category") return `${item.completedCardCount || 0}/${item.totalCardCount || 0} 张完成 · ${Math.round((item.completionRate || 0) * 100)}%`;
  const metrics = item.metrics || {};
  const labels = {
    completed: item.completedFromReview ? "已记录" : "未记录",
    periodCount: `本周期 ${metrics.windowCompletedCount || 0} 次`,
    activeDays: `完成 ${metrics.windowCompletedDays || 0} 天`,
    duration: formatDuration(metrics.windowMinutes || 0),
    dailyAverage: `日均 ${formatDuration(metrics.dailyAverageMinutes || 0)}`,
    weeklyAverage: `周均 ${formatDuration(metrics.weeklyAverageMinutes || 0)}`,
    monthlyAverage: `月均 ${formatDuration(metrics.monthlyAverageMinutes || 0)}`,
    lastCompleted: metrics.lastCompletedDate || "未记录",
    sinceLast: metrics.daysSinceLast == null ? "未记录" : `距上次 ${metrics.daysSinceLast} 天`,
    streakDays: `连续 ${metrics.streakDays || 0} 天`,
    streakWeeks: `连续 ${metrics.streakWeeks || 0} 周`,
    targetProgress: `${metrics.targetValue || 0}/${metrics.target || 0}`,
    deadline: item.window?.end ? `截止 ${item.window.end}` : "",
  };
  return (item.displayMetrics || ["lastCompleted", "targetProgress"]).map((key) => labels[key]).filter(Boolean).join(" · ");
}

function reviewFieldOptions() {
  return reviewSchemaFieldOptions().map((option) => [option.value, option.label]);
}

function reviewFieldGroups() {
  return reviewSchemaFields({ trackableOnly: true }).reduce((groups, field) => {
    const key = field.categoryPathIds[0] || "other";
    groups[key] = groups[key] || { label: field.categoryPathIds.slice(0, 2).join(" → "), fields: [] };
    groups[key].fields.push(field);
    return groups;
  }, {});
}

function reviewFieldTree() {
  const root = [];
  const byId = new Map();
  reviewSchemaFields({ trackableOnly: true }).forEach((field) => {
    const path = field.categoryPathIds || [];
    let parentChildren = root;
    path.forEach((id) => {
      if (!byId.has(id)) {
        byId.set(id, { id, label: categoryLabel(id), children: [], fields: [] });
        parentChildren.push(byId.get(id));
      }
      parentChildren = byId.get(id).children;
    });
    const leafId = path.at(-1);
    const node = byId.get(leafId);
    if (node) node.fields.push(field);
  });
  return root;
}

function ReviewTrackerFieldTree({ trackerId, value, onChange }) {
  const selected = Array.isArray(value) ? value.join(".") : String(value || "");
  const renderNode = (node) => (
    <details className="review-field-tree-node" key={node.id} open>
      <summary>{node.label}</summary>
      {node.fields.map((field) => <label className="mini-check review-field-leaf" key={field.id}><input type="radio" name={`review-tracker-field-${trackerId}`} checked={selected === field.id} onChange={() => onChange(field.id.split("."))} />{field.label}</label>)}
      {node.children.map(renderNode)}
    </details>
  );
  return <div className="review-field-tree">{reviewFieldTree().map(renderNode)}</div>;
}

function reviewFieldPathLabel(fieldPath = []) {
  const id = Array.isArray(fieldPath) ? fieldPath.join(".") : String(fieldPath || "");
  const field = reviewSchemaFields({ trackableOnly: true }).find((item) => item.id === id);
  if (!field) return "尚未选择";
  const labels = [...(field.categoryPathIds || []).map(categoryLabel), field.label].filter(Boolean);
  return [...new Set(labels)].join(" > ");
}

function trackerSourceLabel(tracker = {}, taxonomy = []) {
  if (tracker.sourceKind === "planner_category") {
    const category = classificationSecondaryItems(taxonomy).find((item) => item.id === normalizeCategoryId(tracker.categoryId));
    return category ? `${category.primaryName} > ${category.name}` : tracker.categoryId || "生活分类已删除";
  }
  return reviewFieldPathLabel(tracker.fieldPath);
}

function goalSummaryText(goal = {}) {
  const measure = goal.measure || "count";
  const target = measure === "duration" ? formatDuration(goal.targetMinutes || 0) : String(goal.target || 1) + (measure === "activeDays" ? " 天" : " 次");
  const measureText = measure === "duration" ? "累计达到" : "至少完成";
  if (goal.kind === "interval") return "每 " + (goal.every || 1) + " " + unitText(goal.unit || "day") + "至少完成 1 次";
  if (goal.kind === "range") return (goal.startDate || "开始日") + " 到 " + (goal.endDate || "截止日") + " " + measureText + " " + target;
  if (goal.kind === "deadline") return "在 " + (goal.deadline || "截止日") + " 前" + measureText + " " + target;
  return "每" + periodText(goal.period || "week") + measureText + " " + target;
}

function periodText(value) {
  return { day: "日", week: "周", month: "月", year: "年" }[value] || "周";
}

function unitText(value) {
  return { day: "天", week: "周", month: "月", year: "年" }[value] || "天";
}

function CategoryTargetManager({ taxonomy, targets, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({ ...targets }));
  const categories = classificationSecondaryItems(taxonomy).filter((item) => item.enabled !== false);
  const enabled = (id) => Object.prototype.hasOwnProperty.call(form, id);
  const toggle = (id, checked) => setForm((current) => {
    const next = { ...current };
    if (checked) next[id] = Math.max(0, Number(next[id]) || 0);
    else delete next[id];
    return next;
  });
  return <div className="modal-backdrop"><section className="modal-card category-order-manager"><div className="planner-advanced-head"><div><h3>计划时长目标</h3><p>勾选你今天要设置的二级分类；每项独立填写目标分钟。只保存到当前排程日期，不代表实际完成。</p></div><button className="secondary-button compact" type="button" onClick={onCancel}>关闭</button></div><div className="settings-tag-list">{categories.map((category) => <label className="settings-tag-row" key={category.id}><span><input type="checkbox" checked={enabled(category.id)} onChange={(event) => toggle(category.id, event.target.checked)} /> {category.primaryName}｜{category.name}</span>{enabled(category.id) ? <><input type="number" min="0" step="5" value={form[category.id] || ""} onChange={(event) => setForm((current) => ({ ...current, [category.id]: Math.max(0, Number(event.target.value) || 0) }))} /><small>分钟</small></> : <small>未设置</small>}</label>)}</div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => onSave(form)}>保存今日目标</button></div></section></div>;
}

function ReviewTrackerManager({ taxonomy, trackers, onSave, onCancel }) {
  const [form, setForm] = useState(() => trackers);
  const [editingId, setEditingId] = useState(null);
  const metricOptions = [["completed", "是否做过"], ["periodCount", "当前周期完成次数"], ["activeDays", "完成天数"], ["streakDays", "连续完成天数"], ["streakWeeks", "连续完成周数"], ["duration", "累计时长"], ["dailyAverage", "日平均时长"], ["weeklyAverage", "周平均时长"], ["monthlyAverage", "月平均时长"], ["lastCompleted", "上次完成时间"], ["sinceLast", "距上次多久"], ["targetProgress", "目标进度"], ["deadline", "截止日期"]];
  const createTracker = () => {
    const tracker = { id: "tracker-" + Date.now(), name: "新追踪项目", enabled: true, paused: false, fieldPath: ["study", "reading", "totalMinutes"], displayMetrics: ["lastCompleted", "targetProgress"], goal: { kind: "period", period: "week", measure: "activeDays", target: 1, remindAheadDays: 0 } };
    setForm((current) => [...current, tracker]);
    setEditingId(tracker.id);
  };
  const updateTracker = (id, patch) => setForm((current) => current.map((tracker) => tracker.id === id ? { ...tracker, ...patch } : tracker));
  const removeTracker = (id) => { setForm((current) => current.filter((tracker) => tracker.id !== id)); if (editingId === id) setEditingId(null); };
  const moveTracker = (id, direction) => setForm((current) => {
    const rows = [...current]; const index = rows.findIndex((tracker) => tracker.id === id); const target = index + direction;
    if (index < 0 || target < 0 || target >= rows.length) return current;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    return rows;
  });
  const editing = form.find((tracker) => tracker.id === editingId) || null;
  return <div className="modal-backdrop"><section className="modal-card tracker-manager-modal">
    <div className="manager-fixed-head"><div><h3>复盘追踪管理</h3><p>创建后，系统会从每日复盘中计算频率、时长和上次完成时间。</p></div><button className="secondary-button compact" type="button" onClick={onCancel}>关闭</button></div>
    <div className="tracker-manager-scroll"><div className="tracker-list-toolbar"><button className="primary-button compact" type="button" onClick={createTracker}>新增追踪项目</button><button className="secondary-button compact" type="button" onClick={() => setForm(defaultReviewTrackerTemplates())}>恢复默认</button></div>
      {!form.length && <div className="empty-text">还没有复盘追踪项目。创建后，系统会从每日复盘中计算频率、时长和上次完成时间。</div>}
      <div className="tracker-card-list">{form.map((tracker, index) => <article className="tracker-summary-card" key={tracker.id}><div><strong>{tracker.name || "未命名追踪项目"}</strong><span>来源：{trackerSourceLabel(tracker, taxonomy)}</span><span>目标：{goalSummaryText(tracker.goal || {})}</span><span>展示：{(tracker.displayMetrics || []).map((metric) => metricOptions.find(([value]) => value === metric)?.[1] || metric).join("、") || "未选择"}</span></div><div className="tracker-card-actions"><span className={tracker.enabled === false || tracker.paused === true ? "status-pill muted" : "status-pill ok"}>{tracker.enabled === false ? "停用" : tracker.paused === true ? "暂停" : "正常"}</span><button className="secondary-button compact" type="button" onClick={() => setEditingId(tracker.id)}>编辑</button><button className="secondary-button compact" type="button" onClick={() => moveTracker(tracker.id, -1)} disabled={index === 0}>上移</button><button className="secondary-button compact" type="button" onClick={() => moveTracker(tracker.id, 1)} disabled={index === form.length - 1}>下移</button><button className="secondary-button compact danger-text" type="button" onClick={() => removeTracker(tracker.id)}>删除</button></div></article>)}</div>
    </div>
    <div className="manager-fixed-foot"><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" onClick={() => onSave(form)}>保存追踪器</button></div>
    {editing && <ReviewTrackerEditor tracker={editing} taxonomy={taxonomy} metricOptions={metricOptions} onChange={(patch) => updateTracker(editing.id, patch)} onMove={(direction) => moveTracker(editing.id, direction)} onDelete={() => removeTracker(editing.id)} onClose={() => setEditingId(null)} />}
  </section></div>;
}

function ReviewTrackerEditor({ tracker, taxonomy = [], metricOptions, onChange, onMove, onDelete, onClose }) {
  const goal = tracker.goal || {};
  const updateGoal = (patch) => onChange({ goal: { ...goal, ...patch } });
  const toggleMetric = (metric) => {
    const current = tracker.displayMetrics || [];
    onChange({ displayMetrics: current.includes(metric) ? current.filter((item) => item !== metric) : [...current, metric] });
  };
  return <div className="tracker-editor-shell"><div className="manager-fixed-head"><div><h3>{tracker.name || "编辑追踪项目"}</h3><p>按顺序选择字段、展示指标、目标和提醒状态。</p></div><button className="secondary-button compact" type="button" onClick={onClose}>返回列表</button></div><div className="tracker-editor-scroll">
    <section className="tracker-edit-section"><h4>1. 追踪什么</h4><p>可选择每日复盘字段，或直接追踪生活二级分类卡片的完成次数与完成率。</p><TextField label="项目名称" value={tracker.name} onChange={(name) => onChange({ name })} /><label className="field"><span>生活卡片分类</span><select value={tracker.sourceKind === "planner_category" ? tracker.categoryId || "" : ""} onChange={(event) => { const category = classificationSecondaryItems(taxonomy).find((item) => item.id === event.target.value); onChange(event.target.value ? { sourceKind: "planner_category", categoryId: event.target.value, name: tracker.name === "新追踪项目" && category ? category.name : tracker.name, fieldPath: [], displayMetrics: ["completed", "periodCount", "targetProgress"], goal: { ...goal, measure: "activeDays" } } : { sourceKind: "review_field", categoryId: "" }); }}><option value="">使用复盘字段</option>{classificationSecondaryItems(taxonomy).filter((item) => item.primaryId === "life" && item.enabled !== false).map((item) => <option key={item.id} value={item.id}>生活｜{item.name}</option>)}</select></label>{tracker.sourceKind !== "planner_category" && <div className="field"><span>复盘字段</span><ReviewTrackerFieldTree trackerId={tracker.id} value={tracker.fieldPath} onChange={(fieldPath) => onChange({ sourceKind: "review_field", fieldPath })} /></div>}{tracker.sourceKind !== "planner_category" && !tracker.fieldPath?.length && <p className="field-help">先选择一个复盘字段，右侧追踪才知道要读哪一项。</p>}</section>
    <section className="tracker-edit-section"><h4>2. 展示什么</h4><p>选择追踪卡片上需要显示的摘要，不影响底层统计。</p><div className="metric-chip-grid">{metricOptions.map(([value, label]) => <button className={tracker.displayMetrics?.includes(value) ? "metric-chip selected" : "metric-chip"} type="button" key={value} onClick={() => toggleMetric(value)}>{label}</button>)}</div></section>
    <section className="tracker-edit-section"><h4>3. 目标是什么</h4><p>只填写当前目标类型需要的字段。</p><label className="field"><span>目标类型</span><select value={goal.kind || "period"} onChange={(event) => updateGoal({ kind: event.target.value })}><option value="period">按自然周期累计</option><option value="interval">每隔一段时间</option><option value="range">指定日期范围</option><option value="deadline">截止日前累计</option></select></label>{goal.kind === "interval" ? <div className="natural-goal-row">每 <input type="number" min="1" value={goal.every || 1} onChange={(event) => updateGoal({ every: Math.max(1, Number(event.target.value) || 1) })} /> <select value={goal.unit || "day"} onChange={(event) => updateGoal({ unit: event.target.value })}><option value="day">天</option><option value="week">周</option><option value="month">月</option><option value="year">年</option></select> 至少完成 1 次</div> : <div className="natural-goal-row">每 <select value={goal.period || "week"} disabled={goal.kind !== "period"} onChange={(event) => updateGoal({ period: event.target.value })}><option value="day">日</option><option value="week">周</option><option value="month">月</option><option value="year">年</option></select> <select value={goal.measure || "activeDays"} onChange={(event) => updateGoal({ measure: event.target.value })}><option value="count">累计次数</option><option value="activeDays">累计天数</option><option value="duration">累计时长</option></select> 达到 <input type="number" min="1" value={goal.measure === "duration" ? goal.targetMinutes || 60 : goal.target || 1} onChange={(event) => updateGoal(goal.measure === "duration" ? { targetMinutes: Math.max(1, Number(event.target.value) || 1) } : { target: Math.max(1, Number(event.target.value) || 1) })} /> {goal.measure === "duration" ? "分钟" : ""}</div>}{goal.kind === "range" && <div className="two-column-fields"><TextField label="开始日期" type="date" value={goal.startDate || ""} onChange={(startDate) => updateGoal({ startDate })} /><TextField label="截止日期" type="date" value={goal.endDate || ""} onChange={(endDate) => updateGoal({ endDate })} /></div>}{goal.kind === "deadline" && <TextField label="截止日期" type="date" value={goal.deadline || ""} onChange={(deadline) => updateGoal({ deadline })} />}</section>
    <section className="tracker-edit-section"><h4>4. 提醒和状态</h4><p>排序只影响展示顺序，暂停不会删除配置。</p><div className="two-column-fields"><NumberField label="提前提醒天数" value={goal.remindAheadDays || 0} onChange={(remindAheadDays) => updateGoal({ remindAheadDays })} /><label className="mini-check"><input type="checkbox" checked={tracker.enabled !== false} onChange={(event) => onChange({ enabled: event.target.checked })} />启用</label><label className="mini-check"><input type="checkbox" checked={tracker.paused === true} onChange={(event) => onChange({ paused: event.target.checked })} />暂停</label></div><div className="button-row"><button className="secondary-button compact" type="button" onClick={() => onMove(-1)}>上移</button><button className="secondary-button compact" type="button" onClick={() => onMove(1)}>下移</button><button className="secondary-button compact danger-text" type="button" onClick={onDelete}>删除</button></div><details className="advanced-info"><summary>高级信息</summary><code>{trackerSourceLabel(tracker, taxonomy)}</code></details></section>
  </div></div>;
}

function PlannerCategoryOrderManager({ categoryOrder, categories = [], onSave, onCancel }) {
  const categoryIds = categories.map((category) => category.id);
  const [order, setOrder] = useState(() => normalizePlannerCategoryOrder(categoryOrder, categoryIds));
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const orderedCategories = order.map((id) => categoriesById.get(id) || plannerCategoryForCatalog(id, categories)).filter(Boolean);
  return <div className="modal-backdrop" role="presentation"><section className="modal-card category-order-manager" role="dialog" aria-modal="true" aria-labelledby="category-order-title"><div className="planner-advanced-head"><div><h3 id="category-order-title">调整分类顺序</h3><p>只影响任务池、右侧进度和学习图例的视觉顺序，不改变自动排程优先级。</p></div><button className="secondary-button compact" type="button" onClick={onCancel}>关闭</button></div><DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={({ active, over }) => { if (!over || active.id === over.id) return; setOrder((current) => arrayMove(current, current.indexOf(active.id), current.indexOf(over.id))); }}><SortableContext items={order} strategy={verticalListSortingStrategy}><div className="category-order-list">{orderedCategories.map((category) => <SortableCategoryOrderRow category={category} key={category.id} />)}</div></SortableContext></DndContext><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setOrder(normalizePlannerCategoryOrder([], categoryIds))}>恢复默认顺序</button><button className="primary-button" type="button" onClick={() => onSave(order)}>保存顺序</button></div></section></div>;
}

function SortableCategoryOrderRow({ category }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: category.id });
  return <div ref={setNodeRef} className="category-order-row" style={{ transform: CSS.Transform.toString(transform), transition, borderLeftColor: category.foreground }}><button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`拖动分类“${category.name}”`}><GripVertical size={16} /></button><strong>{category.name}</strong></div>;
}

function maintenanceStatusText(item) {
  if (item.completedToday) return "今天已完成";
  if (!item.lastCompletedDate) return "暂无记录";
  if (item.due) return item.id === "mask" ? `${item.lastCompletedDate} · 今天建议敷面膜` : `${item.lastCompletedDate} · 已到期`;
  if (item.nearDue) return `${item.lastCompletedDate} · 明天到期`;
  return `${item.lastCompletedDate} · 状态正常`;
}

function LifeMaintenanceManager({ items, itemOrder = [], onSave, onCancel, onRecordToday }) {
  const [form, setForm] = useState(() => mergeLifeMaintenanceItems(items));
  const [order, setOrder] = useState(() => normalizeMaintenanceItemOrder(itemOrder, mergeLifeMaintenanceItems(items)));
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const update = (id, patch) => setForm((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const add = () => {
    const item = { id: `maintenance-${Date.now()}`, name: "新维护项", hidden: false, builtIn: false, intervalDays: 7, remindAheadDays: 1 };
    setForm((current) => [...current, item]);
    setOrder((currentOrder) => normalizeMaintenanceItemOrder([...currentOrder, item.id]));
  };
  const orderedItems = normalizeMaintenanceItemOrder(order, form).map((id) => form.find((item) => item.id === id)).filter(Boolean);
  return <div className="modal-backdrop" role="presentation"><section className="modal-card maintenance-manager" role="dialog" aria-modal="true" aria-labelledby="maintenance-manager-title">
    <div className="planner-advanced-head"><div><h3 id="maintenance-manager-title">生活维护管理</h3><p>提醒配置保存在个人 profile；完成记录仍以每日结算 health 为准。</p></div><button className="secondary-button compact" type="button" onClick={onCancel}>关闭</button></div>
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={({ active, over }) => { if (!over || active.id === over.id) return; setOrder((current) => arrayMove(current, current.indexOf(active.id), current.indexOf(over.id))); }}><SortableContext items={orderedItems.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="maintenance-manager-list">{orderedItems.map((item) => <SortableLifeMaintenanceRow item={item} key={item.id} onUpdate={update} onDelete={(id) => { setForm((current) => current.filter((entry) => entry.id !== id)); setOrder((current) => current.filter((entryId) => entryId !== id)); }} />)}</div></SortableContext></DndContext>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={add}>新增自定义项</button><button className="secondary-button" type="button" onClick={onRecordToday}>去每日结算记录今天完成</button><button className="primary-button" type="button" onClick={() => onSave({ healthMaintenanceItems: form, maintenanceItemOrder: normalizeMaintenanceItemOrder(order, form) })}>保存提醒设置</button></div>
  </section></div>;
}

function SortableLifeMaintenanceRow({ item, onUpdate, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  return <div ref={setNodeRef} className="maintenance-manager-row" style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`拖动维护项目“${item.name}”`}><GripVertical size={16} /></button>
    <label className="mini-check"><input type="checkbox" checked={item.hidden !== true} onChange={(event) => onUpdate(item.id, { hidden: !event.target.checked })} />启用</label>
    <input value={item.name || ""} onChange={(event) => onUpdate(item.id, { name: event.target.value })} aria-label="维护项目名称" />
    <label>间隔<input type="number" min="1" value={item.intervalDays || ""} onChange={(event) => onUpdate(item.id, { intervalDays: Number(event.target.value) || 1 })} />天</label>
    <label>提前<input type="number" min="0" value={item.remindAheadDays || 0} onChange={(event) => onUpdate(item.id, { remindAheadDays: Math.max(0, Number(event.target.value) || 0) })} />天</label>
    {!item.builtIn && <button className="icon-button danger" type="button" aria-label="删除维护项" onClick={() => onDelete(item.id)}><Trash2 size={16} /></button>}
  </div>;
}

function MorningRoutineModal({ block, onCancel, onSave }) {
  const [startTime, setStartTime] = useState(formatClockMinutes(block.start));
  const [duration, setDuration] = useState(Number(block.studyMinutes || 20));
  const start = clockToDayMinutes(startTime) ?? block.start;
  const end = start + Math.max(1, Number(duration || 0));
  return <div className="modal-backdrop"><form className="task-edit-modal" onSubmit={(event) => { event.preventDefault(); onSave(start, Math.max(1, Number(duration || 0)), false); }}><div className="panel-title"><div><p className="eyebrow">当天永久起点</p><h2>晨间洗漱</h2></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><TextField label="开始时间" value={startTime} onChange={setStartTime} /><NumberField label="时长（分钟）" value={duration} step={1} onChange={(value) => setDuration(Number(value || 0))} /><p className="field-help">结束时间：{formatClockMinutes(end)}。晨间洗漱始终是时间线第一张，不能删除或移回任务池。</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="secondary-button" type="button" onClick={() => onSave(start, Math.max(1, Number(duration || 0)), true)}>修改今天并设为默认</button><button className="primary-button" type="submit">仅修改今天</button></div></form></div>;
}

function MorningRoutineConflictModal({ conflict, onCancel, onConfirm }) {
  const { plan } = conflict;
  const blocker = plan.blocker || {};
  const canRipple = plan.type === "success-ripple";
  return <div className="modal-backdrop"><div className="task-edit-modal recovery-modal" role="dialog" aria-modal="true" aria-label="晨间卡时间冲突"><div className="panel-title"><div><p className="eyebrow">需要先处理冲突</p><h2>{canRipple ? "确认顺延后续任务" : `晨间洗漱与「${blocker.title || "当天边界"}」冲突`}</h2></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><p className="field-help">晨间洗漱拟定 {formatClockMinutes(plan.start)}–{formatClockMinutes(plan.end)}。{plan.reason || "请调整后再保存。"}</p><div className="recovery-preview-grid"><InfoLine label={canRipple ? "第一张受影响卡" : "冲突卡"} value={blocker.title || "当天边界"} /><InfoLine label={canRipple ? "将顺延" : "重叠时段"} value={canRipple ? `${plan.shifted?.length || 0} 张后续卡` : Number.isFinite(blocker.start) ? `${formatClockMinutes(Math.max(plan.start, blocker.start))}–${formatClockMinutes(Math.min(plan.end, blocker.end))}` : "无法顺延"} /></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消</button>{canRipple && <button className="primary-button" type="button" onClick={onConfirm}>顺延后续任务</button>}</div></div></div>;
}

function EditTaskBlockModal({ editing, taxonomy = [], rhythmPresets, onSaveRhythmPresets, onCancel, onSaveTask, onSaveSegment, onMoveSegmentToPool, onDeleteTask, onCopyTask, onRescheduleAfter }) {
  const task = editing.task || editing;
  const block = editing.block;
  const isSegment = editing.scope === "segment" && block;
  const [form, setForm] = useState(() => ({
    title: task.title || "",
    rhythmPresetId: "",
    workMinutes: Number(block?.studyMinutes ?? task.segments?.[0] ?? 50),
    breakMinutes: Number(block?.breakMinutes ?? task.breakMinutes ?? 0),
    locked: Boolean(block?.locked),
    priority: Number(block?.priority || task.priority || 2),
    preferredPeriod: block?.preferredPeriods?.[0] || task.preferredPeriods?.[0] || "afternoon",
    categoryId: plannerCategoryId(task),
    scope: isSegment ? "segment" : "group",
  }));
  const enabledPresets = (rhythmPresets || []).filter((item) => item.enabled !== false);
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  return (
    <div className="modal-backdrop">
      <form className="task-edit-modal" onSubmit={(event) => {
        event.preventDefault();
        if (isSegment && form.scope !== "group") {
          onSaveSegment(block.id, {
            workMinutes: form.workMinutes,
            restMinutes: form.breakMinutes,
            locked: form.locked,
            priority: form.priority,
            preferredPeriods: [form.preferredPeriod],
            ...plannerCategoryPatch(form.categoryId, taxonomy),
          });
        } else {
          onSaveTask(task.id, {
            title: form.title,
            segments: Array.from({ length: Math.max(1, Number(form.segmentCount || task.segments?.length || 1)) }, () => Math.max(0, Number(form.workMinutes || 0))),
            breakMinutes: Math.max(0, Number(form.breakMinutes || 0)),
            priority: form.priority,
            preferredPeriods: [form.preferredPeriod],
            ...plannerCategoryPatch(form.categoryId, taxonomy),
          });
        }
      }}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">仅修改今天 · {isSegment ? `当前块 ${block.segmentIndex}/${block.segmentTotal}` : "整个任务组"}</p>
            <h2>{isSegment ? "编辑当前块" : "编辑任务块"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <TextField label="任务名称" value={form.title} onChange={(value) => update("title", value)} />
        {isSegment && <div className="scope-switch"><label><input type="radio" name="editScope" checked={form.scope === "segment"} onChange={() => update("scope", "segment")} />仅修改当前块</label><label><input type="radio" name="editScope" checked={form.scope === "group"} onChange={() => update("scope", "group")} />修改今天剩余任务组</label></div>}
        <CascadingCategoryFields taxonomy={taxonomy} categoryId={form.categoryId} onChange={(value) => update("categoryId", value)} />
        {!isSegment && <div className="rhythm-options">
          {enabledPresets.map((preset) => <button className={form.rhythmPresetId === preset.id ? "active" : ""} type="button" key={preset.id} onClick={() => setForm((current) => ({ ...current, rhythmPresetId: preset.id, workMinutes: preset.workMinutes, breakMinutes: preset.restMinutes, segmentCount: preset.segmentCount }))}>{preset.label}</button>)}
        </div>}
        <div className="two-column-fields">
          <NumberField label={isSegment || form.scope === "segment" ? "当前块学习分钟" : "每段学习分钟"} value={form.workMinutes} step={1} onChange={(value) => update("workMinutes", Number(value || 0))} />
          <NumberField label={isSegment || form.scope === "segment" ? "当前块后休息分钟" : "每段休息分钟"} value={form.breakMinutes} step={1} onChange={(value) => update("breakMinutes", Number(value || 0))} />
          {(!isSegment || form.scope === "group") && <NumberField label="段数" value={form.segmentCount || task.segments?.length || 1} step={1} onChange={(value) => update("segmentCount", Number(value || 1))} />}
          <SelectField label="偏好时段" value={form.preferredPeriod} onChange={(value) => update("preferredPeriod", value)} options={[["morning", "上午"], ["midday", "午间"], ["afternoon", "下午"], ["evening", "晚间"]]} />
        </div>
        <SelectField label="优先级" value={String(form.priority)} onChange={(value) => update("priority", Number(value))} options={[["1", "P1 高"], ["2", "P2 中等"], ["3", "P3 可选"]]} />
        {isSegment && <label className="check-field"><input type="checkbox" checked={form.locked} onChange={(event) => update("locked", event.target.checked)} />锁定位置（自动排程不会移动）</label>}
        <div className="rhythm-adjust-row">
          <button type="button" onClick={() => update("breakMinutes", Number(form.breakMinutes || 0) + 5)}>+5min休息</button>
          <button type="button" onClick={() => update("breakMinutes", Number(form.breakMinutes || 0) + 10)}>+10min休息</button>
          <button type="button" onClick={() => update("breakMinutes", Math.max(0, Number(form.breakMinutes || 0) - 5))}>减少5min休息</button>
          <button type="button" onClick={() => update("breakMinutes", 0)}>本块不休息</button>
          <button type="button" onClick={() => setForm((current) => ({ ...current, workMinutes: 50, breakMinutes: 10 }))}>恢复 50+10</button>
        </div>
        <details className="preset-manager"><summary>管理节奏库</summary><RhythmPresetManager presets={rhythmPresets} onSave={onSaveRhythmPresets} /></details>
        <div className={`task-preview-card ${plannerCategoryClass(form.categoryId)}`}>
          <span>时间线显示预览</span>
          <strong>{form.title}｜{form.workMinutes}{form.breakMinutes ? `+${form.breakMinutes}` : ""}{!isSegment && (form.segmentCount || task.segments?.length || 1) > 1 ? ` ×${form.segmentCount || task.segments?.length}` : ""}</strong>
          <small>仅保存今天，分类与节奏会同步到尚未完成的任务。</small>
        </div>
        <div className="modal-actions">
          {isSegment && <button className="secondary-button" type="button" onClick={() => onMoveSegmentToPool(block.id)}>移回任务池</button>}
          <button className="secondary-button" type="button" onClick={() => onCopyTask(task)}>复制卡片</button>
          <button className="secondary-button danger-text" type="button" onClick={() => onDeleteTask(task)}>删除当天卡片</button>
          {isSegment && <button className="secondary-button" type="button" onClick={() => onRescheduleAfter(block.id)}>重排此块之后</button>}
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" type="submit">保存今天修改</button>
        </div>
      </form>
    </div>
  );
}

function RhythmPresetManager({ presets = [], onSave }) {
  const [draft, setDraft] = useState(() => normalizeRhythmPresets(presets));
  useEffect(() => setDraft(normalizeRhythmPresets(presets)), [presets]);
  const update = (id, patch) => setDraft((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  return <div className="preset-manager-body">
    <p className="field-help">点节奏只会填入编辑表单；在这里保存后，才会更新你的可选节奏库。</p>
    {draft.map((preset, index) => <div className="preset-row" key={preset.id}>
      <input value={preset.label} aria-label="节奏名称" onChange={(event) => update(preset.id, { label: event.target.value })} />
      <input type="number" min="0" step="5" value={preset.workMinutes} aria-label="学习分钟" onChange={(event) => update(preset.id, { workMinutes: Number(event.target.value || 0) })} />
      <input type="number" min="0" step="5" value={preset.restMinutes} aria-label="休息分钟" onChange={(event) => update(preset.id, { restMinutes: Number(event.target.value || 0) })} />
      <input type="number" min="1" value={preset.segmentCount} aria-label="段数" onChange={(event) => update(preset.id, { segmentCount: Number(event.target.value || 1) })} />
      <label><input type="checkbox" checked={preset.enabled} onChange={(event) => update(preset.id, { enabled: event.target.checked })} />启用</label>
      {!preset.builtIn && <button className="icon-button danger" type="button" onClick={() => setDraft((current) => current.filter((item) => item.id !== preset.id))}>×</button>}
      <button className="icon-button" type="button" disabled={index === 0} onClick={() => setDraft((current) => arrayMove(current, index, index - 1).map((item, order) => ({ ...item, order })))}>↑</button>
    </div>)}
    <div className="button-row"><button className="secondary-button compact" type="button" onClick={() => setDraft((current) => [...current, { id: `rhythm-${Date.now()}`, label: "自定义", workMinutes: 50, restMinutes: 10, segmentCount: 1, order: current.length, enabled: true, builtIn: false }])}>新增节奏</button><button className="primary-button compact" type="button" onClick={() => onSave(normalizeRhythmPresets(draft))}>保存节奏库</button></div>
  </div>;
}

function RecoveryScheduleModal({ cutoffTime, preview, onChangeCutoff, onCancel, onConfirm }) {
  if (!preview) return null;
  return (
    <div className="modal-backdrop">
      <div className="task-edit-modal recovery-modal" role="dialog" aria-modal="true" aria-label="从现在接着排预览">
        <div className="panel-title">
          <div>
            <p className="eyebrow">恢复排程预览</p>
            <h2>从 {cutoffTime} 接着排</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <TextField label="从这个时间开始" value={cutoffTime} onChange={onChangeCutoff} />
        <p className="field-help">已完成、固定和你主动锁定的任务会保留；其他普通任务会回到任务池，再从这个时间之后重新放入。</p>
        <div className="recovery-preview-grid">
          <InfoLine label="将保留任务" value={`${preview.preservedTaskCount} 段`} />
          <InfoLine label="将保留固定事件" value={`${preview.preservedFixedCount} 项`} />
          <InfoLine label="将回到任务池" value={`${preview.returnedTaskCount} 段`} />
          <InfoLine label="预计重新放入" value={`${preview.plannedSegments.length} 段`} />
          <InfoLine label="预计仍未安排" value={`${preview.stillUnplaced.length} 段`} />
        </div>
        {preview.stillUnplaced.length > 0 && (
          <div className="planner-warning-list">
            <span>空间不够的任务会留在任务池：{preview.stillUnplaced.map((segment) => segment.segmentTitle).join("、")}</span>
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" type="button" onClick={onConfirm}>确认接着排</button>
        </div>
      </div>
    </div>
  );
}

function DragConflictModal({ conflict, onCancel, onPlaceNearest, onCompress, onNoRest, onManualCompress }) {
  const blocker = conflict.preview.conflictBlock;
  const requestedWork = Number(conflict.preview.requestedWork ?? conflict.active?.workMinutes ?? conflict.active?.duration ?? 0);
  const requestedRest = Number(conflict.preview.requestedRest ?? conflict.active?.restMinutes ?? 0);
  const [workMinutes, setWorkMinutes] = useState(requestedWork);
  const [restMinutes, setRestMinutes] = useState(requestedRest);
  const nearestGap = conflict.preview.gapEnd ? { start: conflict.preview.start, end: conflict.preview.gapEnd } : conflict.nearestGap;
  const availableMinutes = Number(conflict.preview.availableMinutes ?? (Number(nearestGap?.end || 0) - Number(nearestGap?.start || 0)));
  const canCompressRest = availableMinutes >= requestedWork && availableMinutes < requestedWork + requestedRest;
  const canDropWithoutRest = availableMinutes >= requestedWork;
  const isPoolGapCompression = conflict.preview.type === "needs-compression" && Boolean(nearestGap);
  const minimumWorkMinutes = 5;
  const keepRestWorkMinutes = availableMinutes - requestedRest;
  const canKeepRestInGap = keepRestWorkMinutes >= minimumWorkMinutes && availableMinutes < requestedWork + requestedRest;
  const canUseGapWithoutRest = availableMinutes >= minimumWorkMinutes && availableMinutes < requestedWork + requestedRest;
  return (
    <div className="modal-backdrop">
      <div className="task-edit-modal recovery-modal" role="dialog" aria-modal="true" aria-label="时间冲突提示">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{isPoolGapCompression ? "真实空档不足" : "当前位置不可用"}</p>
            <h2>{isPoolGapCompression ? "选择这一段的压缩方式" : `与「${blocker?.title || "已有任务"}」冲突`}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        {isPoolGapCompression ? (
          <>
            <p className="field-help">这个真实空档装不下原节奏；不会移动空档两侧的任务，只会修改今天这一段。</p>
            <div className="recovery-preview-grid">
              <InfoLine label="可用空档" value={`${formatClockMinutes(nearestGap.start)}–${formatClockMinutes(nearestGap.end)}，共 ${availableMinutes} 分钟`} />
              <InfoLine label="原任务" value={`${requestedWork}+${requestedRest}，共 ${requestedWork + requestedRest} 分钟`} />
              <InfoLine label="保留休息" value={canKeepRestInGap ? `${keepRestWorkMinutes}+${requestedRest}` : `学习少于 ${minimumWorkMinutes} 分钟，不能使用`} />
              <InfoLine label="不休息" value={canUseGapWithoutRest ? `${availableMinutes}+0` : `空档少于 ${minimumWorkMinutes} 分钟，不能使用`} />
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
              <button className="secondary-button" type="button" disabled={!canKeepRestInGap} onClick={onCompress}>压缩至 {availableMinutes} 分钟（保留休息：{Math.max(0, keepRestWorkMinutes)}+{requestedRest}）</button>
              <button className="primary-button" type="button" disabled={!canUseGapWithoutRest} onClick={onNoRest}>压缩至 {availableMinutes} 分钟（不休息：{availableMinutes}+0）</button>
            </div>
          </>
        ) : (
          <>
            <p className="field-help">不会自动挪动其他任务。先看真实空档，再决定移动或压缩节奏。</p>
            <div className="recovery-preview-grid">
              <InfoLine label="拖放位置" value={`${formatClockMinutes(conflict.preview.start)} - ${formatClockMinutes(conflict.preview.end)}`} />
              <InfoLine label="阻挡任务" value={blocker?.title || "时间边界"} />
              <InfoLine label="任务节奏" value={`${requestedWork} 学习 + ${requestedRest} 休息`} />
              <InfoLine label="当前落点可用空档" value={nearestGap ? `${formatClockMinutes(nearestGap.start)} - ${formatClockMinutes(nearestGap.end)}（${availableMinutes}min）` : "没有完整空档"} />
            </div>
            {nearestGap && <p className="field-help">{availableMinutes >= requestedWork + requestedRest ? "空档足够，可直接移动。" : canCompressRest ? `还差 ${requestedWork + requestedRest - availableMinutes}min：可保留学习、压缩休息。` : canDropWithoutRest ? "取消本段休息后可以保留完整学习时长。" : `还差 ${Math.max(0, requestedWork - availableMinutes)}min，需手动确认学习与休息时长。`}</p>}
            <div className="two-column-fields">
              <NumberField label="手动学习分钟" value={workMinutes} onChange={setWorkMinutes} />
              <NumberField label="手动休息分钟" value={restMinutes} onChange={setRestMinutes} />
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
              <button className="secondary-button" type="button" disabled={!canCompressRest} onClick={onCompress}>压缩休息后放入</button>
              <button className="secondary-button" type="button" disabled={!canDropWithoutRest} onClick={onNoRest}>取消休息后放入</button>
              <button className="secondary-button" type="button" onClick={() => onManualCompress(workMinutes, restMinutes)}>确认手动节奏</button>
              <button className="primary-button" type="button" onClick={onPlaceNearest}>放到最近空档</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TaskMoveSheet({ state, plan, onCancel, onReturn, onMove }) {
  const [time, setTime] = useState(state.time);
  const nearest = findNearestPlannerPlacement(plan, { blockId: state.blockId, duration: state.duration }, plan.timelineStart);
  return (
    <div className="drawer-backdrop">
      <div className="today-task-drawer task-move-sheet">
        <div className="panel-title"><div><p className="eyebrow">点击式移动</p><h2>{state.title}</h2></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div>
        <p className="field-help">与拖拽使用相同的冲突规则；不会触发全日重排。</p>
        <button className="primary-button full" type="button" disabled={!nearest} onClick={() => nearest && onMove(nearest.start)}>放到最近完整空档{nearest ? `（${formatClockMinutes(nearest.start)}）` : ""}</button>
        <TextField label="选择开始时间" value={time} onChange={setTime} />
        <button className="secondary-button full" type="button" onClick={() => onMove(clockToDayMinutes(time) ?? plan.timelineStart)}>按这个时间移动</button>
        {state.source !== "pool" && <button className="secondary-button full" type="button" onClick={onReturn}>放回任务池</button>}
        <button className="secondary-button full" type="button" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

function CreateTodayTaskDrawer({ tasks, taxonomy = [], commonTasks, rhythmPresets, onCancel, onSave }) {
  const [form, setForm] = useState({ title: "自定义任务", categoryId: "personal", priority: 2, preferredPeriod: "afternoon", rhythm: "50+10", splittable: true });
  const rhythm = parsePlannerRhythm(form.rhythm);
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  return (
    <div className="drawer-backdrop">
      <form className="today-task-drawer" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, ...plannerCategoryPatch(form.categoryId, taxonomy), preferredPeriods: [form.preferredPeriod] }); }}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">仅作用于今天，不覆盖模板</p>
            <h2>新增当天任务块</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <SelectField label="从今日任务复制" value="" onChange={(value) => {
          const source = tasks.find((item) => item.id === value);
          if (source) setForm({ title: source.title, categoryId: plannerCategoryId(source), priority: source.priority, preferredPeriod: source.preferredPeriods?.[0] || "afternoon", rhythm: plannerRhythmText(source), splittable: source.splittable });
        }} options={[["", "选择今日任务"], ...tasks.map((task) => [task.id, task.title])]} />
        {(commonTasks || []).length > 0 && <SelectField label="调用常用任务" value="" onChange={(value) => {
          const source = commonTasks.find((item) => item.id === value);
          if (source) setForm({ title: source.title, categoryId: plannerCategoryId(source), priority: source.priority, preferredPeriod: source.preferredPeriods?.[0] || "afternoon", rhythm: plannerRhythmText(source), splittable: source.splittable });
        }} options={[["", "选择常用任务"], ...commonTasks.map((task) => [task.id, task.title])]} />}
        <TextField label="模块名称" value={form.title} onChange={(value) => update("title", value)} />
        <div className="two-column-fields">
          <CascadingCategoryFields taxonomy={taxonomy} categoryId={form.categoryId} onChange={(value) => update("categoryId", value)} />
          <SelectField label="优先级" value={String(form.priority)} onChange={(value) => update("priority", Number(value))} options={[["1", "P1"], ["2", "P2"], ["3", "P3"]]} />
          <SelectField label="偏好时段" value={form.preferredPeriod} onChange={(value) => update("preferredPeriod", value)} options={[["morning", "上午"], ["midday", "午间"], ["afternoon", "下午"], ["evening", "晚间"]]} />
          <SelectField label="是否可拆分" value={form.splittable ? "yes" : "no"} onChange={(value) => update("splittable", value === "yes")} options={[["yes", "可拆分"], ["no", "尽量连续"]]} />
        </div>
        <div className="rhythm-options">
          {(rhythmPresets || []).filter((preset) => preset.enabled !== false).map((preset) => {
            const option = preset.label;
            return (
            <button className={form.rhythm === option ? "active" : ""} type="button" key={option} onClick={() => update("rhythm", option)}>{option}</button>
          );})}
        </div>
        <div className={`task-preview-card ${plannerCategoryClass(form.categoryId)}`}>
          <span>预览</span>
          <strong>{form.title}｜{rhythm.label}</strong>
          <small>会保存到今天的任务池。</small>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" type="submit">保存到今天</button>
        </div>
      </form>
    </div>
  );
}

function EditFixedEventModal({ eventItem, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    title: eventItem.title || "固定事件",
    startTime: formatClockMinutes(eventItem.start),
    endTime: formatClockMinutes(eventItem.end),
    type: eventItem.type || "custom",
    categoryId: plannerCategoryId(eventItem),
    constraint: eventItem.constraint || "hard",
    locked: eventItem.locked !== false,
    note: eventItem.note || "",
  }));
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  return (
    <div className="modal-backdrop">
      <form className="task-edit-modal" onSubmit={(event) => {
        event.preventDefault();
        onSave(eventItem.id, form);
      }}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">锁定 = 排程器不能移动，不是你不能编辑</p>
            <h2>编辑固定事件</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <TextField label="标题" value={form.title} onChange={(value) => update("title", value)} />
        <div className="two-column-fields">
          <TextField label="开始时间" value={form.startTime} onChange={(value) => update("startTime", value)} />
          <TextField label="结束时间" value={form.endTime} onChange={(value) => update("endTime", value)} />
          <SelectField label="类型" value={form.type} onChange={(value) => update("type", value)} options={[["wake", "起床"], ["meal", "用餐"], ["nap", "午休"], ["bedtime", "上床"], ["commute", "通勤"], ["meeting", "会议"], ["custom", "自定义"]]} />
          <SelectField label="分类" value={form.categoryId} onChange={(value) => update("categoryId", value)} options={plannerCategoryOptions()} />
          <SelectField label="约束" value={form.constraint} onChange={(value) => update("constraint", value)} options={[["hard", "硬约束"], ["soft", "软约束"]]} />
        </div>
        <SelectField label="是否锁定" value={form.locked ? "yes" : "no"} onChange={(value) => update("locked", value === "yes")} options={[["yes", "锁定"], ["no", "不锁定"]]} />
        <label className="field">
          <span>备注</span>
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="secondary-button danger-text" type="button" onClick={() => onSave(eventItem.id, { ...form, deleted: true })}>删除今日事件</button>
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" type="submit">仅保存今天修改</button>
        </div>
      </form>
    </div>
  );
}

function TaskDragPreview({ item }) {
  return (
    <div className={`task-drag-preview ${plannerCategoryClass(item.categoryId || item.category)}`}>
      <strong>{item.title}</strong>
      <span>{minutesLabel(item.duration || 0)}</span>
    </div>
  );
}

function TemplateCanvasPreview({ fixedEvents = [], tasks = [], timelineSegments = [] }) {
  const placed = [...fixedEvents.map((item) => ({ ...item, kind: "fixed", start: clockToDayMinutes(item.startTime) })), ...timelineSegments.map((item) => ({ ...item, kind: "task", start: Number(item.startMinute || 0) }))]
    .filter((item) => Number.isFinite(item.start))
    .sort((a, b) => a.start - b.start);
  return <section className="template-canvas-preview">
    <div><strong>模板画布</strong><small>独立编辑中，保存前不会改变今天</small></div>
    <div className="template-canvas-grid"><aside><b>任务池</b>{tasks.length ? tasks.map((task) => <span key={task.templateItemId || task.title} className={plannerCategoryClass(task.categoryId || task.category)}>{task.title} · {minutesLabel((task.segments || []).reduce((sum, value) => sum + Number(value || 0), 0))}</span>) : <small>还没有默认任务</small>}</aside><main><b>时间线</b>{placed.length ? placed.map((item) => <span key={item.templateItemId || item.id || item.title} className={plannerCategoryClass(item.categoryId || item.category)}>{formatClockMinutes(item.start)} · {item.title}</span>) : <small>还没有锁定时间的任务</small>}</main><aside><b>小结</b><small>时间线卡片 {fixedEvents.length + timelineSegments.length}</small><small>任务池 {tasks.length}</small></aside></div>
  </section>;
}

function DayTemplateManager({ templates, defaultTemplateId, onCancel, onApply, onSaveCurrent, onNew, onUpdate, onDelete, onCopy, onRestore, onSetDefault }) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id || "");
  const selected = templates.find((template) => template.id === selectedId) || templates[0];
  const [editorDraft, setEditorDraft] = useState(() => selected ? clonePlannerValue(selected) : null);
  useEffect(() => setEditorDraft(selected ? clonePlannerValue(selected) : null), [selectedId, selected?.updatedAt]);
  if (!selected || !editorDraft) return null;
  const updateDraft = (patch) => setEditorDraft((current) => ({ ...current, ...patch }));
  const updateContent = (patch) => setEditorDraft((current) => ({ ...current, content: { ...current.content, ...patch } }));
  const fixedEvents = editorDraft.content.fixedEvents || [];
  const defaultTasks = editorDraft.content.defaultTaskGroups || [];
  const timelineSegments = editorDraft.content.timelineSegments || [];
  const hasChanges = JSON.stringify(editorDraft) !== JSON.stringify(selected);
  const addFixed = () => {};
  const addTask = () => updateContent({ defaultTaskGroups: [...defaultTasks, { templateItemId: `template-task-${Date.now()}`, title: "默认任务", categoryId: "personal", segments: [50], breakMinutes: 10, priority: 2, manualOrder: defaultTasks.length, preferredPeriods: ["afternoon"], splittable: true }] });
  const addTimeline = () => updateContent({ timelineSegments: [...timelineSegments, { templateItemId: `template-line-${Date.now()}`, title: "计划任务", categoryId: "personal", startMinute: 9 * 60, endMinute: 10 * 60, workMinutes: 50, restMinutes: 10, priority: 2, preferredPeriods: ["morning"], locked: false }] });
  return (
    <div className="drawer-backdrop">
      <div className="template-manager-workspace">
        <aside className="template-library-list">
          <div className="panel-title"><div><p className="eyebrow">Template Library</p><h2>模板管理</h2></div><button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button></div>
          <button className="primary-button full" type="button" onClick={() => { const template = onNew(); if (template?.id) setSelectedId(template.id); }}>+ 新建空白模板</button>
          <button className="secondary-button full" type="button" onClick={() => onSaveCurrent((template) => setSelectedId(template.id))}>从今天保存新模板</button>
          {templates.map((template) => (
            <button type="button" key={template.id} className={`template-library-item ${template.id === selected.id ? "active" : ""}`} onClick={() => setSelectedId(template.id)}>
              <strong>{template.name}</strong>
              <span>{template.isBuiltIn ? `内置${templateIsCustomized(template) ? " · 已自定义" : ""}` : "自定义"}{template.id === defaultTemplateId ? " · 默认" : ""}</span>
              <small>{labelFromOptions(scheduleSceneOptions, template.content.scene)} · 时间线卡片 {(template.content.fixedEvents || []).length + (template.content.timelineSegments || []).length} 项 · 默认任务 {(template.content.defaultTaskGroups || []).length} 项</small>
            </button>
          ))}
        </aside>
        <main className="template-editor-pane">
          <div className="panel-title"><div><p className="eyebrow">独立草稿 · 不影响今天</p><h2>编辑模板｜{editorDraft.name}</h2></div><div className="button-row"><button className="secondary-button compact" type="button" onClick={() => onApply(selected)}>应用到今天</button><button className="primary-button compact" type="button" disabled={!hasChanges} onClick={() => onUpdate(selected.id, editorDraft)}>保存模板</button></div></div>
          <TemplateCanvasPreview fixedEvents={fixedEvents} tasks={defaultTasks} timelineSegments={timelineSegments} />
          <details open className="template-editor-section"><summary>基本信息与时间边界</summary><div className="two-column-fields">
            <TextField label="模板名称" value={editorDraft.name} onChange={(value) => updateDraft({ name: value })} />
            <TextField label="模板说明" value={editorDraft.description} onChange={(value) => updateDraft({ description: value })} />
            <SelectField label="场景" value={editorDraft.content.scene || "home"} onChange={(value) => updateContent({ scene: value })} options={scheduleSceneOptions} />
            <TextField label="计划起床时间" value={editorDraft.content.wakeUpTime} onChange={(value) => updateContent({ wakeUpTime: value })} />
            <TextField label="目标上床时间" value={editorDraft.content.targetBedTime} onChange={(value) => updateContent({ targetBedTime: value })} />
          </div></details>
          <details className="template-editor-section" hidden><summary>默认固定事件（{fixedEvents.length}）</summary><button className="secondary-button compact" type="button" onClick={addFixed}>添加固定事件</button>{fixedEvents.map((event, index) => <div className="template-inline-row" key={event.id || index}>
            <input value={event.title || ""} onChange={(e) => updateContent({ fixedEvents: fixedEvents.map((item, i) => i === index ? { ...item, title: e.target.value } : item) })} />
            <input value={event.startTime || ""} placeholder="开始" onChange={(e) => updateContent({ fixedEvents: fixedEvents.map((item, i) => i === index ? { ...item, startTime: e.target.value } : item) })} />
            <input value={event.endTime || ""} placeholder="结束" onChange={(e) => updateContent({ fixedEvents: fixedEvents.map((item, i) => i === index ? { ...item, endTime: e.target.value } : item) })} />
            <select value={plannerCategoryId(event)} onChange={(e) => updateContent({ fixedEvents: fixedEvents.map((item, i) => i === index ? { ...item, categoryId: e.target.value } : item) })}>{plannerCategoryOptions().map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <label><input type="checkbox" checked={event.locked !== false} onChange={(e) => updateContent({ fixedEvents: fixedEvents.map((item, i) => i === index ? { ...item, locked: e.target.checked } : item) })} />锁定</label>
            <button className="icon-button danger" type="button" onClick={() => updateContent({ fixedEvents: fixedEvents.filter((_, i) => i !== index) })} aria-label="删除固定事件"><Trash2 size={15} /></button>
          </div>)}</details>
          <details className="template-editor-section"><summary>默认任务（{defaultTasks.length}）</summary><button className="secondary-button compact" type="button" onClick={addTask}>添加默认任务</button>{defaultTasks.map((task, index) => <div className="template-inline-row task" key={task.templateItemId || index}>
            <input value={task.title || ""} onChange={(e) => updateContent({ defaultTaskGroups: defaultTasks.map((item, i) => i === index ? { ...item, title: e.target.value } : item) })} />
            <select value={plannerCategoryId(task)} onChange={(e) => updateContent({ defaultTaskGroups: defaultTasks.map((item, i) => i === index ? { ...item, categoryId: e.target.value } : item) })}>{plannerCategoryOptions().map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <input type="number" min="0" value={task.segments?.[0] ?? 0} onChange={(e) => updateContent({ defaultTaskGroups: defaultTasks.map((item, i) => i === index ? { ...item, segments: Array.from({ length: Math.max(1, item.segments?.length || 1) }, () => Number(e.target.value || 0)) } : item) })} />
            <input type="number" min="0" value={task.breakMinutes ?? 0} onChange={(e) => updateContent({ defaultTaskGroups: defaultTasks.map((item, i) => i === index ? { ...item, breakMinutes: Number(e.target.value || 0) } : item) })} />
            <input type="number" min="1" value={task.segments?.length || 1} onChange={(e) => updateContent({ defaultTaskGroups: defaultTasks.map((item, i) => i === index ? { ...item, segments: Array.from({ length: Math.max(1, Number(e.target.value || 1)) }, () => Number(item.segments?.[0] || 0)) } : item) })} />
            <button className="icon-button danger" type="button" onClick={() => updateContent({ defaultTaskGroups: defaultTasks.filter((_, i) => i !== index) })} aria-label="删除默认任务"><Trash2 size={15} /></button>
          </div>)}</details>
          <details className="template-editor-section"><summary>具体时间线安排（可选，{timelineSegments.length}）</summary><button className="secondary-button compact" type="button" onClick={addTimeline}>添加时间线任务</button>{timelineSegments.map((segment, index) => <div className="template-inline-row task" key={segment.templateItemId || index}>
            <input value={segment.title || ""} onChange={(e) => updateContent({ timelineSegments: timelineSegments.map((item, i) => i === index ? { ...item, title: e.target.value } : item) })} />
            <select value={plannerCategoryId(segment)} onChange={(e) => updateContent({ timelineSegments: timelineSegments.map((item, i) => i === index ? { ...item, categoryId: e.target.value } : item) })}>{plannerCategoryOptions().map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <input type="number" min="0" value={segment.workMinutes ?? 0} onChange={(e) => updateContent({ timelineSegments: timelineSegments.map((item, i) => i === index ? { ...item, workMinutes: Number(e.target.value || 0) } : item) })} />
            <input type="number" min="0" value={segment.restMinutes ?? 0} onChange={(e) => updateContent({ timelineSegments: timelineSegments.map((item, i) => i === index ? { ...item, restMinutes: Number(e.target.value || 0) } : item) })} />
            <input value={formatClockMinutes(segment.startMinute || 0)} onChange={(e) => updateContent({ timelineSegments: timelineSegments.map((item, i) => i === index ? { ...item, startMinute: clockToDayMinutes(e.target.value) ?? item.startMinute } : item) })} />
            <label><input type="checkbox" checked={Boolean(segment.locked)} onChange={(e) => updateContent({ timelineSegments: timelineSegments.map((item, i) => i === index ? { ...item, locked: e.target.checked } : item) })} />锁定</label>
            <button className="icon-button danger" type="button" onClick={() => updateContent({ timelineSegments: timelineSegments.filter((_, i) => i !== index) })} aria-label="删除时间线任务"><Trash2 size={15} /></button>
          </div>)}</details>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => onCopy(selected)}>复制模板</button><button className="secondary-button" type="button" disabled={selected.id === defaultTemplateId} onClick={() => onSetDefault(selected.id)}>{selected.id === defaultTemplateId ? "当前默认模板" : "设为默认"}</button>{selected.isBuiltIn && <button className="secondary-button" type="button" onClick={() => onRestore(selected)}>恢复系统默认</button>}<button className="secondary-button danger-text" type="button" onClick={() => onDelete(selected)}>删除模板</button></div>
        </main>
      </div>
    </div>
  );
}

function SaveTodayAsTemplateModal({ state, onChange, onCancel, onSave }) {
  const toggle = (key) => onChange({ ...state, scopes: { ...state.scopes, [key]: !state.scopes[key] } });
  return <div className="modal-backdrop"><div className="task-edit-modal recovery-modal"><div className="panel-title"><div><p className="eyebrow">只保存模板，不改变今天</p><h2>{state.templateId ? "覆盖当前模板" : "保存今天为模板"}</h2></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><p className="field-help">模板保存的是当前排程结构，应用时任务状态统一恢复为 pending。</p>{state.templateId && <p className="field-help">未勾选部分将保留模板原有内容。</p>}<TextField label="模板名称" value={state.name} onChange={(name) => onChange({ ...state, name })} />{[["boundaries", "时间边界与场景"], ["fixedEvents", "生活/固定节点"], ["defaultTasks", "当前任务池"], ["timeline", "当前时间线卡片"]].map(([key, label]) => <label className="check-field" key={key}><input type="checkbox" checked={state.scopes[key]} onChange={() => toggle(key)} />{label}</label>)}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" onClick={onSave}>{state.templateId ? "确认覆盖" : "保存为新模板"}</button></div></div></div>;
}

function ApplyTemplateModal({ state, onChange, onCancel, onConfirm }) {
  const { template, scopes } = state;
  const content = template.content || {};
  const toggle = (key) => onChange({ ...state, scopes: { ...scopes, [key]: !scopes[key] } });
  return <div className="modal-backdrop"><div className="task-edit-modal recovery-modal"><div className="panel-title"><div><p className="eyebrow">先确认，再改变今天</p><h2>应用「{template.name}」到今天</h2></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><p className="field-help">已完成任务、过去内容和已锁定的普通任务会保留。新任务会生成新的 ID，默认不锁定。</p>{[["boundaries", "时间边界与场景", true], ["defaultTasks", `默认任务 ${content.defaultTaskGroups?.length || 0} 项`, Boolean(content.defaultTaskGroups?.length)], ["timeline", `时间线卡片 ${(content.fixedEvents?.length || 0) + (content.timelineSegments?.length || 0)} 项`, Boolean(content.fixedEvents?.length || content.timelineSegments?.length)]].map(([key, label, enabled]) => <label className="check-field" key={key}><input type="checkbox" disabled={!enabled} checked={scopes[key]} onChange={() => toggle(key)} />{label}</label>)}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" onClick={onConfirm}>确认应用</button></div></div></div>;
}

function mergeScheduleSettings(saved = {}) {
  const normalizedSaved = normalizeScheduleAssistantSettings(saved);
  const savedEnglish = normalizedSaved.englishRotationSettings;
  const mathTemplates = normalizedSaved.mathTemplates.length ? normalizedSaved.mathTemplates : defaultMathTemplates;
  const englishTemplates = normalizedSaved.englishTemplates.length ? normalizedSaved.englishTemplates : defaultEnglishTemplates;
  const deletedDayTemplateSystemKeys = normalizedSaved.deletedDayTemplateSystemKeys;
  const dayTemplates = normalizePlannerTemplates(normalizedSaved.dayTemplates, deletedDayTemplateSystemKeys);
  const defaultDayTemplateId = dayTemplates.some((template) => template.id === normalizedSaved.defaultDayTemplateId)
    ? normalizedSaved.defaultDayTemplateId
    : dayTemplates[0]?.id || "";
  return {
    ...defaultScheduleAssistantSettings,
    ...normalizedSaved,
    mathTemplates,
    englishTemplates,
    dayTemplates,
    deletedDayTemplateSystemKeys,
    defaultDayTemplateId,
    rhythmPresets: normalizeRhythmPresets(saved.rhythmPresets),
    englishRotationSettings: {
      ...defaultScheduleAssistantSettings.englishRotationSettings,
      ...savedEnglish,
      enabledSkills: savedEnglish.enabledSkills.length ? savedEnglish.enabledSkills : defaultScheduleAssistantSettings.englishRotationSettings.enabledSkills,
    },
  };
}

function normalizeRhythmPresets(presets) {
  const source = Array.isArray(presets) && presets.length ? presets : defaultRhythmPresets;
  return source
    .map((preset, index) => ({
      id: preset.id || `rhythm-${Date.now()}-${index}`,
      label: preset.label || `${Number(preset.workMinutes || 0)}${Number(preset.restMinutes || 0) ? `+${Number(preset.restMinutes)}` : ""}`,
      workMinutes: Math.max(0, Number(preset.workMinutes || 0)),
      restMinutes: Math.max(0, Number(preset.restMinutes || 0)),
      segmentCount: Math.max(1, Number(preset.segmentCount || 1)),
      order: Number(preset.order ?? index),
      enabled: preset.enabled !== false,
      builtIn: Boolean(preset.builtIn),
    }))
    .sort((a, b) => a.order - b.order);
}

function buildPlannerCategoryCatalog({ taxonomy = [], tasks = [], savedOrder = [] } = {}) {
  const byId = new Map();
  const add = (source = {}) => {
    const id = typeof source === "string" ? source : source.categoryId || source.id || source.category;
    if (!id || byId.has(id)) return;
    const fallback = plannerCategoryFor({ categoryId: id, category: source.category });
    byId.set(id, {
      id,
      name: source.categoryName || source.name || source.category || fallback.name || id,
      shortName: source.categoryName || source.name || source.category || fallback.shortName || id,
      foreground: source.categoryColor || source.color || fallback.foreground,
      background: fallback.background || "#F8FAFC",
      statGroup: source.categoryStatGroup || source.statGroup || fallback.statGroup,
    });
  };
  plannerCategoryDefinitions.forEach(add);
  classificationSecondaryItems(taxonomy).forEach(add);
  (tasks || []).forEach(add);
  (savedOrder || []).forEach(add);
  return [...byId.values()];
}

function buildReviewPrefillFromPlanner(rawDraft, reviewDate) {
  const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
  if (draft.reviewPrefill?.date === reviewDate) {
    return {
      available: Boolean(draft.reviewPrefill.available),
      studyMinutes: Math.max(0, Number(draft.reviewPrefill.studyMinutes) || 0),
      exerciseMinutes: Math.max(0, Number(draft.reviewPrefill.exerciseMinutes) || 0),
      source: draft.reviewPrefill.source || "planner",
    };
  }
  if (!draft.targetDate || draft.targetDate !== reviewDate || !Array.isArray(draft.blocks)) return { available: false, studyMinutes: 0, exerciseMinutes: 0 };
  const result = draft.blocks.reduce((sum, block) => {
    if (block?.kind !== "task") return sum;
    const minutes = getBlockActiveMinutes(block);
    const statGroup = plannerCategoryFor(block).statGroup;
    if (statGroup === "exercise") sum.exerciseMinutes += minutes;
    else if (statGroup === "study" || statGroup === "reading") sum.studyMinutes += minutes;
    return sum;
  }, { available: true, studyMinutes: 0, exerciseMinutes: 0 });
  return { ...result, available: result.studyMinutes > 0 || result.exerciseMinutes > 0 };
}

function buildReviewPrefillFromBlocks(blocks = [], date = "") {
  const result = (Array.isArray(blocks) ? blocks : []).reduce((sum, block) => {
    if (block?.kind !== "task") return sum;
    const minutes = getBlockActiveMinutes(block);
    const category = String(block.categoryLevel2Id || block.categoryId || "");
    const statGroup = plannerCategoryFor(block).statGroup;
    if (category === "exercise" || statGroup === "exercise") sum.exerciseMinutes += minutes;
    else if (statGroup === "study" || statGroup === "reading") sum.studyMinutes += minutes;
    return sum;
  }, { date, studyMinutes: 0, exerciseMinutes: 0, source: "planner-timeline", available: false });
  return { ...result, available: result.studyMinutes > 0 || result.exerciseMinutes > 0 };
}

function plannerCategoryForCatalog(value, catalog = [], fallback = "personal") {
  const id = typeof value === "string" ? value : value?.categoryId || value?.id;
  const found = (catalog || []).find((category) => category.id === id);
  if (found) {
    return {
      ...found,
      name: value?.categoryName || found.name,
      shortName: value?.categoryName || found.shortName,
      foreground: value?.categoryColor || found.foreground,
      statGroup: value?.categoryStatGroup || found.statGroup,
    };
  }
  return plannerCategoryFor(value, fallback);
}

function plannerCategoryFor(value, fallback = "personal") {
  const id = value?.categoryId || value;
  // plannerCategoryDefinitions is a small built-in color/label palette that still
  // uses pre-v3 bare ids (e.g. "math") and was never migrated to canonical ids. Try
  // an exact match first, then any legacy id that normalizes to this canonical id
  // (e.g. "study.math" -> "math"), before falling back to the old Chinese-label map.
  const found = plannerCategoryDefinitions.find((item) => item.id === id)
    || legacyIdsFor(id).map((legacyId) => plannerCategoryDefinitions.find((item) => item.id === legacyId)).find(Boolean)
    || plannerCategoryDefinitions.find((item) => item.id === legacyPlannerCategoryIds[value?.category || value]);
  if (found) {
    return {
      ...found,
      name: value?.categoryName || found.name,
      shortName: value?.categoryName || found.shortName,
      foreground: value?.categoryColor || found.foreground,
      statGroup: value?.categoryStatGroup || found.statGroup,
    };
  }
  if (!found && value?.categoryName) {
    return {
      id: value.categoryId || fallback,
      name: value.categoryName,
      shortName: value.categoryName,
      foreground: value.categoryColor || plannerCategoryDefinitions.find((item) => item.id === fallback)?.foreground || "#94a3b8",
      background: "#F8FAFC",
      statGroup: value.categoryStatGroup || "life",
    };
  }
  return plannerCategoryDefinitions.find((item) => item.id === fallback) || plannerCategoryDefinitions[0];
}

function plannerCategoryId(value, fallback = "personal") {
  return plannerCategoryFor(value, fallback).id;
}

function normalizeClassificationTaxonomy(value = []) {
  const orderRows = (rows = []) => [...asArray(rows)].sort((left, right) => (Number(left?.order) || 0) - (Number(right?.order) || 0));
  const source = orderRows(ensureLifeCategories(migrateLegacyEnglishTaxonomy(Array.isArray(value) && value.length ? value : defaultClassificationTaxonomy)));
  return source.filter((primary) => primary && typeof primary === "object").map((primary, primaryIndex) => {
    const primaryId = normalizeCategoryId(primary.id) || "primary-" + (primaryIndex + 1);
    const primaryChildren = orderRows(primary.children).filter((secondary) => secondary && typeof secondary === "object").map((secondary, secondaryIndex) => {
      const secondaryId = normalizeCategoryId(secondary.id) || "secondary-" + (primaryIndex + 1) + "-" + (secondaryIndex + 1);
      const secondaryChildren = orderRows(secondary.children).filter((tertiary) => tertiary && typeof tertiary === "object").map((tertiary, tertiaryIndex) => {
        const tertiaryNode = {
          id: normalizeCategoryId(tertiary.id) || `${secondaryId || "secondary"}.detail-${tertiaryIndex + 1}`,
          name: tertiary.name || "未命名三级分类",
          keywords: tertiary.keywords || "",
          parentId: secondaryId || "",
          level: 3,
          order: Number.isFinite(Number(tertiary.order)) ? Number(tertiary.order) : tertiaryIndex,
          enabled: tertiary.enabled !== false,
          archived: tertiary.archived === true,
          archivedAt: typeof tertiary.archivedAt === "string" ? tertiary.archivedAt : "",
          trackInWeeklyReview: tertiary.trackInWeeklyReview !== false,
        };
        // Tertiary nodes have no `children` field at all in this shape, so they
        // are always leaves — reviewConfig always applies.
        return { ...tertiaryNode, reviewConfig: normalizeReviewConfig({ ...tertiary, id: tertiaryNode.id }) };
      });
      const secondaryNode = {
        id: secondaryId,
        name: secondary.name || "未命名二级分类",
        keywords: secondary.keywords || "",
        color: secondary.color || primary.color || "#64748B",
        statGroup: secondary.statGroup || (primaryId === "study" ? "study" : "life"),
        level: 2,
        order: Number.isFinite(Number(secondary.order)) ? Number(secondary.order) : secondaryIndex,
        enabled: secondary.enabled !== false,
        archived: secondary.archived === true,
        archivedAt: typeof secondary.archivedAt === "string" ? secondary.archivedAt : "",
        trackInWeeklyReview: secondary.trackInWeeklyReview !== false,
        children: secondaryChildren,
      };
      return isLeafTaxonomyNode(secondaryNode)
        ? { ...secondaryNode, reviewConfig: normalizeReviewConfig({ ...secondary, id: secondaryId }) }
        : secondaryNode;
    });
    const primaryNode = {
      id: primaryId,
      name: primary.name || "未命名一级分类",
      color: primary.color || "#64748B",
      level: 1,
      order: Number.isFinite(Number(primary.order)) ? Number(primary.order) : primaryIndex,
      enabled: primary.enabled !== false,
      archived: primary.archived === true,
      archivedAt: typeof primary.archivedAt === "string" ? primary.archivedAt : "",
      children: primaryChildren,
    };
    return isLeafTaxonomyNode(primaryNode)
      ? { ...primaryNode, reviewConfig: normalizeReviewConfig({ ...primary, id: primaryId }) }
      : primaryNode;
  });
}

function migrateLegacyEnglishTaxonomy(source = []) {
  const tree = asArray(source).map((primary) => ({ ...primary, children: asArray(primary.children).map((secondary) => ({ ...secondary, children: asArray(secondary.children) })) }));
  return tree.map((primary) => {
    if (primary.id !== "study") return primary;
    const english = primary.children.find((item) => item.id === "english");
    const ielts = primary.children.find((item) => item.id === "ielts" || /雅思专项/.test(item.name || ""));
    if (!english && !ielts) return primary;
    const mergedChildren = [...asArray(english?.children), ...asArray(ielts?.children)]
      .filter((child, index, rows) => child?.id && rows.findIndex((item) => item?.id === child.id) === index);
    const merged = { ...(english || ielts), id: "english", name: "英语", children: mergedChildren };
    return { ...primary, children: [...primary.children.filter((item) => item !== english && item !== ielts), merged] };
  });
}

function classificationSecondaryItems(taxonomy = []) {
  return normalizeClassificationTaxonomy(taxonomy).filter((primary) => primary.enabled !== false && primary.archived !== true).flatMap((primary) => primary.children.filter((secondary) => secondary.archived !== true).map((secondary) => ({ ...secondary, primaryId: primary.id, primaryName: primary.name })));
}

function plannerCategoryOptions(taxonomy = []) {
  return classificationSecondaryItems(taxonomy).map((item) => [item.id, item.primaryName + "｜" + item.name]);
}

function CascadingCategoryFields({ taxonomy = [], categoryId, onChange }) {
  const primaryId = classificationSecondaryItems(taxonomy).find((item) => item.id === normalizeCategoryId(categoryId))?.primaryId || normalizeClassificationTaxonomy(taxonomy)[0]?.id || "";
  const primaryOptions = normalizeClassificationTaxonomy(taxonomy).map((item) => [item.id, item.name]);
  const secondaryOptions = classificationSecondaryItems(taxonomy).filter((item) => item.primaryId === primaryId && item.enabled !== false).map((item) => [item.id, item.name]);
  return <div className="two-column-fields"><SelectField label="一级分类" value={primaryId} onChange={(value) => onChange(classificationSecondaryItems(taxonomy).find((item) => item.primaryId === value && item.enabled !== false)?.id || "")} options={primaryOptions} /><SelectField label="二级分类" value={categoryId || ""} onChange={onChange} options={[["", "未分类"], ...secondaryOptions]} /></div>;
}

function plannerCategoryPatch(categoryId, taxonomy = []) {
  const normalizedCategoryId = normalizeCategoryId(categoryId);
  const category = classificationSecondaryItems(taxonomy).find((item) => item.id === normalizedCategoryId);
  if (!category) return { categoryId: normalizedCategoryId };
  return {
    categoryId: category.id,
    categoryLevel2Id: category.id,
    category: category.name,
    categoryName: category.name,
    categoryColor: category.color,
    categoryPrimaryId: category.primaryId,
    categoryPrimaryName: category.primaryName,
    categoryStatGroup: category.statGroup,
  };
}

function classificationKeywordTags(taxonomy = []) {
  return flattenClassificationItems(taxonomy)
    .filter((item) => item.keywords)
    .map((item) => ({ id: "taxonomy-" + item.id, name: [item.primaryName, item.secondaryName, item.name].filter(Boolean).join("｜"), keywords: item.keywords }));
}

function flattenClassificationItems(taxonomy = []) {
  return classificationSecondaryItems(taxonomy).flatMap((secondary) => [{ ...secondary, secondaryName: "" }, ...(secondary.children || []).map((tertiary) => ({ ...tertiary, primaryId: secondary.primaryId, primaryName: secondary.primaryName, secondaryId: secondary.id, secondaryName: secondary.name }))]);
}

function normalizePlannerCategorizedItem(item, fallback = "personal") {
  const category = plannerCategoryFor(item, fallback);
  return { ...item, categoryId: category.id, category: item.category || category.shortName };
}

function clonePlannerValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeTemplateContent(content = {}) {
  const source = asRecord(content);
  return {
    ...clonePlannerValue(source),
    fixedEvents: clonePlannerValue(asArray(source.fixedEvents).filter((item) => item && typeof item === "object")).map((item) => normalizePlannerCategorizedItem(item, "personal")),
    fixedEventOverrides: clonePlannerValue(asRecord(source.fixedEventOverrides)),
    defaultTaskGroups: clonePlannerValue(asArray(source.defaultTaskGroups).filter((item) => item && typeof item === "object")).map((item) => normalizePlannerCategorizedItem(item, "personal")),
    timelineSegments: clonePlannerValue(asArray(source.timelineSegments).filter((item) => item && typeof item === "object")).map((item) => normalizePlannerCategorizedItem(item, "personal")),
  };
}

function createEditableTemplateFromSeed(seed) {
  const now = new Date().toISOString();
  return {
    id: `template-${seed.systemKey}`,
    systemKey: seed.systemKey,
    isBuiltIn: true,
    name: seed.name,
    description: seed.description || "",
    icon: seed.icon || "",
    content: normalizeTemplateContent(seed.content),
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

function createTemplateFromLegacy(template = {}) {
  template = asRecord(template);
  const seed = factoryPlannerTemplateSeeds.find((item) => item.systemKey === template.systemKey || item.systemKey === template.id);
  const now = new Date().toISOString();
  const { id, name, isBuiltIn, isDefault, createdAt, updatedAt, systemKey, revision, description, icon, ...content } = template;
  return {
    id: id || `template-${Date.now()}`,
    systemKey: systemKey || seed?.systemKey,
    isBuiltIn: Boolean(isBuiltIn ?? seed),
    name: name || seed?.name || "未命名模板",
    description: description || "",
    icon: icon || "",
    content: normalizeTemplateContent(content),
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    revision: Number(revision || 1),
    isDefault: Boolean(isDefault),
  };
}

function normalizePlannerTemplates(templates = [], deletedSystemKeys = []) {
  const deleted = new Set(deletedSystemKeys);
  const normalized = (Array.isArray(templates) ? templates : []).map((template) => {
    if (!template || typeof template !== "object") return null;
    if (template?.content) {
      return { ...template, content: normalizeTemplateContent(template.content), revision: Number(template.revision || 1) };
    }
    return createTemplateFromLegacy(template);
  }).filter((template) => template && (!template.systemKey || !deleted.has(template.systemKey)));
  factoryPlannerTemplateSeeds.forEach((seed) => {
    if (!deleted.has(seed.systemKey) && !normalized.some((template) => template.systemKey === seed.systemKey)) {
      normalized.push(createEditableTemplateFromSeed(seed));
    }
  });
  return normalized;
}

function getFactoryPlannerTemplate(systemKey) {
  return factoryPlannerTemplateSeeds.find((seed) => seed.systemKey === systemKey);
}

function templateIsCustomized(template) {
  const factory = getFactoryPlannerTemplate(template.systemKey);
  if (!factory) return false;
  return template.name !== factory.name || JSON.stringify(normalizeTemplateContent(template.content)) !== JSON.stringify(normalizeTemplateContent(factory.content));
}

function templateContentToDayPatch(template) {
  const content = normalizeTemplateContent(template.content);
  const { fixedEvents, fixedEventOverrides, defaultTaskGroups, timelineSegments, morningRoutine, ...dayFields } = content;
  return clonePlannerValue(dayFields);
}

function instantiateTemplateForDay(template, currentDraft, scopes = {}) {
  const content = normalizeTemplateContent(template.content);
  const next = ensureMorningRoutineCard(clonePlannerValue(currentDraft));
  if (scopes.boundaries) {
    Object.assign(next, templateContentToDayPatch(template));
  }
  if (scopes.fixedEvents) {
    const lockedOverrides = Object.fromEntries(Object.entries(next.fixedEventOverrides || {}).filter(([, item]) => item?.locked));
    next.fixedEventOverrides = { ...clonePlannerValue(content.fixedEventOverrides || {}), ...lockedOverrides };
    const lockedCustomEvents = (next.fixedEvents || []).filter((event) => event.locked);
    next.fixedEvents = [
      ...lockedCustomEvents,
      ...(content.fixedEvents || []).map((event, index) => ({ ...clonePlannerValue(event), id: `event-template-${Date.now()}-${index}`, locked: Boolean(event.locked) })),
    ];
  }
  const generatedAt = Date.now();
  const existingTaskIdBySourceId = Object.fromEntries((next.todayCustomBlocks || [])
    .filter((task) => task?.categoryId === LIFE_CATEGORY_IDS.morningRoutine)
    .map((task) => [task.id, task.id]));
  const { defaultTasks, timelineTasks, timelineOverrides } = instantiateTemplateTaskCollections({
    defaultTaskGroups: content.defaultTaskGroups || [],
    timelineSegments: content.timelineSegments || [],
    includeDefaultTasks: Boolean(scopes.defaultTasks),
    includeTimeline: Boolean(scopes.timeline),
    existingTaskIdBySourceId,
    makeId: (prefix, index) => `${prefix}-${generatedAt}-${index}`,
  });
  const templateTasks = [...defaultTasks, ...timelineTasks].map((task) => ({
    ...task,
    categoryId: plannerCategoryId(task),
    note: `来自模板「${template.name}」`,
  }));
  if (templateTasks.length) next.todayCustomBlocks = [...(next.todayCustomBlocks || []), ...templateTasks];
  if (scopes.timeline) next.todaySegmentOverrides = { ...(next.todaySegmentOverrides || {}), ...timelineOverrides };
  if (scopes.timeline && content.morningRoutine?.categoryId === LIFE_CATEGORY_IDS.morningRoutine) {
    const morning = findDayStartAnchor(next.todayCustomBlocks || []);
    if (morning) {
      const startMinute = Number(content.morningRoutine.startMinute);
      const workMinutes = Number(content.morningRoutine.workMinutes);
      if (Number.isFinite(startMinute) && startMinute >= 0 && Number.isFinite(workMinutes) && workMinutes > 0) {
        next.wakeUpTime = formatClockMinutes(startMinute);
        next.morningPrepMinutes = workMinutes;
        next.todaySegmentOverrides = {
          ...(next.todaySegmentOverrides || {}),
          [`${morning.id}-1`]: { ...(next.todaySegmentOverrides?.[`${morning.id}-1`] || {}), placement: "timeline", manualStart: startMinute, workMinutes, locked: true, status: "pending" },
        };
      }
    }
  }
  next.sourceTemplateId = template.id;
  return next;
}

function makeScheduleDraft(saved = {}, rawSettings = {}, autoContext = {}) {
  const settings = mergeScheduleSettings(rawSettings);
  const defaultTargetDate = beijingIsoDate(1);
  const rawSaved = asRecord(saved);
  const shouldReuseSaved = shouldReuseScheduleDraft(rawSaved);
  const defaultSystemLimit = autoContext.boundaryIssue ? "max_30" : settings.defaultSystemDevelopmentLimit;
  const defaultRest = settings.defaultRestPreference;
  const baseDraft = {
    targetDate: defaultTargetDate,
    sourceReviewDate: autoContext.sourceReviewDate || "",
    sourceTemplateId: settings.defaultDayTemplateId || "",
    wakeUpTime: settings.defaultWakeUpTime,
    actualStartTime: "",
    targetBedTime: settings.defaultBedTime,
    scene: settings.defaultScene,
    fixedEvents: [],
    fixedEventOverrides: {},
    commuteStatus: "uncertain",
    commuteNote: "",
    specialNotes: "",
    lunchStartTime: settings.defaultLunchStartTime || "12:30",
    lunchBlockMinutes: settings.defaultLunchBlockMinutes,
    dinnerMinutes: settings.defaultDinnerMinutes ?? 40,
    startupBufferMinutes: settings.defaultStartupBufferMinutes,
    formalRestMinutes: settings.defaultFormalRestMinutes,
    formalRestBlocks: settings.defaultFormalRestBlocks || 1,
    morningPrepMinutes: settings.defaultMorningPrepMinutes || 20,
    mathTemplateId: settings.defaultMathTemplateId,
    englishTemplateId: settings.defaultEnglishTemplateId,
    englishMode: settings.englishRotationSettings.rotationMode,
    englishSkill: settings.englishRotationSettings.manualSelectedSkill || "writing",
    englishSecondSkill: "speaking",
    thesisMinutes: settings.defaultThesisMinutes,
    professionalMinutes: settings.defaultProfessionalMinutes,
    thesisNote: autoContext.thesisAdjustmentText || autoContext.tomorrowAdjustment || "",
    professionalNote: autoContext.econBlockers || "",
    exerciseMode: "auto",
    exerciseMinutes: autoContext.previousDayExercised ? 20 : 40,
    exerciseType: autoContext.previousDayExercised ? "恢复 / 拉伸" : "正式运动",
    showerMinutes: settings.defaultShowerMinutes ?? 25,
    maskMinutes: settings.defaultMaskMinutes ?? 20,
    restPreference: defaultRest,
    systemDevelopmentLimit: defaultSystemLimit,
    todayTaskOverrides: {},
    todayCustomBlocks: [],
    todaySegmentOverrides: {},
    deletedTodayTaskIds: [],
    taskPoolOrder: [],
    schedulingStrategy: "hybrid",
    generatedPrompt: "",
  };
  const normalizedSaved = normalizeScheduleAssistantDraft(rawSaved, { fallbackTargetDate: defaultTargetDate, defaults: baseDraft });
  const mergedDraft = {
    ...baseDraft,
    ...(shouldReuseSaved ? normalizedSaved : {}),
    targetDate: shouldReuseSaved && normalizedSaved.targetDate ? normalizedSaved.targetDate : defaultTargetDate,
    sourceReviewDate: autoContext.sourceReviewDate || "",
    thesisNote: shouldReuseSaved && normalizedSaved.thesisNote ? normalizedSaved.thesisNote : baseDraft.thesisNote,
    professionalNote: shouldReuseSaved && normalizedSaved.professionalNote ? normalizedSaved.professionalNote : baseDraft.professionalNote,
  };
  const migratedDraft = ensureMorningRoutineCard({
    ...mergedDraft,
    fixedEvents: asArray(mergedDraft.fixedEvents).map((item) => normalizePlannerCategorizedItem(item, "personal")),
    todayCustomBlocks: asArray(mergedDraft.todayCustomBlocks).map((item) => normalizePlannerCategorizedItem(item, "personal")),
  });
  return {
    ...migratedDraft,
  };
}

function archivePlannerDraft(archive = [], draft = {}, archivedOn = "") {
  if (!draft?.targetDate) return archive;
  const snapshot = {
    ...clonePlannerValue(draft),
    archivedOn,
    archivedAt: new Date().toISOString(),
  };
  return [
    snapshot,
    ...normalizeScheduleDraftArchive(archive).filter((item) => item?.targetDate !== draft.targetDate),
  ].slice(0, 14);
}

function findScheduleDraftByDate(archive = [], targetDate = "") {
  if (!targetDate) return null;
  return normalizeScheduleDraftArchive(archive).find((item) => (item?.targetDate || item?.savedOn) === targetDate) || null;
}

function mergeScheduleDraftArchives(...archives) {
  const seen = new Set();
  const merged = [];
  archives.flatMap((archive) => normalizeScheduleDraftArchive(archive)).forEach((item) => {
    const key = item?.targetDate || item?.savedOn || "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged.slice(0, 14);
}

function shouldReuseScheduleDraft(saved = {}) {
  const targetDate = saved?.targetDate || saved?.savedOn || "";
  return Boolean(
    saved &&
    targetDate &&
    targetDate >= beijingIsoDate()
  );
}

function safeBuildAgentDaySnapshotFromDailyData(input) {
  try {
    return buildAgentDaySnapshotFromDailyData(input);
  } catch {
    return null;
  }
}

function buildScheduleAutoContext(data) {
  const safeData = asRecord(data);
  const settlements = asArray(safeData.settlements).filter((item) => item && typeof item === "object");
  const profile = asRecord(safeData.profile);
  const todaySettlement = settlements.find((item) => item.reviewDate === todayIsoDate());
  const source = asRecord(todaySettlement || settlements[0]);
  const subjects = asRecord(source.subjects);
  const state = asRecord(source.state);
  const boundaryIssue = /失控|修复/.test(source.dayTypeDisplayName || dayTypeLabels[source.nextDayEntertainmentSourceDayType] || "");
  const sleepSummary = [source.sleepDuration, state.sleepImpact ? `睡眠影响${state.sleepImpact}` : "", source.lateSleepReason ? `晚睡原因：${source.lateSleepReason}` : ""]
    .filter(Boolean)
    .join("，") || "未填写";
  return {
    source,
    sourceReviewDate: source.reviewDate || "",
    dayTypeDisplayName: source.dayTypeDisplayName || dayTypeLabels[source.nextDayEntertainmentSourceDayType] || "普通推进日",
    dayTypeReason: source.nextDayEntertainmentLimitReason || profile.nextDayEntertainmentLimitReason || "没有找到日型判断结果，默认按普通学习日处理；自由娱乐额度固定90min。",
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    previousDayExerciseMinutes: Number(source.exerciseMinutes || 0),
    previousDayExercised: Number(source.exerciseMinutes || 0) > 0,
    sleepSummary,
    biggestBlocker: state.biggestBlocker || "",
    tomorrowAdjustment: state.tomorrowAdjustment || "",
    oneSentenceSummary: state.oneLineSummary || source.note || "",
    mathProgressText: summarizeItems(asRecord(subjects.math).progress),
    mathBlockers: summarizeItems(asRecord(subjects.math).blockers),
    thesisOutputText: summarizeItems(asRecord(subjects.thesis).progress),
    thesisAdjustmentText: summarizeItems(asRecord(subjects.thesis).blockers),
    englishText: summarizeItems([...asArray(asRecord(subjects.english).progress), ...asArray(asRecord(subjects.ielts).progress)]),
    ieltsAdjustment: summarizeItems(asRecord(subjects.ielts).blockers),
    econProgressText: summarizeItems(asRecord(subjects.economy).progress),
    econBlockers: summarizeItems(asRecord(subjects.economy).blockers),
    recentReadingTitle: asArray(safeData.books).find((book) => book?.status === "reading")?.title || asArray(safeData.readingSessions)[0]?.bookTitle || "",
    totalEntertainmentMinutes: Number(source.totalEntertainmentMinutes || 0),
    boundaryIssue,
    maskCycle: asRecord(profile.maskCycle),
    lastMaskDate: profile.lastMaskDate || "",
  };
}

function summarizeItems(items = []) {
  return asArray(items).filter(Boolean).slice(0, 5).join("；");
}

function mathTemplateText(template = {}) {
  const parts = [];
  if (Number(template.lectureBlocks50 || 0) > 0) parts.push(`网课 ${template.lectureBlocks50}×50`);
  if (Number(template.exerciseBlocks50 || 0) > 0) parts.push(`习题 ${template.exerciseBlocks50}×50`);
  if (Number(template.reviewBlocks30 || 0) > 0) parts.push(`复习 ${template.reviewBlocks30}×30`);
  if (Number(template.errorReviewBlocks50 || 0) > 0) parts.push(`错题 ${template.errorReviewBlocks50}×50`);
  if (Number(template.summaryBlocks30 || 0) > 0) parts.push(`总结 ${template.summaryBlocks30}×30`);
  return parts.join(" + ") || "今日不安排数学推进";
}

function estimateScheduleDuration(draft, mathTemplate, englishTemplate, morningPrepMinutes, showerPlan = { shouldShower: false }, maskPlan = { shouldSchedule: false }) {
  const mathMinutes =
    Number(mathTemplate.lectureBlocks50 || 0) * 50 +
    Number(mathTemplate.exerciseBlocks50 || 0) * 50 +
    Number(mathTemplate.reviewBlocks30 || 0) * 30 +
    Number(mathTemplate.errorReviewBlocks50 || 0) * 50 +
    Number(mathTemplate.summaryBlocks30 || 0) * 30;
  const englishMinutes = Number(englishTemplate.wordMinutes || 0) + Number(englishTemplate.skillCount || 1) * Number(englishTemplate.skillMinutes || 0);
  const studyMinutes = mathMinutes + englishMinutes + Number(draft.thesisMinutes || 0) + Number(draft.professionalMinutes || 0);
  const exerciseMinutes = Number(draft.exerciseMinutes || 0);
  const formalRestMinutes = Number(draft.formalRestBlocks ?? 1) * Number(draft.formalRestMinutes || 0);
  const systemMinutes = { none: 0, max_30: 30, max_50: 50, only_if_mainlines_done: 30 }[draft.systemDevelopmentLimit] || 0;
  const showerMinutes = showerPlan.shouldShower ? Number(draft.showerMinutes ?? 25) : 0;
  const maskMinutes = maskPlan.shouldSchedule ? Number(draft.maskMinutes ?? 20) : 0;
  const weeklyReviewMinutes = isSundayDate(draft.targetDate) ? 30 : 0;
  const lifeMinutes =
    Number(morningPrepMinutes || 0) +
    Number(draft.lunchBlockMinutes || 0) +
    Number(draft.startupBufferMinutes || 0) +
    Number(draft.dinnerMinutes ?? 40) +
    showerMinutes +
    maskMinutes +
    20 + // 睡前洗漱
    25 + // 复盘收束
    weeklyReviewMinutes;
  const totalOccupiedMinutes = studyMinutes + exerciseMinutes + formalRestMinutes + systemMinutes + lifeMinutes;
  const warning = studyMinutes > 540
    ? "纯学习偏满"
    : exerciseMinutes >= 90 && studyMinutes > 480
      ? "运动日任务偏满"
      : totalOccupiedMinutes > 780
        ? "可能影响睡眠收束"
        : "容量正常";
  return { studyMinutes, exerciseMinutes, formalRestMinutes, systemMinutes, showerMinutes, maskMinutes, weeklyReviewMinutes, lifeMinutes, totalOccupiedMinutes, warning };
}

function buildAutoSchedulePlan({ draft, mathTemplate, englishTemplate, englishSkills, autoContext, effectiveMorningPrepMinutes, showerPlan, maskPlan }) {
  const fallbackTimelineStart = resolveWakeRoutineStart(draft);
  const timelineEndRaw = clockToDayMinutes(draft.targetBedTime) ?? 23 * 60 + 20;
  const baseTaskGroups = buildPlannerTaskGroups({ draft, mathTemplate, englishTemplate, englishSkills, autoContext, showerPlan, maskPlan });
  const existingSegments = flattenPlannerTasks(baseTaskGroups, draft.taskPoolOrder);
  const existingTimelineCards = existingSegments.map((segment) => ({
    id: segment.blockId,
    taskId: segment.id,
    title: segment.segmentTitle,
    systemRole: segment.systemRole || null,
    categoryId: segment.categoryId,
    startMinute: segment.manualStart,
    endMinute: Number.isFinite(Number(segment.manualStart)) ? Number(segment.manualStart) + segment.occupiedDuration : null,
    placement: segment.placement,
    transient: segment.transient === true,
  }));
  const customAnchor = findDayStartAnchor(existingTimelineCards);
  const timelineStart = resolvePlannerTimelineStart({
    cards: existingTimelineCards,
    wakeUpTime: draft.wakeUpTime,
    defaultWakeUpTime: formatClockMinutes(fallbackTimelineStart),
    safeDefault: fallbackTimelineStart,
  });
  const scheduleStart = customAnchor?.endMinute ?? timelineStart + Number(effectiveMorningPrepMinutes || 0);
  const timelineEnd = timelineEndRaw <= timelineStart ? timelineEndRaw + 24 * 60 : timelineEndRaw;
  const lifeCards = buildPlannerFixedBlocks({ draft, timelineStart, timelineEnd, effectiveMorningPrepMinutes, hasCustomMorningAnchor: Boolean(customAnchor) });
  const taskGroups = [...baseTaskGroups, ...lifeCards.map((card) => card.taskGroup)];
  const warnings = [];
  const blocks = [];
  let occupied = mergeIntervals(blocks.map(blockToInterval));
  const segments = flattenPlannerTasks(taskGroups, draft.taskPoolOrder);
  const timelineSegments = segments.filter((segment) => segment.placement === "timeline" || segment.placement === "history");
  const pinnedSegments = timelineSegments.filter((segment) => segment.locked && Number.isFinite(Number(segment.manualStart)));
  const movableSegments = timelineSegments.filter((segment) => !pinnedSegments.includes(segment));
  const addTaskBlock = (segment, placement) => {
    const block = {
      id: segment.blockId,
      title: segment.segmentTitle,
      start: placement.start,
      end: placement.start + segment.occupiedDuration,
      kind: "task",
      category: segment.category,
      categoryId: segment.categoryId,
      note: segment.note,
      taskId: segment.id,
      taskGroup: segment.taskGroup,
      studyMinutes: segment.duration,
      breakMinutes: segment.breakAfter,
      segmentIndex: segment.segmentIndex,
      segmentTotal: segment.segmentTotal,
      priority: segment.priority,
      preferredPeriods: segment.preferredPeriods,
      categoryStatGroup: segment.categoryStatGroup,
      systemRole: segment.systemRole || null,
      locked: Boolean(segment.locked),
      isFixedItinerary: Boolean(segment.locked),
      status: segment.status,
    };
    blocks.push(block);
    occupied = mergeIntervals([...occupied, blockToInterval(block)]);
  };

  pinnedSegments.forEach((segment) => {
    const start = Number(segment.manualStart);
    const end = start + segment.occupiedDuration;
    if (start < timelineStart || end > timelineEnd) {
      warnings.push(`已锁定行程超出时间线：${segment.title}`);
      return;
    }
    addTaskBlock(segment, { start });
  });

  movableSegments.forEach((segment) => {
    const currentFree = subtractIntervals({ start: Math.max(timelineStart, scheduleStart), end: timelineEnd }, occupied);
    const placement = choosePlannerPlacement(segment, currentFree);
    if (!placement) {
      warnings.push(`未排入：${segment.title} ${segment.duration}min`);
      segment.unplaced = true;
      return;
    }
    addTaskBlock(segment, placement);
  });

  const conflicts = findPlannerOverlaps(blocks);
  const conflictIds = new Set(conflicts.flatMap((conflict) => [conflict.first.id, conflict.second.id]));
  const sortedBlocks = blocks
    .map((block) => ({ ...block, conflict: conflictIds.has(block.id) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (conflicts.length > 0) {
    console.warn("Schedule conflicts", conflicts);
    warnings.push(`发现 ${conflicts.length} 处排程冲突`);
  }
  const freeIntervals = subtractIntervals({ start: timelineStart, end: timelineEnd }, mergeIntervals(sortedBlocks.map(blockToInterval)));
  const metrics = calculatePlannerMetrics(timelineStart, timelineEnd, sortedBlocks, freeIntervals);
  const segmentFree = calculateSegmentFreeMinutes(timelineStart, timelineEnd, sortedBlocks, draft);
  const poolSegments = segments.filter((segment) => segment.placement === "pool" || segment.unplaced);
  const unplacedSegments = poolSegments;
  if (metrics.freeMinutes < 30) warnings.push("剩余空档低于30min，明天执行会很紧。");
  if (unplacedSegments.length > 0) warnings.push("有任务未能塞进真实空档，请压缩或改固定事件。");
  return {
    wakeUpTime: formatClockMinutes(timelineStart),
    timelineStart,
    timelineEnd,
    taskGroups,
    taskSegments: segments,
    poolSegments,
    blocks: sortedBlocks,
    freeIntervals,
    unplacedSegments,
    metrics,
    segmentFree,
    conflicts,
    warnings: [...new Set(warnings)],
    loadStatus: metrics.freeMinutes < 30 ? "偏满" : metrics.freeMinutes < 90 ? "紧凑" : "合理",
  };
}

function resolveWakeRoutineStart(draft = {}) {
  const cardOverride = draft.todaySegmentOverrides?.["wake-prep"] || draft.todaySegmentOverrides?.["wake-prep-1"];
  const legacyOverride = draft.fixedEventOverrides?.["wake-prep"];
  const candidate = Number.isFinite(Number(cardOverride?.manualStart))
    ? Number(cardOverride.manualStart)
    : clockToDayMinutes(legacyOverride?.startTime) ?? clockToDayMinutes(draft.wakeUpTime);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 7 * 60 + 30;
}

function buildPlannerTaskGroups({ draft, mathTemplate = {}, englishTemplate = {}, englishSkills = [], autoContext = {} }) {
  const groups = [];
  const pushGroup = (group) => {
    if (draft.deletedTodayTaskIds?.includes(group.id) && !isMorningRoutineCard(group)) return;
    const segments = (group.segments || []).map((value) => Number(value || 0)).filter((value) => value > 0);
    if (!segments.length) return;
    const override = draft.todayTaskOverrides?.[group.id] || {};
    groups.push(normalizePlannerCategorizedItem({ ...group, ...override, segments: override.segments || segments, segmentOverrides: draft.todaySegmentOverrides || {} }, "personal"));
  };
  const addRepeated = (count, minutes) => Array.from({ length: Number(count || 0) }, () => minutes);

  pushGroup({
    id: "math-lecture",
    title: `数学｜网课 ${Number(mathTemplate.lectureBlocks50 || 0)}×50`,
    category: "数学",
    segments: addRepeated(mathTemplate.lectureBlocks50, 50),
    breakMinutes: 10,
    splittable: true,
    priority: 1,
    preferredPeriods: ["morning", "afternoon"],
    note: autoContext.mathProgressText || "",
  });
  pushGroup({
    id: "math-exercise",
    title: `数学｜习题 ${Number(mathTemplate.exerciseBlocks50 || 0)}×50`,
    category: "数学",
    segments: addRepeated(mathTemplate.exerciseBlocks50, 50),
    breakMinutes: 10,
    splittable: true,
    priority: 1,
    preferredPeriods: ["afternoon", "evening"],
    note: autoContext.mathBlockers || "",
  });
  pushGroup({
    id: "math-review",
    title: "数学｜复习",
    category: "数学",
    segments: addRepeated(mathTemplate.reviewBlocks30, 30),
    breakMinutes: 5,
    splittable: true,
    priority: 2,
    preferredPeriods: ["evening", "afternoon"],
  });
  pushGroup({
    id: "math-error",
    title: "数学｜错题",
    category: "数学",
    segments: addRepeated(mathTemplate.errorReviewBlocks50, 50),
    breakMinutes: 10,
    splittable: true,
    priority: 1,
    preferredPeriods: ["afternoon", "evening"],
  });
  pushGroup({
    id: "math-summary",
    title: "数学｜总结",
    category: "数学",
    segments: addRepeated(mathTemplate.summaryBlocks30, 30),
    breakMinutes: 5,
    splittable: true,
    priority: 2,
    preferredPeriods: ["evening"],
  });
  pushGroup({
    id: "english",
    title: `英语/雅思｜单词 + ${englishSkills.map((skill) => englishSkillText[skill]).join(" + ")}`,
    category: "英语/雅思",
    segments: [Number(englishTemplate.wordMinutes || 0), ...englishSkills.map(() => Number(englishTemplate.skillMinutes || 0))],
    breakMinutes: 5,
    splittable: true,
    priority: 2,
    preferredPeriods: ["afternoon", "evening"],
    note: autoContext.ieltsAdjustment || "",
  });
  pushGroup({
    id: "thesis",
    title: "论文｜可见产出",
    category: "论文",
    segments: splitLongPlannerMinutes(Number(draft.thesisMinutes || 0)),
    breakMinutes: 10,
    splittable: true,
    priority: 1,
    preferredPeriods: ["afternoon", "evening"],
    note: draft.thesisNote || autoContext.thesisAdjustmentText || "",
  });
  pushGroup({
    id: "professional",
    title: "专业课｜经济金融",
    category: "专业课",
    segments: splitLongPlannerMinutes(Number(draft.professionalMinutes || 0)),
    breakMinutes: 10,
    splittable: true,
    priority: 2,
    preferredPeriods: ["afternoon", "morning"],
    note: draft.professionalNote || "",
  });
  pushGroup({
    id: "exercise",
    title: `运动/恢复｜${draft.exerciseType || "运动"}`,
    category: "运动",
    segments: [Number(draft.exerciseMinutes || 0)],
    breakMinutes: 10,
    splittable: false,
    priority: 2,
    preferredPeriods: ["afternoon", "evening"],
  });
  pushGroup({
    id: "formal-rest",
    title: "正式休息娱乐",
    category: "娱乐",
    segments: addRepeated(draft.formalRestBlocks ?? 1, Number(draft.formalRestMinutes || 0)),
    breakMinutes: 0,
    splittable: true,
    priority: 3,
    preferredPeriods: ["midday", "evening"],
  });
  pushGroup({
    id: "system",
    title: "系统开发 / 轻维护",
    category: "生活",
    segments: [{ none: 0, max_30: 30, max_50: 50, only_if_mainlines_done: 30 }[draft.systemDevelopmentLimit] || 0],
    breakMinutes: 0,
    splittable: false,
    priority: 3,
    preferredPeriods: ["evening"],
  });
  pushGroup({
    id: "reading",
    title: autoContext.recentReadingTitle ? `阅读｜${autoContext.recentReadingTitle}` : "阅读｜低风险休息",
    category: "阅读",
    segments: autoContext.recentReadingTitle ? [30] : [],
    breakMinutes: 0,
    splittable: false,
    priority: 3,
    preferredPeriods: ["evening", "midday"],
  });
  pushGroup({
    id: "weekly-review",
    title: "周总复盘",
    category: "生活",
    segments: isSundayDate(draft.targetDate) ? [30] : [],
    breakMinutes: 0,
    splittable: false,
    priority: 2,
    preferredPeriods: ["evening"],
  });
  migrateLegacyFixedEvents(draft.fixedEvents, draft.fixedEventOverrides, draft.targetDate).forEach((eventItem) => {
    const start = Number(eventItem.manualStart);
    pushGroup({
      ...eventItem,
      id: eventItem.id,
      title: eventItem.title,
      category: eventItem.category,
      categoryId: plannerCategoryId(eventItem),
      segments: eventItem.segments,
      breakMinutes: 0,
      splittable: false,
      priority: 1,
      preferredPeriods: [periodKeyForPlannerMinute(start)],
      manualStart: start,
      source: "legacy-fixed-event",
      note: [eventItem.location, eventItem.note].filter(Boolean).join(" "),
    });
  });
  (draft.todayCustomBlocks || []).forEach((task) => pushGroup(task));
  return groups;
}

function buildPlannerFixedBlocks({ draft, timelineStart, timelineEnd, effectiveMorningPrepMinutes, hasCustomMorningAnchor = false }) {
  const blocks = [];
  const add = (id, title, start, end, category = "固定", note = "", extra = {}) => {
    const isMorningRoutine = id === "wake-prep" || extra.categoryId === LIFE_CATEGORY_IDS.morningRoutine;
    if (draft.deletedTodayTaskIds?.includes(id) && !isMorningRoutine) return;
    const override = draft.fixedEventOverrides?.[id] || {};
    const cardOverride = draft.todaySegmentOverrides?.[id] || draft.todaySegmentOverrides?.[`${id}-1`] || {};
    if (!isMorningRoutine && (override.deleted || cardOverride.deleted || cardOverride.placement === "deleted")) return;
    const overrideStart = Number.isFinite(Number(cardOverride.manualStart)) ? Number(cardOverride.manualStart) : override.startTime ? clockToDayMinutes(override.startTime) : start;
    const overrideEnd = Number.isFinite(Number(cardOverride.workMinutes)) ? overrideStart + Number(cardOverride.workMinutes) : override.endTime ? clockToDayMinutes(override.endTime) : end;
    const finalTitle = override.title || title;
    if (overrideStart === null || overrideEnd === null || overrideEnd <= overrideStart) return;
    const normalizedStart = normalizePlannerMinute(overrideStart, timelineStart);
    const normalizedEnd = normalizePlannerMinute(overrideEnd, timelineStart);
    if (normalizedEnd <= timelineStart || normalizedStart >= timelineEnd) return;
    const categoryId = plannerCategoryId({ categoryId: override.categoryId || extra.categoryId, category: override.category || category });
    const duration = Math.min(timelineEnd, normalizedEnd) - Math.max(timelineStart, normalizedStart);
    const taskGroup = normalizePlannerCategorizedItem({ id, title: finalTitle, category: override.category || category, categoryId, categoryStatGroup: extra.statGroup || "life", segments: [duration], breakMinutes: 0, manualStart: Math.max(timelineStart, normalizedStart), locked: cardOverride.locked ?? override.locked ?? true, systemRole: override.systemRole || extra.systemRole || null, segmentOverrides: draft.todaySegmentOverrides || {}, source: "system-life-card", note: override.note ?? note }, LIFE_CATEGORY_IDS.other);
    blocks.push({
      id,
      title: finalTitle,
      start: Math.max(timelineStart, normalizedStart),
      end: Math.min(timelineEnd, normalizedEnd),
      kind: "task",
      category: override.category || category,
      categoryId,
      categoryStatGroup: extra.statGroup || "life",
      fixed: false,
      isFixedEvent: false,
      taskId: id,
      taskGroup,
      studyMinutes: duration,
      breakMinutes: 0,
      segmentIndex: 1,
      segmentTotal: 1,
      priority: 1,
      preferredPeriods: [periodKeyForPlannerMinute(normalizedStart)],
      locked: cardOverride.locked ?? override.locked ?? true,
      status: cardOverride.status || "pending",
      note: override.note ?? note,
      type: override.type || extra.type || "custom",
      systemRole: override.systemRole || extra.systemRole || null,
      constraint: override.constraint || extra.constraint || "hard",
      editable: true,
    });
  };
  if (!hasCustomMorningAnchor) add("wake-prep", "起床｜洗漱 + 到学习地点", timelineStart, timelineStart + Number(effectiveMorningPrepMinutes || 0), "晨间洗漱", "系统预留", { categoryId: LIFE_CATEGORY_IDS.morningRoutine, type: "preparation", systemRole: "day-start-anchor" });
  const lunchStart = clockToDayMinutes(draft.lunchStartTime) ?? 12 * 60 + 30;
  add("lunch", "午餐", lunchStart, lunchStart + Math.min(40, Number(draft.lunchBlockMinutes || 40)), "午餐", "午餐安排", { categoryId: LIFE_CATEGORY_IDS.lunch, type: "meal" });
  const lunchEnd = lunchStart + Number(draft.lunchBlockMinutes || 0);
  add("startup", "午休与启动缓冲", lunchStart + 40, lunchEnd + Number(draft.startupBufferMinutes || 0), "午休", "进入下午前缓冲", { categoryId: LIFE_CATEGORY_IDS.nap });
  add("dinner", "晚餐", 18 * 60, 18 * 60 + Number(draft.dinnerMinutes ?? 40), "晚餐", "晚餐安排", { categoryId: LIFE_CATEGORY_IDS.dinner, type: "meal" });
  add("daily-review", "复盘 + 收束", 21 * 60 + 40, 22 * 60 + 5, "睡前收尾", "每日收尾", { categoryId: LIFE_CATEGORY_IDS.bedtimeClose, type: "custom" });
  add("bed-prep", "上床前洗漱", timelineEnd - 20, timelineEnd, "睡前收尾", "保护睡眠", { categoryId: LIFE_CATEGORY_IDS.bedtimeClose, type: "bedtime" });
  return blocks;
}

function resolvePlannerBoundaryCards(plan) {
  const blocks = plan?.blocks || [];
  const lunchCard = blocks.find((block) => block.locked && block.categoryId === LIFE_CATEGORY_IDS.lunch);
  const lockedEndCard = blocks.find((block) => block.locked && block.categoryId === LIFE_CATEGORY_IDS.bedtimeClose);
  const morningFallback = blocks.find((block) => block.id === "lunch");
  const endFallback = blocks.find((block) => block.id === "bed-prep");
  return {
    morningEnd: lunchCard?.start ?? morningFallback?.start ?? plan.timelineEnd,
    dayEnd: lockedEndCard?.start ?? endFallback?.start ?? plan.timelineEnd,
    morningSource: lunchCard ? "锁定午间卡片" : "午间默认边界",
    dayEndSource: lockedEndCard ? "锁定晚间护理卡片" : "睡前默认边界",
  };
}

function splitLongPlannerMinutes(minutes) {
  const value = Number(minutes || 0);
  if (value <= 0) return [];
  if (value <= 60) return [value];
  if (value === 90) return [90];
  const segments = [];
  let rest = value;
  while (rest > 60) {
    segments.push(rest >= 100 ? 50 : rest - 50);
    rest -= segments[segments.length - 1];
  }
  if (rest > 0) segments.push(rest);
  return segments;
}

function flattenPlannerTasks(taskGroups = [], taskPoolOrder = []) {
  const orderMap = Object.fromEntries(resolveTaskPoolOrder(taskGroups, taskPoolOrder).map((id, index) => [id, index]));
  return taskGroups
    .flatMap((task) => task.segments.map((duration, index) => {
      const blockId = `${task.id}-${index + 1}`;
      const segmentOverride = task.segmentOverrides?.[blockId] || {};
      const placement = resolveTaskSegmentPlacement(segmentOverride, task);
      if (placement === "deleted") return null;
      const workMinutes = Number(segmentOverride.workMinutes ?? duration ?? 0);
      const restMinutes = Number(segmentOverride.restMinutes ?? task.breakMinutes ?? 0);
      if (workMinutes + restMinutes <= 0) return null;
      const preferredPeriods = segmentOverride.preferredPeriods || task.preferredPeriods;
      return {
        ...task,
        duration: workMinutes,
        segmentIndex: index + 1,
        segmentTotal: task.segments.length,
        breakAfter: restMinutes,
        priority: Number(segmentOverride.priority || task.priority || 2),
        preferredPeriods,
        manualStart: segmentOverride.manualStart ?? task.manualStart,
        locked: Boolean(segmentOverride.locked ?? task.locked ?? false),
        placement,
        status: segmentOverride.status || "pending",
        manualOrder: orderMap[task.id] ?? 999,
        occupiedDuration: workMinutes + restMinutes,
        segmentTitle: buildPlannerSegmentTitle({ ...task, breakMinutes: restMinutes }, workMinutes, index),
        taskGroup: task,
        blockId,
      };
    }).filter(Boolean))
    .sort(comparePlannerSegments);
}

function resolveTaskSegmentPlacement(override = {}, task = {}) {
  if (override.deleted || override.placement === "deleted") return "deleted";
  if (["pool", "timeline", "history"].includes(override.placement)) return override.placement;
  if (override.unscheduled) return "pool";
  // Earlier drafts only persisted a manual start for a task already dragged onto the timeline.
  return Number.isFinite(Number(override.manualStart ?? task.manualStart)) ? "timeline" : "pool";
}

function comparePlannerSegments(a, b) {
  if (a.locked !== b.locked) return a.locked ? -1 : 1;
  if (Number.isFinite(Number(a.manualStart)) !== Number.isFinite(Number(b.manualStart))) {
    return Number.isFinite(Number(a.manualStart)) ? -1 : 1;
  }
  return a.priority - b.priority || a.manualOrder - b.manualOrder || a.segmentIndex - b.segmentIndex || b.duration - a.duration;
}

function clearScheduleLabel(scope) {
  return {
    timeline: "已清空时间线任务",
    morning: "已清空上午",
    afternoon: "已清空下午",
    evening: "已清空晚间",
    "before-now": "已清空当前时间之前的未锁定任务",
    "after-now": "已清空当前时间之后的未锁定任务",
    unlocked: "已清空未锁定任务",
    "all-today": "已清空今天全部内容",
    "restore-template": "已恢复模板初始状态",
  }[scope] || "已清空排程";
}

function rescheduleScopeLabel(scope) {
  if (String(scope).startsWith("after:")) return "已重排此块之后";
  return {
    all: "已重新排整天",
    now: "已从现在开始重排",
    morning: "已重排上午",
    afternoon: "已重排下午",
    evening: "已重排晚间",
    unplaced: "已尝试安排未排入任务",
  }[scope] || "已重新排程";
}

function buildPlannerSegmentTitle(task, duration, index) {
  const rhythm = Number(task.breakMinutes || 0) > 0 ? `${duration}+${task.breakMinutes}` : `${duration}`;
  const suffix = task.segments.length > 1 ? ` ${index + 1}/${task.segments.length}` : "";
  return `${task.title} ${rhythm}${suffix}`;
}

function plannerRhythmText(task = {}) {
  const segments = task.segments || [];
  if (!segments.length) return "未设定";
  if (segments.length > 1 && segments.every((item) => item === segments[0]) && Number(task.breakMinutes || 0) === 0) {
    return `${segments[0]}×${segments.length}`;
  }
  if (segments.length > 1 && segments.every((item) => item === segments[0]) && Number(task.breakMinutes || 0) > 0) {
    return `${segments[0]}+${task.breakMinutes}`;
  }
  return segments.map((item) => `${item}${Number(task.breakMinutes || 0) > 0 ? `+${task.breakMinutes}` : ""}`).join(" + ");
}

function parsePlannerRhythm(value, overrideBreakMinutes) {
  const text = String(value || "50+10").trim();
  const timesMatch = text.match(/^(\d+)\s*[×x]\s*(\d+)$/i);
  if (timesMatch) {
    const minutes = Number(timesMatch[1]);
    const count = Number(timesMatch[2]);
    return { studySegments: Array.from({ length: count }, () => minutes), breakMinutes: Number(overrideBreakMinutes ?? 0), label: `${minutes}×${count}` };
  }
  const parts = text.split("+").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0);
  if (parts.length >= 2) {
    return { studySegments: [parts[0]], breakMinutes: Number(overrideBreakMinutes ?? parts[1]), label: `${parts[0]}+${Number(overrideBreakMinutes ?? parts[1])}` };
  }
  const single = parts[0] || Number(text.match(/\d+/)?.[0] || 50);
  return { studySegments: [single], breakMinutes: Number(overrideBreakMinutes ?? 0), label: `${single}${Number(overrideBreakMinutes ?? 0) > 0 ? `+${Number(overrideBreakMinutes ?? 0)}` : ""}` };
}

function choosePlannerPlacement(segment, freeIntervals) {
  if (Number.isFinite(Number(segment.manualStart))) {
    const start = Number(segment.manualStart);
    const end = start + segment.occupiedDuration;
    const targetGap = freeIntervals.find((gap) => start >= gap.start && end <= gap.end);
    if (targetGap) return { start, sourceEnd: targetGap.end };
  }
  const periodCandidates = plannerPeriodWindows()
    .filter((period) => segment.preferredPeriods.includes(period.key))
    .flatMap((period) => freeIntervals
      .map((gap) => intersectInterval(gap, period))
      .filter(Boolean));
  const fallbackCandidates = freeIntervals;
  const candidates = [...periodCandidates, ...fallbackCandidates];
  const fit = candidates.find((gap) => gap.end - gap.start >= segment.occupiedDuration);
  return fit ? { start: fit.start, sourceEnd: fit.end } : null;
}

function findNearestPlannerPlacement(plan, active, preferredStart) {
  const duration = Number(active.duration || 0);
  if (duration <= 0) return null;
  const occupied = plan.blocks
    .filter((block) => block.id !== active.blockId)
    .map(blockToInterval);
  const gaps = subtractIntervals({ start: plan.timelineStart, end: plan.timelineEnd }, mergeIntervals(occupied));
  const candidates = gaps
    .filter((gap) => gap.end - gap.start >= duration)
    .flatMap((gap) => {
      const earliest = gap.start;
      const latest = gap.end - duration;
      const clamped = Math.max(earliest, Math.min(preferredStart, latest));
      const snapped = Math.max(earliest, Math.min(latest, Math.round(clamped / 5) * 5));
      return [{ start: snapped, end: snapped + duration }, { start: earliest, end: earliest + duration }];
    });
  return candidates.sort((a, b) => Math.abs(a.start - preferredStart) - Math.abs(b.start - preferredStart))[0] || null;
}

function findNearestPlannerGap(plan, active, preferredStart, minDuration = 0) {
  const occupied = plan.blocks.filter((block) => block.id !== active.blockId).map(blockToInterval);
  const gaps = subtractIntervals({ start: plan.timelineStart, end: plan.timelineEnd }, mergeIntervals(occupied));
  return gaps
    .filter((gap) => gap.end - gap.start >= minDuration)
    .sort((a, b) => Math.abs(a.start - preferredStart) - Math.abs(b.start - preferredStart))[0] || null;
}

// Every move path addresses one concrete timeline block id. The active block is removed
// before calculating obstacles, so a task can never become its own blocker.
function planTaskMove(plan, activeSegmentId, targetStart, durationOverride, allowRipple = true, allowGapCompression = false) {
  const activeBlock = plan.blocks.find((block) => block.id === activeSegmentId && block.kind === "task");
  const activeSegment = plan.taskSegments.find((segment) => segment.blockId === activeSegmentId);
  if (!activeSegment) return { type: "noop" };
  // Pool segments do not have a rendered timeline block yet. Use their own occupied
  // duration instead of subtracting undefined timeline coordinates into NaN.
  const renderedDuration = activeBlock ? activeBlock.end - activeBlock.start : null;
  const duration = Number(durationOverride ?? renderedDuration ?? activeSegment.occupiedDuration);
  if (!Number.isFinite(duration) || duration <= 0) return { type: "noop" };
  const originalStart = activeBlock?.start;
  const start = Math.max(plan.timelineStart, Math.min(Math.round(Number(targetStart ?? originalStart ?? plan.timelineStart) / 5) * 5, plan.timelineEnd - duration));
  if (Number.isFinite(originalStart) && start === originalStart && duration === activeBlock.end - activeBlock.start) return { type: "noop" };
  const timelineWithoutActive = plan.blocks.filter((block) => block.id !== activeSegmentId);
  const hard = timelineWithoutActive.filter((block) => block.kind === "fixed" || block.locked || block.status === "completed").sort((a, b) => a.start - b.start);
  const movable = timelineWithoutActive.filter((block) => block.kind === "task" && !block.locked && block.status !== "completed").sort((a, b) => a.start - b.start);
  const activeRange = { start, end: start + duration };
  const buildGapCompressionPlan = (boundary) => {
    const gapEnd = boundary?.start ?? plan.timelineEnd;
    return {
      type: "needs-compression",
      boundary,
      gapEnd,
      availableMinutes: Math.max(0, gapEnd - start),
      requestedWork: Number(activeSegment.duration || 0),
      requestedRest: Math.max(0, duration - Number(activeSegment.duration || 0)),
    };
  };
  const activeBoundary = hard.find((item) => intervalsOverlap(activeRange, item));
  if (activeBoundary) {
    if (allowGapCompression && activeBoundary.start > start) return buildGapCompressionPlan(activeBoundary);
    return { type: "hard-conflict", boundary: activeBoundary };
  }
  if (!allowRipple) {
    const ordinaryBlocker = movable.find((item) => intervalsOverlap(activeRange, item));
    if (ordinaryBlocker) {
      if (ordinaryBlocker.start < start) return { type: "hard-conflict", boundary: ordinaryBlocker };
      const nextBoundary = [...timelineWithoutActive]
        .filter((item) => item.start >= start)
        .sort((a, b) => a.start - b.start)[0];
      return buildGapCompressionPlan(nextBoundary || ordinaryBlocker);
    }
    return { type: "success-exact", positions: [{ id: activeSegmentId, ...activeRange }], shifted: [] };
  }
  let cursor = start + duration;
  const shifted = [];
  for (const block of movable) {
    if (block.end <= start || block.start >= cursor) continue;
    const next = { id: block.id, oldStart: block.start, oldEnd: block.end, start: cursor, end: cursor + (block.end - block.start) };
    const boundary = hard.find((item) => intervalsOverlap(next, item));
    if (boundary || next.end > plan.timelineEnd) return { type: "hard-conflict", boundary: boundary || { title: "上床边界", start: plan.timelineEnd, end: plan.timelineEnd } };
    shifted.push(next);
    cursor = next.end;
  }
  return { type: shifted.length ? "success-ripple" : "success-exact", positions: [{ id: activeSegmentId, ...activeRange }, ...shifted], shifted };
}

function planTaskSwap(plan, activeSegmentId, targetSegmentId) {
  const active = plan.blocks.find((block) => block.id === activeSegmentId && block.kind === "task");
  const target = plan.blocks.find((block) => block.id === targetSegmentId && block.kind === "task");
  if (!active || !target || active.locked || target.locked || active.status === "completed" || target.status === "completed") return { type: "hard-conflict", boundary: target || active };
  const activeDuration = active.end - active.start;
  const targetDuration = target.end - target.start;
  if (activeDuration !== targetDuration) return { type: "hard-conflict", boundary: target };
  return {
    type: "success-swap",
    positions: [
      { id: active.id, start: target.start, end: target.end },
      { id: target.id, start: active.start, end: active.end },
    ],
  };
}

function planPoolTaskSwap(plan, poolSegmentId, targetSegmentId) {
  const poolSegment = plan.taskSegments.find((segment) => segment.blockId === poolSegmentId);
  const target = plan.blocks.find((block) => block.id === targetSegmentId && block.kind === "task");
  if (!poolSegment || !target || target.locked || target.status === "completed") return { type: "hard-conflict", boundary: target };
  if (Number(poolSegment.occupiedDuration) !== target.end - target.start) return { type: "hard-conflict", boundary: target };
  return {
    type: "success-pool-swap",
    positions: [{ id: poolSegmentId, start: target.start, end: target.end }],
    returnedToPool: [targetSegmentId],
  };
}

function buildLocalInsertPlan(plan, active, targetId, after) {
  const moving = plan.taskSegments.find((segment) => segment.blockId === active.blockId);
  const target = plan.blocks.find((block) => block.id === targetId);
  if (!moving || !target) return { ok: false, boundary: target };
  const hardBlocks = plan.blocks.filter((block) => block.kind === "fixed" || block.locked || block.status === "completed").sort((a, b) => a.start - b.start);
  const previousBoundary = [...hardBlocks].reverse().find((block) => block.end <= target.start);
  const nextBoundary = hardBlocks.find((block) => block.start >= target.end);
  const regionStart = previousBoundary?.end ?? plan.timelineStart;
  const regionEnd = nextBoundary?.start ?? plan.timelineEnd;
  const movable = plan.blocks
    .filter((block) => block.kind === "task" && block.status !== "completed" && !block.locked && block.start >= regionStart && block.end <= regionEnd && block.id !== active.blockId)
    .sort((a, b) => a.start - b.start);
  const targetIndex = movable.findIndex((block) => block.id === targetId);
  if (targetIndex < 0) return { ok: false, boundary: target };
  const movingBlock = { id: moving.blockId, duration: moving.occupiedDuration };
  const sequence = [...movable];
  sequence.splice(targetIndex + (after ? 1 : 0), 0, movingBlock);
  const start = Math.min(...movable.map((block) => block.start), active.source === "timeline" ? plan.blocks.find((block) => block.id === active.blockId)?.start ?? target.start : target.start);
  let cursor = start;
  const positions = sequence.map((block) => {
    const duration = block.duration ?? block.end - block.start;
    const position = { id: block.id, start: cursor, end: cursor + duration };
    cursor += duration;
    return position;
  });
  if (cursor > regionEnd) return { ok: false, boundary: nextBoundary || { title: "上床边界", start: regionEnd, end: regionEnd } };
  return { ok: true, positions, regionStart, regionEnd };
}

function buildPlannerRecoveryPreview(plan, requestedCutoff) {
  const cutoff = Math.max(plan.timelineStart, Math.min(Number(requestedCutoff ?? plan.timelineStart), plan.timelineEnd));
  const blocksById = new Map(plan.blocks.filter((block) => block.kind === "task").map((block) => [block.id, block]));
  const preservedSegmentIds = new Set();
  const returnedSegmentIds = new Set();
  const candidateSegments = [];

  plan.taskSegments.forEach((segment) => {
    const block = blocksById.get(segment.blockId);
    const isCompleted = segment.status === "completed";
    const shouldKeep = Boolean(block && (isCompleted || segment.locked || segment.placement === "history"));
    if (shouldKeep) {
      preservedSegmentIds.add(segment.blockId);
      return;
    }
    candidateSegments.push(segment);
    if (block) returnedSegmentIds.add(segment.blockId);
  });

  const preservedBlocks = plan.blocks.filter((block) => (
    block.kind === "fixed" || preservedSegmentIds.has(block.id)
  ));
  let occupied = mergeIntervals(preservedBlocks.map(blockToInterval));
  const plannedSegments = [];
  const stillUnplaced = [];

  candidateSegments.forEach((segment) => {
    const freeIntervals = subtractIntervals({ start: cutoff, end: plan.timelineEnd }, occupied);
    const placement = choosePlannerPlacement({ ...segment, manualStart: null }, freeIntervals);
    if (!placement) {
      stillUnplaced.push(segment);
      return;
    }
    const block = {
      id: segment.blockId,
      start: placement.start,
      end: placement.start + segment.occupiedDuration,
    };
    plannedSegments.push({ ...segment, ...block });
    occupied = mergeIntervals([...occupied, blockToInterval(block)]);
  });

  return {
    cutoff,
    candidateSegments,
    plannedSegments,
    stillUnplaced,
    preservedTaskCount: preservedSegmentIds.size,
    preservedFixedCount: preservedBlocks.filter((block) => block.kind === "fixed").length,
    returnedTaskCount: returnedSegmentIds.size,
  };
}

function calculatePlannerMetrics(timelineStart, timelineEnd, blocks, freeIntervals) {
  const fixedMinutes = sumBlockMinutes(blocks.filter((block) => block.kind === "fixed"));
  const isStudyBlock = (block) => {
    const category = plannerCategoryFor(block);
    return (
      category.statGroup === "study" ||
      category.statGroup === "reading" ||
      plannerCategoryId(block) === "reading"
    );
  };
  const plannerMinutes = summarizePlannerMinutes(blocks, { isStudyBlock });
  const freeMinutes = freeIntervals.reduce((sum, gap) => sum + gap.end - gap.start, 0);
  const maxFreeMinutes = freeIntervals.reduce((max, gap) => Math.max(max, gap.end - gap.start), 0);
  return {
    totalSpan: timelineEnd - timelineStart,
    fixedMinutes,
    studyMinutes: plannerMinutes.pureStudyMinutes,
    nonStudyMinutes: plannerMinutes.nonStudyActiveMinutes,
    breakMinutes: plannerMinutes.breakMinutes,
    taskFootprintMinutes: plannerMinutes.taskFootprintMinutes,
    freeMinutes,
    maxFreeMinutes,
  };
}

function calculateSegmentFreeMinutes(timelineStart, timelineEnd, blocks, draft) {
  const lunchStart = normalizePlannerMinute(12 * 60 + 30, timelineStart);
  const lunchEnd = lunchStart + Number(draft.lunchBlockMinutes || 0) + Number(draft.startupBufferMinutes || 0);
  const dinnerStart = normalizePlannerMinute(18 * 60, timelineStart);
  const dinnerEnd = dinnerStart + 40;
  const reviewStart = normalizePlannerMinute(21 * 60 + 40, timelineStart);
  const occupied = mergeIntervals(blocks.map(blockToInterval));
  const fixedBlocks = blocks.filter((block) => block.kind === "fixed");
  const taskBlocks = blocks.filter((block) => block.kind === "task");
  return [
    { key: "morning", label: "上午", start: timelineStart, end: Math.min(lunchStart, timelineEnd) },
    { key: "midday", label: "午间", start: lunchStart, end: Math.min(lunchEnd, timelineEnd) },
    { key: "afternoon", label: "下午", start: Math.max(lunchEnd, timelineStart), end: Math.min(dinnerStart, timelineEnd) },
    { key: "evening", label: "晚间", start: Math.max(dinnerEnd, timelineStart), end: Math.min(reviewStart, timelineEnd) },
  ].map((segment) => ({
    ...segment,
  })).map((segment) => {
    if (segment.end <= segment.start) {
      return { ...segment, minutes: 0, availableMinutes: 0, scheduledMinutes: 0, freeMinutes: 0, fixedMinutes: 0, loadRatio: 0 };
    }
    const interval = { start: segment.start, end: segment.end };
    const spanMinutes = segment.end - segment.start;
    const fixedMinutes = fixedBlocks.reduce((sum, block) => sum + intervalOverlapMinutes(interval, block), 0);
    const taskFootprintMinutes = taskBlocks.reduce((sum, block) => sum + intervalOverlapMinutes(interval, block), 0);
    const freeMinutes = subtractIntervals(interval, occupied).reduce((sum, gap) => sum + gap.end - gap.start, 0);
    const availableMinutes = Math.max(0, spanMinutes - fixedMinutes);
    const scheduledMinutes = Math.max(0, availableMinutes - freeMinutes);
    return {
      ...segment,
      minutes: availableMinutes,
      spanMinutes,
      fixedMinutes,
      scheduledTaskFootprintMinutes: taskFootprintMinutes,
      scheduledMinutes,
      freeMinutes,
      availableMinutes,
      loadRatio: availableMinutes > 0 ? scheduledMinutes / availableMinutes : 0,
    };
  });
}

function blockToInterval(block) {
  return { start: block.start, end: block.end };
}

function sumBlockMinutes(blocks = []) {
  return blocks.reduce((sum, block) => sum + Math.max(0, block.end - block.start), 0);
}

function intervalOverlapMinutes(interval, block) {
  const start = Math.max(interval.start, block.start);
  const end = Math.min(interval.end, block.end);
  return Math.max(0, end - start);
}

function intervalsOverlap(first, second) {
  return first.start < second.end && second.start < first.end;
}

function mergeIntervals(intervals = []) {
  return intervals
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start)
    .reduce((merged, interval) => {
      const last = merged[merged.length - 1];
      if (!last || interval.start > last.end) merged.push({ ...interval });
      else last.end = Math.max(last.end, interval.end);
      return merged;
    }, []);
}

function subtractIntervals(base, occupied = []) {
  const merged = mergeIntervals(occupied);
  let cursor = base.start;
  const free = [];
  merged.forEach((interval) => {
    if (interval.end <= base.start || interval.start >= base.end) return;
    const start = Math.max(base.start, interval.start);
    const end = Math.min(base.end, interval.end);
    if (start > cursor) free.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  });
  if (cursor < base.end) free.push({ start: cursor, end: base.end });
  return free.filter((gap) => gap.end - gap.start >= 10);
}

function intersectInterval(gap, period) {
  const start = Math.max(gap.start, period.start);
  const end = Math.min(gap.end, period.end);
  return end > start ? { start, end } : null;
}

function normalizePlannerMinute(minutes, timelineStart) {
  if (minutes === null || minutes === undefined) return null;
  let value = Number(minutes);
  while (value < timelineStart) value += 24 * 60;
  return value;
}

function calculateDropTime({ pointerClientY, timelineRectTop, timelineScrollTop, grabOffsetY, timelineStartMinutes, pxPerMinute }) {
  const relativeY = pointerClientY - timelineRectTop + timelineScrollTop - grabOffsetY;
  const rawMinutes = timelineStartMinutes + relativeY / pxPerMinute;
  return Math.round(rawMinutes / 5) * 5;
}

function plannerPeriodWindows() {
  return [
    { key: "morning", start: 7 * 60, end: 12 * 60 + 30 },
    { key: "midday", start: 12 * 60 + 30, end: 14 * 60 },
    { key: "afternoon", start: 14 * 60, end: 18 * 60 },
    { key: "evening", start: 18 * 60 + 30, end: 21 * 60 + 40 },
  ];
}

function plannerPeriodLabel(key) {
  return { morning: "上午", midday: "午间", afternoon: "下午", evening: "晚间" }[key] || key;
}

function resolveTaskPoolOrder(tasks = [], savedOrder = []) {
  const ids = tasks.map((task) => task.id);
  return [...(savedOrder || []).filter((id) => ids.includes(id)), ...ids.filter((id) => !savedOrder?.includes(id))];
}

function plannerTaskPrimaryDuration(task = {}) {
  const firstSegment = task.poolSegments?.[0];
  if (firstSegment) return Number(firstSegment.occupiedDuration || 0);
  const first = Number(task.segments?.[0] || 0);
  return first + Number(task.breakMinutes || 0);
}

function plannerPoolRemainingText(task = {}) {
  const remaining = task.poolSegments || [];
  if (!remaining.length) return "0min";
  const workMinutes = remaining.map((segment) => Number(segment.duration || 0));
  const allSame = workMinutes.every((minutes) => minutes === workMinutes[0]);
  if (allSame && workMinutes.length > 1) return `${workMinutes.length}×${workMinutes[0]}`;
  if (workMinutes.length === 1) {
    const restMinutes = Number(remaining[0].breakAfter || 0);
    return `${workMinutes[0]}${restMinutes > 0 ? `+${restMinutes}` : ""}`;
  }
  return `${workMinutes.reduce((sum, minutes) => sum + minutes, 0)}min / ${workMinutes.length}段`;
}

function periodKeyForPlannerMinute(minute) {
  const normalized = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  if (normalized < 12 * 60 + 30) return "morning";
  if (normalized < 14 * 60) return "midday";
  if (normalized < 18 * 60) return "afternoon";
  return "evening";
}

function plannerCategoryClass(category) {
  const categoryId = plannerCategoryId(category);
  const byId = {
    math: "cat-math",
    english: "cat-english",
    economics: "cat-professional",
    paper: "cat-thesis",
    personal: "cat-life",
    exercise: "cat-exercise",
    reading: "cat-reading",
    entertainment: "cat-entertainment",
  }[categoryId];
  if (byId) return byId;
  return {
    数学: "cat-math",
    "英语/雅思": "cat-english",
    论文: "cat-thesis",
    专业课: "cat-professional",
    运动: "cat-exercise",
    娱乐: "cat-entertainment",
    生活: "cat-life",
    阅读: "cat-reading",
    休息: "cat-break",
    固定: "cat-fixed",
  }[category] || "cat-fixed";
}

function buildTimelineTicks(start, end) {
  const ticks = [start];
  const first = Math.ceil(start / 30) * 30;
  for (let tick = first; tick <= end; tick += 30) {
    if (!ticks.includes(tick)) ticks.push(tick);
  }
  if (!ticks.includes(end)) ticks.push(end);
  return ticks.sort((a, b) => a - b);
}

function findPlannerOverlaps(blocks = []) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const conflicts = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.start < previous.end) {
      conflicts.push({ first: previous, second: current });
    }
  }
  return conflicts;
}

function isSundayDate(value) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && date.getDay() === 0;
}

const segmentGoalDefaults = {
  morning: { key: "morning", label: "上午", title: "午饭前", deadline: "13:00", rewardPoints: 1 },
  afternoon: { key: "afternoon", label: "下午", title: "晚饭前", deadline: "19:00", rewardPoints: 1.5 },
  evening: { key: "evening", label: "晚上", title: "睡前收束前", deadline: "22:00", rewardPoints: 1.5 },
};

function buildSegmentGoals(studyMinutes) {
  const total = Math.max(0, Number(studyMinutes || 0));
  return {
    morning: {
      ...segmentGoalDefaults.morning,
      targetMinutes: Math.round(total * 0.4),
    },
    afternoon: {
      ...segmentGoalDefaults.afternoon,
      targetMinutes: Math.round(total * 0.8),
    },
    evening: {
      ...segmentGoalDefaults.evening,
      targetMinutes: Math.round(total),
    },
  };
}

function buildTodaySegmentGoalState(data) {
  const date = beijingIsoDate();
  const storedEntry = data.profile?.scheduleSegmentGoals?.[date];
  const draft = data.profile?.scheduleAssistantDraft || {};
  const draftEntry = draft.targetDate === date && draft.segmentGoals
    ? { date, targets: draft.segmentGoals, completed: {} }
    : null;
  const entry = storedEntry || draftEntry;
  if (!entry?.targets) return { date, hasGoals: false, entry: { date, targets: {}, completed: {} }, segments: [] };

  const nowMinutes = minutesSinceMidnight();
  const segments = ["morning", "afternoon", "evening"].map((key) => {
    const target = entry.targets[key] || {};
    const defaults = segmentGoalDefaults[key];
    const deadline = defaults.deadline;
    const rewardPoints = Number(defaults.rewardPoints || target.rewardPoints || 1);
    const deadlineMinutes = clockToDayMinutes(deadline);
    const completed = Boolean(entry.completed?.[key]);
    const expired = !completed && deadlineMinutes !== null && nowMinutes >= deadlineMinutes;
    return {
      key,
      label: defaults.label || target.label,
      title: defaults.title || target.title || "",
      targetMinutes: Number(target.targetMinutes || 0),
      deadline,
      rewardPoints,
      completed,
      expired,
      message: pickMessage(segmentOverdueMessages, `${date}-${key}-overdue`),
      doneText: pickMessage(segmentDoneMessages, `${date}-${key}-done-static`),
    };
  });
  return { date, hasGoals: true, entry: { date, ...entry, targets: entry.targets, completed: entry.completed || {} }, segments };
}

function upsertScheduleSegmentGoalEntry(existing = {}, date, segmentGoals) {
  if (!date) return existing || {};
  const previous = existing?.[date] || {};
  return {
    ...(existing || {}),
    [date]: {
      ...previous,
      date,
      targets: segmentGoals,
      completed: previous.completed || {},
      updatedAt: new Date().toISOString(),
    },
  };
}

function minutesSinceMidnight() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function clockToDayMinutes(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function pickMessage(messages, seed) {
  const text = String(seed || "");
  const index = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % messages.length;
  return messages[index];
}

function formatSegmentReward(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function resolveMorningPrepMinutes(draft) {
  if (draft.morningPrepMinutes !== undefined && draft.morningPrepMinutes !== null && draft.morningPrepMinutes !== "") {
    return Math.max(0, Number(draft.morningPrepMinutes || 0));
  }
  if ((draft.scene === "school" || draft.scene === "school_with_exercise") && draft.commuteStatus === "no") {
    return 40;
  }
  return 20;
}

function shouldScheduleShower(draft) {
  if (Number(draft.exerciseMinutes || 0) > 0) {
    return { shouldShower: true, reason: "当天运动，必须安排洗澡" };
  }
  const date = new Date(`${draft.targetDate || beijingIsoDate(1)}T00:00:00`);
  const dayNumber = Math.floor(date.getTime() / 86400000);
  const shouldShower = Number.isFinite(dayNumber) ? dayNumber % 2 === 0 : false;
  return {
    shouldShower,
    reason: shouldShower ? "隔天洗澡日" : "非隔天洗澡日",
  };
}

function resolveScheduleMaskPlan(autoContext = {}, draft = {}) {
  const cycle = autoContext.maskCycle || {};
  const shouldSchedule = Boolean(cycle.shouldScheduleMaskTomorrow && (!cycle.tomorrowDate || cycle.tomorrowDate === draft.targetDate));
  if (!shouldSchedule) {
    return {
      shouldSchedule: false,
      suggestedTime: "",
      reason: cycle.message || "不强排面膜",
    };
  }
  return {
    shouldSchedule: true,
    suggestedTime: suggestMaskTime(draft.targetBedTime),
    reason: cycle.message || "面膜周期到期，明日建议安排。",
  };
}

function suggestMaskTime(targetBedTime) {
  const bedtimeMinutes = clockToDayMinutes(targetBedTime);
  if (bedtimeMinutes === null) return "21:50-22:10";
  const start = Math.max(18 * 60, bedtimeMinutes - 50);
  return `${formatClockMinutes(start)}-${formatClockMinutes(start + 20)}`;
}

function formatClockMinutes(minutes) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function resolveEnglishSkills(draft, settings, settlements = [], template = {}) {
  const count = Math.max(1, Math.min(4, Number(template.skillCount || 1)));
  if (template.skillMode === "manual") {
    return uniqueSkills([draft.englishSkill, draft.englishSecondSkill, ...(template.manualSkills || [])]).slice(0, count);
  }
  const enabled = settings.englishRotationSettings.enabledSkills || ["writing", "speaking", "reading", "listening"];
  const lastSeen = Object.fromEntries(enabled.map((skill) => [skill, -1]));
  settlements.forEach((settlement, index) => {
    const text = summarizeItems(settlement.subjects?.ielts?.progress || []);
    enabled.forEach((skill) => {
      if (lastSeen[skill] >= 0) return;
      if (text.includes(englishSkillText[skill])) lastSeen[skill] = index;
    });
  });
  const score = (skill) => (lastSeen[skill] < 0 ? 999 : lastSeen[skill]);
  return [...enabled].sort((a, b) => score(b) - score(a)).slice(0, count);
}

function uniqueSkills(skills = []) {
  const seen = new Set();
  return skills.filter((skill) => {
    if (!skill || seen.has(skill)) return false;
    seen.add(skill);
    return true;
  });
}

function labelFromOptions(options, value) {
  return options.find((item) => item[0] === value)?.[1] || value || "";
}

function fixedEventsText(events = []) {
  const lines = events
    .filter((eventItem) => eventItem.title || eventItem.startTime || eventItem.endTime)
    .map((eventItem) => `- ${eventItem.title || "固定事件"} ${eventItem.startTime || "?"}-${eventItem.endTime || "?"}${eventItem.location ? ` @${eventItem.location}` : ""}${eventItem.note ? `：${eventItem.note}` : ""}`);
  return lines.length ? lines.join("\n") : "暂无";
}

function formatAutoScheduleForPrompt(plan) {
  const blockLines = plan.blocks.map((block) => `- ${formatClockMinutes(block.start)}-${formatClockMinutes(block.end)} ${block.title}${block.locked ? "（固定/锁定）" : ""}${block.note ? `：${block.note}` : ""}`);
  const gapLines = plan.freeIntervals.length
    ? plan.freeIntervals.map((gap) => `- ${formatClockMinutes(gap.start)}-${formatClockMinutes(gap.end)} ${minutesLabel(gap.end - gap.start)}`)
    : ["- 暂无明显空档"];
  const unplacedLines = plan.unplacedSegments.length
    ? plan.unplacedSegments.map((item) => `- ${item.segmentTitle} ${item.duration}min`)
    : ["- 无"];
  return `【排程模式】精确时间线草案。固定/锁定块不得移动；未锁定学习块可在不破坏固定事件的前提下微调。
【时间线】${formatClockMinutes(plan.timelineStart)}-${formatClockMinutes(plan.timelineEnd)}
【指标】
- 总可支配时间：${minutesLabel(plan.metrics.totalSpan)}
- 固定占用：${minutesLabel(plan.metrics.fixedMinutes)}
- 真实学习分钟（不含休息）：${minutesLabel(plan.metrics.studyMinutes)}
- 非学习任务执行分钟：${minutesLabel(plan.metrics.nonStudyMinutes)}
- 块后休息：${minutesLabel(plan.metrics.breakMinutes)}
- 剩余空档：${minutesLabel(plan.metrics.freeMinutes)}
- 最大连续空档：${minutesLabel(plan.metrics.maxFreeMinutes)}
- 负载状态：${plan.loadStatus}

【已排时间线】
${blockLines.join("\n")}

【真实空档】
${gapLines.join("\n")}

【未排入任务】
${unplacedLines.join("\n")}`;
}

function buildSchedulePrompt({ draft, autoContext, mathTemplate, englishTemplate, englishSkills, effectiveMorningPrepMinutes, scheduleEstimate, autoSchedule, showerPlan, maskPlan }) {
  const englishPlanText = englishSkills.map((skill) => `${englishSkillText[skill]} ${englishTemplate.skillMinutes}min`).join(" + ");
  const exerciseAdvice = autoContext.previousDayExercised
    ? "昨日已运动，明天可按恢复/拉伸或轻运动安排。"
    : "昨日未运动或未记录，明天优先考虑正式运动，但不要运动后立刻接高难数学或高压论文。";
  const restBlockText = `${draft.formalRestBlocks || 1}块 × ${draft.formalRestMinutes || 0}min`;

  return `请根据以下信息帮我排明天日程。

## 1. 基本信息

【日期】${draft.targetDate}
【计划起床】${draft.wakeUpTime}
【目标上床】${draft.targetBedTime}
【明天场景】${labelFromOptions(scheduleSceneOptions, draft.scene)}
【固定事件】
${fixedEventsText(draft.fixedEvents)}
【是否通勤】${labelFromOptions([["no", "否"], ["yes", "是"], ["uncertain", "不确定"]], draft.commuteStatus)}
【在校早晨准备时间】${effectiveMorningPrepMinutes}min
说明：如果在校且不通勤，起床后需要预留洗漱20min + 到教室10min + 缓冲10min，不能从起床时间直接安排学习。
【补充说明】${draft.specialNotes || "暂无"}

## 2. 系统读取结果

【复盘来源日期】${autoContext.sourceReviewDate || "暂无，按普通学习日处理"}
【今日类型】${autoContext.dayTypeDisplayName}
【固定自由娱乐额度】${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min
【今日类型判断原因】${autoContext.dayTypeReason}
【昨日是否运动】${autoContext.previousDayExercised ? `是，${autoContext.previousDayExerciseMinutes}min` : "否 / 未记录"}
【昨日睡眠】${autoContext.sleepSummary}
【今日最大卡点】${autoContext.biggestBlocker || "未填写"}
【明日最重要调整】${autoContext.tomorrowAdjustment || "未填写"}

## 2.5 明日预估容量

【预计纯学习时长】${minutesLabel(scheduleEstimate.studyMinutes)}
【运动/恢复】${minutesLabel(scheduleEstimate.exerciseMinutes)}
【正式休息娱乐】${minutesLabel(scheduleEstimate.formalRestMinutes)}
【周日总复盘】${scheduleEstimate.weeklyReviewMinutes > 0 ? "需要安排 30min 周总复盘" : "非周日，不额外安排"}
【面膜/基础护肤】${maskPlan.shouldSchedule ? `建议安排 20min，优先 ${maskPlan.suggestedTime}` : maskPlan.reason}
【生活/收束/准备】${minutesLabel(scheduleEstimate.lifeMinutes)}
【全天已占用】${minutesLabel(scheduleEstimate.totalOccupiedMinutes)}
【容量判断】${scheduleEstimate.warning}

## 2.6 系统自动排程草案

${autoSchedule ? formatAutoScheduleForPrompt(autoSchedule) : "尚未生成自动时间线。"}

## 3. 数学安排

【数学比例模板】${mathTemplate.name}
【数学比例】${mathTemplateText(mathTemplate)}

【数学参考信息】
昨日数学进度：${autoContext.mathProgressText || "未填写"}
昨日数学需要调整：${autoContext.mathBlockers || "未填写"}

说明：网页只提供数学比例和参考调整，不自动决定具体章节。请小椰根据比例、复盘里的需要调整和 Claire 当前要求安排数学时间块。

## 4. 英语 / 雅思安排

【英语模板】${englishTemplate.name}
【固定板块】单词 ${englishTemplate.wordMinutes}min
【今日专项】${englishPlanText}
【推荐说明】${englishTemplate.skillMode === "manual" ? "今天按 Claire 手动选择的项目执行。" : "今天按最近较少练习的项目推荐，尽量在写作/口语/阅读/听力之间雨露均沾。"}
【英语参考信息】${autoContext.englishText || "未填写"}${autoContext.ieltsAdjustment ? `；调整：${autoContext.ieltsAdjustment}` : ""}

## 5. 论文/作业

【计划时长】${draft.thesisMinutes}min
【昨日产出】${autoContext.thesisOutputText || "未填写"}
【需要调整/下一步】${draft.thesisNote || autoContext.thesisAdjustmentText || autoContext.tomorrowAdjustment || "请根据复盘里的需要调整安排可见产出"}

说明：网页不自动推荐具体论文任务，只把产出和需要调整带给小椰。

## 6. 经济/专业课

【计划时长】${draft.professionalMinutes}min
【昨日推进】${autoContext.econProgressText || "未填写"}
【需要调整/备注】${draft.professionalNote || autoContext.econBlockers || "暂无"}

说明：网页不自动推荐具体经济/专业课任务，只把进度和需要调整带给小椰。

## 7. 运动、休息、系统边界

【运动安排】${draft.exerciseType || "未填写"}，${draft.exerciseMinutes || 0}min。${exerciseAdvice}
【正式休息娱乐时段】${restBlockText}。只需要在日程里腾出正式休息娱乐块，不必替 Claire 决定具体娱乐形式。
【低风险休息候选】${autoContext.recentReadingTitle ? `阅读：《${autoContext.recentReadingTitle}》` : "暂无最近在读书籍"}
【洗澡安排】${showerPlan.shouldShower ? `安排洗澡，原因：${showerPlan.reason}` : `不默认安排洗澡，原因：${showerPlan.reason}`}。不要天天安排洗澡；默认隔一天一次，运动日必须安排。
【面膜安排】${maskPlan.shouldSchedule ? `安排「敷面膜 + 基础护肤」20min，分类为生活维护 / 身体维护。优先放在 ${maskPlan.suggestedTime}，或晚间洗澡后、晚间复盘前后、目标上床前30-60分钟。不要放在学习黄金时段，也不要挤占已经安排好的学习块；如果晚间已排满，放到明日提醒区作为可选任务。` : `不强排面膜：${maskPlan.reason}`}
【固定自由娱乐额度】${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min。说明：每天固定90min，不随前一天日型变化。超过90min后按超时区间在每日结算里扣分；未用满90min时按区间加0-2分。
【系统开发上限】${labelFromOptions(systemDevelopmentLimitOptions, draft.systemDevelopmentLimit)}

## 8. 排程要求

- 请输出：日程主体 / 预估时长 / 今日执行重点。
- 学习类任务必须标注节奏，如（50）（90）（50×2）（30）。
- 默认学习节奏是 50min 学习 + 10min 休息。
- 如果两个单独的学习块连续出现，中间必须显式安排 10min「休息｜...」或「切换｜...」。
- 如果使用「50×2」这种合并写法，时间长度必须包含中间 10min 短休，例如 50+10+50=110min。
- 90min 论文/作业块结束后，必须安排 10min 休息或过渡，除非后面直接进入午饭/晚饭/洗澡。
- 会议、红会、通勤、社交接待后，进入学习前必须安排 10-20min 缓冲。
- 数学请按“网课/习题/复习/错题/总结”的比例安排，不要让网页决定具体章节。
- 英语按所选模板安排：单词固定 + ${englishSkills.length} 个专项。
- 如果场景是在校且不通勤，早晨起床后必须先安排 ${effectiveMorningPrepMinutes}min「起床｜洗漱 + 到教室 + 缓冲」，不能起床后立刻安排学习。
- 午间必须安排「午间｜午饭 + 补剂 + 午休」${draft.lunchBlockMinutes}min。
- 午间启动缓冲 ${draft.startupBufferMinutes}min 要单独安排，不计入午间。
- 洗澡不要天天安排，默认隔一天一次；如果当天安排运动，则必须安排洗澡。
- 如果安排洗澡，洗澡和睡前洗漱必须分开。
- 如果系统提示明日应敷面膜，请安排 20min「生活维护｜敷面膜 + 基础护肤」，优先晚间洗澡后/复盘前后/上床前30-60分钟；不要安排在学习黄金时段。
- 每天必须安排正式休息娱乐块：${restBlockText}，标题可写「休息娱乐」。
- 不要用“缓冲”代替正式休息娱乐。
- 阅读可以作为低风险休息候选；但只有 Claire 在复盘里写进「📚阅读」的时长，才计入学习阅读。
- 如果目标日期是周日，必须额外安排 30min「周总复盘」，不要挤占每日复盘收束。
- 日程输出和 Google Calendar 写入优先使用同类合并模式。
- 同一科目、同一动作连续出现时，不要拆成多个 50min 事件，合并为完整块。
- 合并块标题必须标清内部节奏，例如「数学｜网课推进（3×50）」「数学｜习题补账（2×50）」「英语/雅思｜听力 + 口语（40+40）」。
- 使用 2×50 / 3×50 时，默认内部包含标准短休，不再拆成多个 50min 事件。
- 不同科目或不同任务类型之间切换时，仍然要安排显式 10min 休息或切换。
- 20:40后不新开高难任务。
- 21:40-22:00左右进入复盘和收束。
- 22:00后不安排新学习任务、复杂系统、游戏/小说/长视频。
- 如果时间不够，优先保护数学、论文/作业、英语、睡眠；压缩系统开发和普通娱乐。
- 不要输出奖励库存预估。`;
}

function Mall({ data, onRedeem, onSaveProduct, onDeleteProduct, onReorderProducts, onSaveCategory, onDeleteCategory, onSaveDevelopmentPlan, onDeleteDevelopmentPlan, onCompleteDevelopmentPlan }) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [filter, setFilter] = useState("all");
  const [managerOpen, setManagerOpen] = useState(false);
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(blankCategory);
  const [draggingProductId, setDraggingProductId] = useState("");
  const categories = data.categories;
  const decorationCategory = categories.find((category) => category.id === "decoration" || category.name === "装修");
  const isDecorationShelf = decorationCategory && selectedCategory === decorationCategory.id;
  const products = sortProductsForShelf(data.products.filter((product) => {
    if (decorationCategory && product.categoryId === decorationCategory.id) return false;
    const inCategory = selectedCategory === "all" || product.categoryId === selectedCategory;
    const statusOk = filter === "all" || (filter === "affordable" ? (data.profile.points || 0) >= product.price : product.status === filter);
    return inCategory && statusOk && product.status !== "paused";
  }));

  function saveProductOrder(nextProducts) {
    onReorderProducts(nextProducts.map((product, index) => ({ ...product, sortOrder: (index + 1) * 10 })));
  }

  function moveProduct(productId, direction) {
    const index = products.findIndex((product) => product.id === productId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= products.length) return;
    const nextProducts = [...products];
    const [product] = nextProducts.splice(index, 1);
    nextProducts.splice(targetIndex, 0, product);
    saveProductOrder(nextProducts);
  }

  function dropProduct(targetId) {
    if (!draggingProductId || draggingProductId === targetId) return;
    const nextProducts = [...products];
    const fromIndex = nextProducts.findIndex((product) => product.id === draggingProductId);
    const toIndex = nextProducts.findIndex((product) => product.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [product] = nextProducts.splice(fromIndex, 1);
    nextProducts.splice(toIndex, 0, product);
    saveProductOrder(nextProducts);
    setDraggingProductId("");
  }

  function submitCategory(event) {
    event.preventDefault();
    onSaveCategory(categoryForm);
    setCategoryForm(blankCategory);
    setCategoryFormOpen(false);
  }

  return (
    <section className="content-stack">
      {!isDecorationShelf && (
        <div className="panel mall-tool-panel">
          <div>
            <strong>商品货架</strong>
            <span>拖动商品卡可以调整顺序；手机上用上移/下移。</span>
          </div>
          <button className="primary-button" type="button" onClick={() => setManagerOpen((value) => !value)}>
            <PackagePlus size={18} /> {managerOpen ? "收起上架" : "上架商品"}
          </button>
        </div>
      )}
      <div className="filter-bar">
        <button className={selectedCategory === "all" ? "chip active" : "chip"} onClick={() => setSelectedCategory("all")}>全部货架</button>
        {categories.map((category) => (
          <button className={selectedCategory === category.id ? "chip active" : "chip"} key={category.id} onClick={() => setSelectedCategory(category.id)}>
            <span className="swatch" style={{ background: category.color }} /> {category.icon} {category.name}
          </button>
        ))}
        <button className="chip" type="button" onClick={() => setCategoryFormOpen((value) => !value)}>
          <Plus size={15} /> 新增分类
        </button>
      </div>
      {categoryFormOpen && (
        <form className="inline-category-form panel" onSubmit={submitCategory}>
          <TextField label="分类名称" value={categoryForm.name} onChange={(value) => setCategoryForm({ ...categoryForm, name: value })} required />
          <TextField label="图标" value={categoryForm.icon} onChange={(value) => setCategoryForm({ ...categoryForm, icon: value })} />
          <label className="field"><span>颜色</span><input type="color" value={categoryForm.color} onChange={(event) => setCategoryForm({ ...categoryForm, color: event.target.value })} /></label>
          <TextField label="备注" value={categoryForm.description} onChange={(value) => setCategoryForm({ ...categoryForm, description: value })} />
          <button className="primary-button" type="submit"><Save size={17} />保存分类</button>
        </form>
      )}
      <div className="filter-bar">
        {[
          ["all", "全部"],
          ["affordable", "可兑换"],
          ["wishlist", "愿望单"],
          ["available", "可用"],
          ["redeemed", "已兑换"],
        ].map(([id, label]) => (
          <button key={id} className={filter === id ? "chip active" : "chip"} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      {!isDecorationShelf && (
        <>
          {managerOpen && (
            <InlineProductManager data={data} onSave={onSaveProduct} onDelete={onDeleteProduct} onClose={() => setManagerOpen(false)} />
          )}
          <div className="product-grid">
            {products.map((product, index) => (
              <div
                className="draggable-product"
                draggable
                key={product.id}
                onDragStart={() => setDraggingProductId(product.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropProduct(product.id)}
                onDragEnd={() => setDraggingProductId("")}
              >
                <ProductCard
                  product={product}
                  category={categories.find((item) => item.id === product.categoryId)}
                  points={data.profile.points || 0}
                  onRedeem={onRedeem}
                  onMoveUp={() => moveProduct(product.id, -1)}
                  onMoveDown={() => moveProduct(product.id, 1)}
                  canMoveUp={index > 0}
                  canMoveDown={index < products.length - 1}
                />
              </div>
            ))}
          </div>
          {products.length === 0 && <p className="empty-text">这个货架暂时空着。点“上架商品”添加新的阶段性战利品。</p>}
        </>
      )}

      {isDecorationShelf && (
        <DevelopmentPlanPanel
          plans={data.developmentPlans || []}
          points={data.profile.points || 0}
          onSave={onSaveDevelopmentPlan}
          onDelete={onDeleteDevelopmentPlan}
          onComplete={onCompleteDevelopmentPlan}
        />
      )}
    </section>
  );
}

function sortProductsForShelf(products = []) {
  return [...products].sort((a, b) => {
    const orderA = Number(a.sortOrder || 0);
    const orderB = Number(b.sortOrder || 0);
    if (orderA || orderB) return orderA - orderB;
    return Number(a.price || 0) - Number(b.price || 0);
  });
}

function InlineProductManager({ data, onSave, onDelete, onClose }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...blankProduct, categoryId: data.categories[0]?.id || "" });
  const products = sortProductsForShelf(data.products.filter((product) => product.status !== "redeemed"));

  function edit(product) {
    setEditing(product.id);
    setForm({ ...blankProduct, ...product });
  }

  function reset() {
    setEditing(null);
    setForm({ ...blankProduct, categoryId: data.categories[0]?.id || "" });
  }

  function submit(event) {
    event.preventDefault();
    const nextSortOrder = editing ? Number(form.sortOrder || 0) : Math.max(0, ...data.products.map((product) => Number(product.sortOrder || 0))) + 10;
    onSave({ ...form, id: editing, sortOrder: nextSortOrder });
    reset();
  }

  return (
    <div className="inline-manager panel">
      <div className="panel-title">
        <h2>{editing ? "编辑商品" : "上架商品"}</h2>
        <button className="secondary-button compact" type="button" onClick={onClose}>收起</button>
      </div>
      <form className="inline-product-form" onSubmit={submit}>
        <TextField label="商品名称" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
        <label className="field">
          <span>分类</span>
          <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
            <option value="">未分类</option>
            {data.categories.map((category) => <option value={category.id} key={category.id}>{category.icon} {category.name}</option>)}
          </select>
        </label>
        <NumberField label="积分价格" value={form.price} onChange={(value) => setForm({ ...form, price: value })} />
        <TextField label="图标" value={form.icon} onChange={(value) => setForm({ ...form, icon: value })} />
        <SelectField label="稀有度" value={form.rarity} onChange={(value) => setForm({ ...form, rarity: value })} options={[["common", "普通"], ["rare", "稀有"], ["epic", "史诗"], ["legendary", "传说"]]} />
        <SelectField label="优先级" value={form.priority} onChange={(value) => setForm({ ...form, priority: value })} options={[["low", "低"], ["medium", "中"], ["high", "高"]]} />
        <SelectField label="状态" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={[["available", "可用"], ["wishlist", "愿望单"], ["paused", "暂缓"], ["redeemed", "已兑换"]]} />
        <TextField label="描述" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
        <label className="field"><span>限时截止日期</span><input type="date" value={form.limitedUntil || ""} onChange={(event) => setForm({ ...form, limitedUntil: event.target.value })} /></label>
        <label className="field inline-product-note">
          <span>备注</span>
          <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
        <label className="check-row inline"><input type="checkbox" checked={form.repeatable !== false} onChange={(event) => setForm({ ...form, repeatable: event.target.checked })} />可重复兑换</label>
        <div className="button-row">
          <button className="primary-button" type="submit"><Save size={18} />{editing ? "保存商品" : "上架"}</button>
          <button className="secondary-button" type="button" onClick={reset}>清空</button>
        </div>
      </form>
      <div className="inline-product-list">
        {products.map((product) => (
          <div className="list-row" key={product.id}>
            <div><strong>{product.name}</strong><span>{product.price} 分 · {statusText(product.status)}</span></div>
            <div className="row-actions">
              <button className="icon-button" type="button" onClick={() => edit(product)} aria-label="编辑商品"><Edit3 size={17} /></button>
              <button className="icon-button danger" type="button" onClick={() => onDelete(product.id)} aria-label="删除商品"><Trash2 size={17} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevelopmentPlanPanel({ plans, points, onSave, onDelete, onComplete }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankDevelopmentPlan);
  const activePlans = plans.filter((plan) => plan.kind !== "bug" && plan.status !== "done");
  const logs = plans.filter((plan) => plan.kind !== "bug" && plan.status === "done");
  const activeBugs = plans.filter((plan) => plan.kind === "bug" && plan.status !== "done");
  const bugLogs = plans.filter((plan) => plan.kind === "bug" && plan.status === "done");
  const todayDevelopmentDone = hasCompletedDevelopmentToday(plans);

  function edit(plan) {
    setEditing(plan.id);
    setForm({ ...blankDevelopmentPlan, ...plan, estimatedMinutes: plan.estimatedMinutes || legacyDevelopmentMinutes(plan) });
  }

  function reset() {
    setEditing(null);
    setForm(blankDevelopmentPlan);
  }

  function submit(event) {
    event.preventDefault();
    onSave({ ...form, estimatedMinutes: Math.max(1, Number(form.estimatedMinutes || 15)), id: editing });
    reset();
  }

  return (
    <section className="development-panel panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Build Diary</p>
          <h2>装修开发愿望</h2>
        </div>
        <PackagePlus size={20} />
      </div>
      <p className="record-hint">
        把想做的功能先放进清单。完成后免费沉淀成开发日志。每天最多完成 1 条开发愿望。
        {todayDevelopmentDone && " 今天的开发额度已用完，剩下的明天再开工。"}
      </p>

      <form className="development-form" onSubmit={submit}>
        <TextField label="开发愿望" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
        <SelectField label="类别" value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={[["feature", "功能"], ["theme", "外观"], ["data", "统计"], ["polish", "体验优化"]]} />
        <NumberField label="预计耗时分钟" value={form.estimatedMinutes} onChange={(value) => setForm({ ...form, estimatedMinutes: value })} />
        <SelectField label="优先级" value={form.priority} onChange={(value) => setForm({ ...form, priority: value })} options={[["low", "低"], ["medium", "中"], ["high", "高"]]} />
        <label className="field development-note">
          <span>备注</span>
          <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="想做什么、为什么想做、完成后会变成哪条开发日志。" />
        </label>
        <div className="button-row">
          <button className="primary-button" type="submit"><Save size={18} />{editing ? "保存愿望" : "加入清单"}</button>
          <button className="secondary-button" type="button" onClick={reset}>清空</button>
        </div>
      </form>

      <BugFixPanel onSave={onSave} />

      <div className="development-section-title">
        <h3>开发愿望清单</h3>
        <span>完成不扣积分</span>
      </div>
      <div className="development-list">
        {activePlans.map((plan) => {
          const canComplete = !todayDevelopmentDone;
          return (
          <article className="development-card" key={plan.id}>
            <div>
              <strong>{plan.title}</strong>
              <span>{developmentTypeText(plan.type)} · 约 {legacyDevelopmentMinutes(plan)}min · 免费 · {priorityText(plan.priority)}</span>
              {plan.note && <p>{plan.note}</p>}
            </div>
            <div className="row-actions">
              <button className="icon-button" type="button" onClick={() => edit(plan)} aria-label="编辑开发计划"><Edit3 size={17} /></button>
              <button className={canComplete ? "secondary-button compact" : "disabled-button compact"} type="button" disabled={!canComplete} onClick={() => onComplete(plan)}>
                {todayDevelopmentDone ? "今日已开发" : "完成"}
              </button>
              <button className="icon-button danger" type="button" onClick={() => onDelete(plan.id)} aria-label="删除开发计划"><Trash2 size={17} /></button>
            </div>
          </article>
          );
        })}
        {activePlans.length === 0 && <p className="empty-text">这里还没有开发愿望。先写下来，然后让积分决定什么时候开工。</p>}
      </div>

      <div className="development-section-title">
        <h3>待修 Bug 清单</h3>
        <span>免费记录</span>
      </div>
      <div className="development-list">
        {activeBugs.map((bug) => (
            <article className="development-card bug" key={bug.id}>
              <div>
                <strong>{bug.title}</strong>
                <span>修 bug · 免费</span>
                {bug.note && <p>{bug.note}</p>}
              </div>
              <div className="row-actions">
                <button className="secondary-button compact" type="button" onClick={() => onComplete(bug)}>
                  修好
                </button>
                <button className="icon-button danger" type="button" onClick={() => onDelete(bug.id)} aria-label="删除待修 bug"><Trash2 size={17} /></button>
              </div>
            </article>
        ))}
        {activeBugs.length === 0 && <p className="empty-text">暂时没有待修 bug。发现小问题就先丢进这里。</p>}
      </div>

      <div className="development-log-grid">
        <div>
          <div className="development-section-title">
            <h3>开发日志</h3>
            <span>{logs.length} 条</span>
          </div>
          <div className="development-list">
            {logs.map((plan) => (
              <article className="development-card done" key={plan.id}>
                <div>
                  <strong>{plan.title}</strong>
                  <span>{formatDateTime(plan.completedAt || plan.updatedAt)} · {developmentTypeText(plan.type)} · 约 {legacyDevelopmentMinutes(plan)}min · 免费完成</span>
                  {plan.note && <p>{plan.note}</p>}
                </div>
                <div className="row-actions">
                  <button className="icon-button danger" type="button" onClick={() => onDelete(plan.id)} aria-label="删除开发日志"><Trash2 size={17} /></button>
                </div>
              </article>
            ))}
            {logs.length === 0 && <p className="empty-text">完成一个开发愿望后，这里会自动记录什么时候做了什么。</p>}
          </div>
        </div>

        <div>
          <div className="development-section-title">
            <h3>Bug 日志</h3>
            <span>{bugLogs.length} 条</span>
          </div>
          <div className="development-list">
            {bugLogs.map((bug) => (
              <article className="development-card bug done" key={bug.id}>
                <div>
                  <strong>{bug.title}</strong>
                  <span>{formatDateTime(bug.completedAt || bug.updatedAt)} · 修 bug · 免费完成</span>
                  {bug.note && <p>{bug.note}</p>}
                </div>
                <div className="row-actions">
                  <button className="icon-button danger" type="button" onClick={() => onDelete(bug.id)} aria-label="删除 bug 日志"><Trash2 size={17} /></button>
                </div>
              </article>
            ))}
            {bugLogs.length === 0 && <p className="empty-text">修过的 bug 会记录在这里。</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function BugFixPanel({ onSave }) {
  const [form, setForm] = useState({ title: "", note: "" });
  const canSubmit = form.title.trim();

  function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onSave({
      ...form,
      kind: "bug",
      type: "polish",
      estimatedMinutes: 15,
      priority: "medium",
      status: "idea",
    });
    setForm({ title: "", note: "" });
  }

  return (
    <form className="bug-fix-panel" onSubmit={submit}>
      <div>
        <strong>记录 Bug</strong>
        <span>先进入待修清单，修好后免费进入 Bug 日志。</span>
      </div>
      <TextField label="Bug 内容" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
      <label className="field">
        <span>备注</span>
        <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="哪里坏了，怎么修的。" />
      </label>
      <button className={canSubmit ? "primary-button" : "disabled-button"} type="submit" disabled={!canSubmit}>
        <Save size={18} /> 加入待修
      </button>
    </form>
  );
}

function ProductCard({ product, category, points, onRedeem, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const affordable = points >= product.price;
  const progress = Math.min(100, product.price > 0 ? (points / product.price) * 100 : 100);
  const missing = Math.max(0, product.price - points);
  const estimate = estimateDaysToProduct({ ...intensityPresets[1], currentBankPoints: points, productCost: product.price });
  const daysLeft = calculateDaysLeft(product.limitedUntil);

  return (
    <article className="product-card" style={{ "--accent": category?.color || "#8B5CF6" }}>
      <div className="card-topline">
        <span className="category-pill">{category?.icon || "🎁"} {category?.name || "未分类"}</span>
        <span className={`rarity rarity-${product.rarity || "common"}`}>{rarityText(product.rarity)}</span>
      </div>
      <div className="sort-actions">
        <button className="text-button" type="button" disabled={!canMoveUp} onClick={onMoveUp}>上移</button>
        <button className="text-button" type="button" disabled={!canMoveDown} onClick={onMoveDown}>下移</button>
      </div>
      <h3>{product.icon ? `${product.icon} ` : ""}{product.name}</h3>
      <p>{product.description || "这是一件等待命名意义的奖励。"}</p>
      <div className="price-row">
        <span><Coins size={18} /> {product.price} 分</span>
        <small>{priorityText(product.priority)} · {statusText(product.status)}</small>
      </div>
      <div className="progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="unlock-line">
        {affordable ? "可以解锁啦。" : `还差 ${missing} 分，按稳定推进日约 ${displayDays(estimate.daysNeeded)}。`}
        {daysLeft !== null && <span> 限时剩余 {Math.max(0, daysLeft)} 天。</span>}
      </div>
      {product.note && <div className="note-line">{product.note}</div>}
      <button className={affordable && product.status !== "redeemed" ? "primary-button full" : "disabled-button full"} disabled={!affordable || product.status === "redeemed"} onClick={() => onRedeem(product)}>
        <Gift size={18} />
        {product.status === "redeemed" ? "已兑换" : affordable ? "兑换奖励" : "继续攒分"}
      </button>
    </article>
  );
}

function Estimator({ data, onSaveDashboardTarget }) {
  const activeProducts = data.products.filter((product) => product.status !== "paused" && product.status !== "redeemed");
  const [selectedIds, setSelectedIds] = useState(activeProducts.slice(0, 1).map((item) => item.id));
  const [customPlan, setCustomPlan] = useState({
    name: "我的自定义方案",
    studyMinutes: 450,
    sleepAdjustment: 0.5,
    plannedTomorrowGameMinutes: 30,
    beneficialMinutes: 30,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
  });
  const [form, setForm] = useState({
    studyMinutes: 450,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 0.5,
    plannedTomorrowGameMinutes: 30,
    expectedGameOverrun: 0,
    beneficialMinutes: 30,
    deadline: "",
  });
  const selectedProducts = activeProducts.filter((product) => selectedIds.includes(product.id));
  const estimateInput = {
    ...form,
    currentBankPoints: data.profile.points || 0,
    actualGameMinutesToday: form.expectedGameOverrun,
    allocatedGameMinutesForToday: 0,
  };
  const cartEstimate = estimateDaysToCart({ ...estimateInput, products: selectedProducts });
  const daysLeft = calculateDaysLeft(form.deadline);
  const requiredDailyPoints = daysLeft && daysLeft > 0 ? Math.ceil(cartEstimate.pointsNeeded / daysLeft) : null;
  const presetRows = intensityPresets.map((preset) => ({
    ...preset,
    estimate: estimateDaysToProduct({
      ...preset,
      currentBankPoints: data.profile.points || 0,
      productCost: cartEstimate.targetCost,
    }),
  }));
  const customEstimate = estimateDaysToProduct({
    ...customPlan,
    currentBankPoints: data.profile.points || 0,
    productCost: cartEstimate.targetCost,
    actualGameMinutesToday: 0,
    allocatedGameMinutesForToday: 0,
  });

  function toggleProduct(productId) {
    setSelectedIds((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]);
  }

  function updateCustomPlan(field, value) {
    setCustomPlan((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="estimator-layout">
      <div className="panel form-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Target Simulator</p>
            <h2>目标估算器</h2>
          </div>
          <Target size={21} />
        </div>
        <div className="check-list">
          {activeProducts.map((product) => (
            <label className="check-row" key={product.id}>
              <input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggleProduct(product.id)} />
              <span>{product.name}</span>
              <strong>{product.price} 分</strong>
            </label>
          ))}
        </div>
        <div className="button-row">
          <button className={selectedIds.length ? "primary-button" : "disabled-button"} type="button" disabled={!selectedIds.length} onClick={() => onSaveDashboardTarget(selectedIds)}>
            <Target size={18} /> 设为首页目标
          </button>
        </div>
        <NumberField label="每日学习分钟" value={form.studyMinutes} onChange={(value) => setForm({ ...form, studyMinutes: value })} />
        <NumberField label="固定自由娱乐额度" value={form.plannedTomorrowGameMinutes} onChange={(value) => setForm({ ...form, plannedTomorrowGameMinutes: value })} />
        <NumberField label="预计娱乐总池分钟" value={form.beneficialMinutes} onChange={(value) => setForm({ ...form, beneficialMinutes: value })} />
        <label className="field">
          <span>睡眠积分</span>
          <select value={form.sleepAdjustment} onChange={(event) => setForm({ ...form, sleepAdjustment: toNumber(event.target.value) })}>
            {sleepAdjustmentOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>截止日期（可选）</span>
          <input type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
        </label>
      </div>

      <div className="content-stack">
        <div className="summary-card big">
          <span>当前购物篮</span>
          <strong>{cartEstimate.targetCost} 分</strong>
          <p>
            现在有 {data.profile.points || 0} 分，还差 {cartEstimate.pointsNeeded} 分。按当前方案每天约 {cartEstimate.expectedDailyBankPoints} 分，预计 {displayDays(cartEstimate.daysNeeded)} 解锁。
          </p>
        </div>
        {daysLeft !== null && (
          <div className="panel advice-panel">
            <strong>{cartEstimate.daysNeeded <= daysLeft ? "来得及。" : "偏紧，需要调整一点边界。"}</strong>
            <p>
              距离截止还有 {Math.max(0, daysLeft)} 天，需要平均每天 {requiredDailyPoints || 0} 分；当前方案约 {cartEstimate.expectedDailyBankPoints} 分/天。
            </p>
          </div>
        )}
        <div className="panel">
          <div className="panel-title">
            <h2>强度方案对比</h2>
            <Sparkles size={20} />
          </div>
          <div className="compare-table">
            {presetRows.map((row) => (
              <div className="compare-row" key={row.id}>
                <strong>{row.name}</strong>
                <span>{row.description}</span>
                <span>{row.studyMinutes / 60}h 学习 · 自由娱乐额度 {row.plannedTomorrowGameMinutes}min · {sleepLabel(row.sleepAdjustment)}</span>
                <b>{row.estimate.expectedDailyBankPoints} 分/天 · {displayDays(row.estimate.daysNeeded)}</b>
              </div>
            ))}
            <div className="compare-row custom-plan">
              <div className="compare-row-head">
                <input value={customPlan.name} onChange={(event) => updateCustomPlan("name", event.target.value)} aria-label="自定义方案名称" />
                <span className="custom-badge">自由调整</span>
              </div>
              <div className="compare-edit-grid">
                <label>
                  <span>学习 min</span>
                  <input type="number" value={customPlan.studyMinutes} onChange={(event) => updateCustomPlan("studyMinutes", toNumber(event.target.value))} />
                </label>
                <label>
                  <span>自由娱乐 min</span>
                  <input type="number" value={customPlan.plannedTomorrowGameMinutes} onChange={(event) => updateCustomPlan("plannedTomorrowGameMinutes", toNumber(event.target.value))} />
                </label>
                <label>
                  <span>入睡时间</span>
                  <select value={customPlan.sleepAdjustment} onChange={(event) => updateCustomPlan("sleepAdjustment", toNumber(event.target.value))}>
                    {sleepAdjustmentOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>娱乐总池 min</span>
                  <input type="number" value={customPlan.beneficialMinutes} onChange={(event) => updateCustomPlan("beneficialMinutes", toNumber(event.target.value))} />
                </label>
              </div>
              <b>{customEstimate.expectedDailyBankPoints} 分/天 · {displayDays(customEstimate.daysNeeded)}</b>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MathProgressPage({ records, onSave }) {
  const [activeTrack, setActiveTrack] = useState("advanced");
  const [showCompleted, setShowCompleted] = useState(false);
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [useManualDate, setUseManualDate] = useState(true);
  const [catCelebrate, setCatCelebrate] = useState("");
  const progressMap = getProgressMap(records);
  const sections = mathCurriculum.filter((sectionItem) => sectionItem.trackId === activeTrack);
  const trackItems = sections.flatMap((sectionItem) => sectionItem.items);
  const doneCount = trackItems.filter((chapterItem) => isItemFullyComplete(progressMap[chapterItem.id])).length;

  function saveItem(sectionItem, chapterItem, patch) {
    const beforeComplete = isSectionComplete(sectionItem, progressMap);
    const previous = progressMap[chapterItem.id] || {};
    const nextRecord = {
      ...previous,
      ...patch,
    };
    nextRecord.completed = Boolean(nextRecord.courseCompleted && nextRecord.exerciseCompleted);
    nextRecord.completedDate = nextRecord.completed ? nextRecord.completedDate || "" : "";
    onSave({
      itemId: chapterItem.id,
      trackId: sectionItem.trackId,
      trackName: sectionItem.trackName,
      sectionId: sectionItem.id,
      sectionTitle: sectionItem.title,
      code: chapterItem.code,
      title: chapterItem.title,
      completed: nextRecord.completed,
      completedDate: nextRecord.completedDate,
      courseCompleted: Boolean(nextRecord.courseCompleted),
      courseDate: nextRecord.courseDate || "",
      exerciseCompleted: Boolean(nextRecord.exerciseCompleted),
      exerciseDate: nextRecord.exerciseDate || "",
      source: "manual",
    });
    const afterMap = { ...progressMap, [chapterItem.id]: nextRecord };
    const afterComplete = sectionItem.items.every((itemInSection) => isItemFullyComplete(afterMap[itemInSection.id]));
    if (!beforeComplete && afterComplete) {
      setCatCelebrate(`${sectionItem.title} 完成啦！`);
      window.setTimeout(() => setCatCelebrate(""), 3600);
    }
  }

  return (
    <section className="content-stack">
      <div className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Math Progress</p>
            <h2>数学进度追踪</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => setShowCompleted((value) => !value)}>
            {showCompleted ? "隐藏已完成章节" : "显示已完成章节"}
          </button>
        </div>
        <div className="filter-bar">
          {mathTracks.map((track) => (
            <button key={track.id} className={activeTrack === track.id ? "chip active" : "chip"} onClick={() => setActiveTrack(track.id)}>
              {track.name}
            </button>
          ))}
        </div>
        <div className="progress-overview">
          <strong>{doneCount} / {trackItems.length}</strong>
          <div className="progress cat-progress"><i style={{ width: `${trackItems.length ? (doneCount / trackItems.length) * 100 : 0}%` }} /></div>
          <label>
            日期快捷值
            <input type="date" value={manualDate} disabled={!useManualDate} onChange={(event) => setManualDate(event.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={useManualDate} onChange={(event) => setUseManualDate(event.target.checked)} />
            填日期时使用快捷值
          </label>
        </div>
      </div>

      {catCelebrate && (
        <div className="cat-celebration">
          <img className="cat-face-img" src="/yeye/yeye-jump-clean.png" alt="" />
          <strong>{catCelebrate}</strong>
          <span>小椰跳起来了，这是一块真正的进度砖。</span>
        </div>
      )}

      <div className="math-section-list">
        {sections.map((sectionItem) => {
          const completed = isSectionComplete(sectionItem, progressMap);
          if (completed && !showCompleted) {
            return (
              <details className="math-section collapsed" key={sectionItem.id}>
                <summary>{sectionItem.title} · 已完成</summary>
              </details>
            );
          }

          return (
            <details className="math-section" key={sectionItem.id} open={!completed}>
              <summary>{sectionItem.title}{completed ? " · 已完成" : ""}</summary>
              <div className="math-item-list">
                {sectionItem.items.map((chapterItem) => {
                  const record = progressMap[chapterItem.id];
                  return (
                    <div className="math-item" key={chapterItem.id}>
                      <span>{chapterItem.code} {chapterItem.title}</span>
                      <ProgressCheck
                        label="网课"
                        checked={Boolean(record?.courseCompleted || record?.completed)}
                        date={progressColumnDate(record, "course")}
                        onToggle={(checked) => saveItem(sectionItem, chapterItem, {
                          courseCompleted: checked,
                          courseDate: checked ? record?.courseDate || "" : "",
                        })}
                        onDate={(date) => saveItem(sectionItem, chapterItem, { courseDate: date, courseCompleted: Boolean(date) || Boolean(record?.courseCompleted) })}
                        defaultDate={useManualDate ? manualDate : ""}
                      />
                      <ProgressCheck
                        label="习题"
                        checked={Boolean(record?.exerciseCompleted || record?.completed)}
                        date={progressColumnDate(record, "exercise")}
                        onToggle={(checked) => saveItem(sectionItem, chapterItem, {
                          exerciseCompleted: checked,
                          exerciseDate: checked ? record?.exerciseDate || "" : "",
                        })}
                        onDate={(date) => saveItem(sectionItem, chapterItem, { exerciseDate: date, exerciseCompleted: Boolean(date) || Boolean(record?.exerciseCompleted) })}
                        defaultDate={useManualDate ? manualDate : ""}
                      />
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function ProfessionalProgressPage({ records, onSave }) {
  const [activeStage, setActiveStage] = useState(professionalStages[0]?.id || "stage-1");
  const [showCompleted, setShowCompleted] = useState(false);
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [useManualDate, setUseManualDate] = useState(true);
  const progressMap = getProfessionalProgressMap(records);
  const sections = professionalCurriculum.filter((sectionItem) => sectionItem.stageId === activeStage);
  const stageItems = sections.flatMap((sectionItem) => sectionItem.items);
  const doneCount = stageItems.filter((item) => progressMap[item.id]?.completed).length;

  function saveItem(sectionItem, courseItem, patch) {
    const nextRecord = {
      ...(progressMap[courseItem.id] || {}),
      ...patch,
    };
    onSave({
      itemId: courseItem.id,
      stageId: sectionItem.stageId,
      stageTitle: sectionItem.stageTitle,
      sectionId: sectionItem.id,
      sectionTitle: sectionItem.title,
      moduleTitle: sectionItem.moduleTitle,
      lectureTitle: sectionItem.lectureTitle,
      number: courseItem.number,
      label: `【${courseItem.number}｜${courseItem.mode}】`,
      mode: courseItem.mode,
      title: courseItem.title,
      page: courseItem.page,
      completed: Boolean(nextRecord.completed),
      completedDate: nextRecord.completedDate || "",
      note: nextRecord.note || "",
    });
  }

  return (
    <section className="content-stack">
      <div className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Tsinghua 431</p>
            <h2>专业课进度追踪</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => setShowCompleted((value) => !value)}>
            {showCompleted ? "隐藏已完成模块" : "显示已完成模块"}
          </button>
        </div>
        <div className="filter-bar">
          {professionalStages.map((stage) => (
            <button key={stage.id} className={activeStage === stage.id ? "chip active" : "chip"} onClick={() => setActiveStage(stage.id)}>
              {stage.title}
            </button>
          ))}
        </div>
        <div className="progress-overview">
          <strong>{doneCount} / {stageItems.length}</strong>
          <div className="progress cat-progress"><i style={{ width: `${stageItems.length ? (doneCount / stageItems.length) * 100 : 0}%` }} /></div>
          <label>
            日期快捷值
            <input type="date" value={manualDate} disabled={!useManualDate} onChange={(event) => setManualDate(event.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={useManualDate} onChange={(event) => setUseManualDate(event.target.checked)} />
            填日期时使用快捷值
          </label>
        </div>
      </div>

      <div className="math-section-list">
        {sections.map((sectionItem) => {
          const completed = isProfessionalSectionComplete(sectionItem, progressMap);
          if (completed && !showCompleted) {
            return (
              <details className="math-section collapsed" key={sectionItem.id}>
                <summary>{sectionItem.title} · 已完成</summary>
              </details>
            );
          }

          return (
            <details className="math-section" key={sectionItem.id} open={!completed}>
              <summary>{sectionItem.title}{completed ? " · 已完成" : ""}</summary>
              <div className="math-item-list">
                {sectionItem.items.map((courseItem) => {
                  const record = progressMap[courseItem.id];
                  return (
                    <div className="math-item professional-item" key={courseItem.id}>
                      <span>
                        <b>{courseItem.number}</b>
                        <em>{courseItem.mode}</em>
                        {courseItem.title}
                        {courseItem.page && <small>{courseItem.page}</small>}
                      </span>
                      <ProgressCheck
                        label="完成"
                        checked={Boolean(record?.completed)}
                        date={record?.completedDate || ""}
                        onToggle={(checked) => saveItem(sectionItem, courseItem, {
                          completed: checked,
                          completedDate: checked ? record?.completedDate || "" : "",
                        })}
                        onDate={(date) => saveItem(sectionItem, courseItem, { completedDate: date, completed: Boolean(date) || Boolean(record?.completed) })}
                        defaultDate={useManualDate ? manualDate : ""}
                      />
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function progressColumnDate(record, type) {
  const directDate = type === "course" ? record?.courseDate : record?.exerciseDate;
  if (directDate) return directDate;
  if (record?.completed && !record?.courseDate && !record?.exerciseDate) return record.completedDate || "";
  return "";
}

function ProgressCheck({ label, checked, date, defaultDate, onToggle, onDate }) {
  const [editingDate, setEditingDate] = useState(false);
  const statusText = checked ? (date || "已完成 · 未记录日期") : "未完成";

  return (
    <div className="progress-check">
      <label>
        <input type="checkbox" checked={checked} onChange={(event) => onToggle(event.target.checked)} />
        {label}
      </label>
      <div className="progress-date-box">
        {editingDate ? (
          <div className="inline-date-editor">
            <input
              type="date"
              value={date || ""}
              onChange={(event) => onDate(event.target.value)}
              aria-label={`${label}完成日期`}
            />
            {!date && defaultDate && <button className="text-button" type="button" onClick={() => onDate(defaultDate)}>填入快捷日期</button>}
            <button className="text-button" type="button" onClick={() => { onDate(""); setEditingDate(false); }}>不记日期</button>
            <button className="text-button" type="button" onClick={() => setEditingDate(false)}>完成</button>
          </div>
        ) : (
          <button className={checked ? "date-text done" : "date-text"} type="button" onClick={() => setEditingDate(true)}>
            {statusText}
          </button>
        )}
      </div>
    </div>
  );
}

function startOfNaturalWeek(isoDate) {
  const date = new Date(`${isoDate || todayIsoDate()}T00:00:00`);
  if (Number.isNaN(date.getTime())) return todayIsoDate();
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return formatLocalIsoDate(date);
}

function endOfNaturalWeek(isoDate) {
  return shiftIsoDate(startOfNaturalWeek(isoDate), 6);
}

function isCurrentNaturalWeek(anchorDate) {
  return startOfNaturalWeek(anchorDate) === startOfNaturalWeek(todayIsoDate());
}

function resolveWeeklyRange(rangeState) {
  if (rangeState.mode === "rolling") {
    const endDate = todayIsoDate();
    return {
      mode: "rolling",
      label: "最近7天",
      startDate: shiftIsoDate(endDate, -6),
      endDate,
    };
  }

  if (rangeState.mode === "custom") {
    const startDate = rangeState.customStart || startOfNaturalWeek(todayIsoDate());
    const endDate = rangeState.customEnd || endOfNaturalWeek(todayIsoDate());
    const normalizedStart = startDate <= endDate ? startDate : endDate;
    const normalizedEnd = startDate <= endDate ? endDate : startDate;
    return {
      mode: "custom",
      label: "自定义范围",
      startDate: normalizedStart,
      endDate: normalizedEnd,
    };
  }

  const startDate = startOfNaturalWeek(rangeState.anchorDate || todayIsoDate());
  const endDate = shiftIsoDate(startDate, 6);
  return {
    mode: "week",
    label: isCurrentNaturalWeek(rangeState.anchorDate) ? "本周自然周" : "自然周",
    startDate,
    endDate,
  };
}

function WeeklySummary({ data }) {
  const [rangeState, setRangeState] = useState(() => ({
    mode: "week",
    anchorDate: todayIsoDate(),
    customStart: startOfNaturalWeek(todayIsoDate()),
    customEnd: endOfNaturalWeek(todayIsoDate()),
  }));
  const [averageMode, setAverageMode] = useState("recorded");
  const [includeSleepInDistribution, setIncludeSleepInDistribution] = useState(false);
  const [distributionScope, setDistributionScope] = useState("primary");
  const [tableLevel, setTableLevel] = useState("primary");
  const [selectedPrimaryCategory, setSelectedPrimaryCategory] = useState("study");
  const [activeIndex, setActiveIndex] = useState("overview");
  const sectionRefs = {
    overview: useRef(null),
    table: useRef(null),
    mainline: useRef(null),
    health: useRef(null),
    dayType: useRef(null),
  };
  const weeklyRange = resolveWeeklyRange(rangeState);
  const summary = buildWeeklySummary(data.settlements, {
    miscTags: [...mergeMiscReviewTags(data.profile?.miscTags || []), ...classificationKeywordTags(data.profile?.classificationTaxonomy || [])],
    entertainmentTags: mergeEntertainmentReviewTags(data.profile?.entertainmentTags || []),
    startDate: weeklyRange.startDate,
    endDate: weeklyRange.endDate,
    dynamicProjects: data.profile?.reviewProjects || [],
  });
  const weeklyTrackers = normalizeReviewTrackers(data.profile?.reviewTrackers, data.profile?.healthMaintenanceItems).filter((tracker) => tracker.paused !== true).map((tracker) => ({ ...tracker, ...buildReviewTrackerSummary({ tracker, settlements: data.settlements, today: weeklyRange.endDate }) }));
  const [selectedInsight, setSelectedInsight] = useState(null);
  const activeTableTotalsSource = tableLevel === "secondary" ? summary.secondaryActivityTotals : summary.activityTotals;
  const allActivityKeys = activeTableTotalsSource.map((activity) => activity.key);
  const [weeklyTableState, setWeeklyTableState] = useState(() => {
    if (typeof window === "undefined") return { selected: [], known: [] };
    try {
      const saved = JSON.parse(window.localStorage.getItem("yeye-weekly-table-keys") || "[]");
      if (Array.isArray(saved)) return { selected: saved, known: saved };
      return { selected: saved.selected || [], known: saved.known || [] };
    } catch {
      return { selected: [], known: [] };
    }
  });
  const tableActivityKeys = resolveWeeklyTableKeys(weeklyTableState);
  const tableActivityTotals = activeTableTotalsSource.filter((activity) => tableActivityKeys.includes(activity.key));
  const studyMax = Math.max(1, ...summary.dailyRows.map((row) => activityMinutesFromRow(row, "study")));
  const visibleActivities = summary.activityTotals.filter((item) => item.minutes > 0 || ["study", "work_affairs", "life_maintenance", "exercise", "sleep", "entertainment_rest", "misc"].includes(item.key));
  const distributionSource = distributionScope === "primary"
    ? summary.activityTotals
    : summary.secondaryActivityTotals.filter((activity) => activity.parentKey === distributionScope);
  const distributionItems = buildWeeklyDistributionItems(distributionSource, includeSleepInDistribution, distributionScope);
  const kpiCards = visibleActivities;
  const averageInfo = resolveWeeklyAverage(summary, averageMode);
  const scopeOptions = [
    ["primary", "全部一级分类"],
    ...summary.activityTotals.map((activity) => [activity.key, `${activity.label} · 二级`]),
  ];

  function scrollToSection(key) {
    setActiveIndex(key);
    sectionRefs[key]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resolveWeeklyTableKeys(state) {
    const selected = state.selected || [];
    const known = state.known || [];
    if (!known.length && !selected.length) return defaultWeeklyTableKeys(activeTableTotalsSource, tableLevel);
    const storedKeys = selected.filter((key) => allActivityKeys.includes(key));
    const newKeys = allActivityKeys.filter((key) => !known.includes(key));
    const resolved = [...storedKeys, ...newKeys.filter((key) => key.startsWith("miscTag:"))];
    return resolved.length ? resolved : defaultWeeklyTableKeys(activeTableTotalsSource, tableLevel);
  }

  function toggleWeeklyTableKey(key) {
    const next = tableActivityKeys.includes(key)
      ? tableActivityKeys.filter((item) => item !== key)
      : [...tableActivityKeys, key];
    if (!next.length) return;
    const nextState = { selected: next, known: allActivityKeys };
    setWeeklyTableState(nextState);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`yeye-weekly-table-keys-${tableLevel}`, JSON.stringify(nextState));
    }
  }

  function switchTableLevel(level) {
    setTableLevel(level);
    if (typeof window === "undefined") {
      setWeeklyTableState({ selected: [], known: [] });
      return;
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(`yeye-weekly-table-keys-${level}`) || "{}");
      setWeeklyTableState({ selected: saved.selected || [], known: saved.known || [] });
    } catch {
      setWeeklyTableState({ selected: [], known: [] });
    }
  }

  function setCurrentWeek() {
    setRangeState((current) => ({ ...current, mode: "week", anchorDate: todayIsoDate() }));
    setSelectedInsight(null);
  }

  function moveNaturalWeek(offset) {
    const basis = rangeState.mode === "week" ? rangeState.anchorDate : weeklyRange.startDate || todayIsoDate();
    setRangeState((current) => ({ ...current, mode: "week", anchorDate: shiftIsoDate(basis, offset * 7) || todayIsoDate() }));
    setSelectedInsight(null);
  }

  function setRollingSevenDays() {
    setRangeState((current) => ({ ...current, mode: "rolling" }));
    setSelectedInsight(null);
  }

  function setCustomRange(patch = {}) {
    setRangeState((current) => ({
      ...current,
      mode: "custom",
      customStart: patch.customStart ?? current.customStart ?? weeklyRange.startDate,
      customEnd: patch.customEnd ?? current.customEnd ?? weeklyRange.endDate,
    }));
    setSelectedInsight(null);
  }

  return (
    <section className="content-stack weekly-page">
      <div className="weekly-page-head">
        <div>
          <p className="eyebrow">Weekly Review</p>
          <h2>周复盘总览</h2>
        </div>
        <div className="weekly-head-actions">
          <div className="weekly-range-control">
            <div className="weekly-range-buttons">
              <button className={rangeState.mode === "week" && isCurrentNaturalWeek(rangeState.anchorDate) ? "active" : ""} type="button" onClick={setCurrentWeek}>本周</button>
              <button type="button" onClick={() => moveNaturalWeek(-1)}>上一周</button>
              <button type="button" onClick={() => moveNaturalWeek(1)}>下一周</button>
              <button className={rangeState.mode === "rolling" ? "active" : ""} type="button" onClick={setRollingSevenDays}>最近7天</button>
              <button className={rangeState.mode === "custom" ? "active" : ""} type="button" onClick={() => setCustomRange()}>自定义</button>
            </div>
            <span>{weeklyRange.label} · {summary.range} · 已记录 {summary.recordedDays}/{summary.days} 天</span>
            {rangeState.mode === "custom" && (
              <div className="weekly-custom-range">
                <input type="date" value={weeklyRange.startDate} onChange={(event) => setCustomRange({ customStart: event.target.value })} />
                <small>至</small>
                <input type="date" value={weeklyRange.endDate} onChange={(event) => setCustomRange({ customEnd: event.target.value })} />
              </div>
            )}
          </div>
          <button className="secondary-button compact" type="button" onClick={() => exportWeeklySummaryCsv(summary, tableActivityKeys, tableLevel)}>导出周报</button>
        </div>
      </div>

      <QuickIndex activeKey={activeIndex} onJump={scrollToSection} />

      <section className="weekly-section-block" ref={sectionRefs.overview}>
        <SectionTitle index="1" title="时间总览" />
        <TimeOverviewSection
          summary={summary}
          distributionItems={distributionItems}
          distributionScope={distributionScope}
          setDistributionScope={setDistributionScope}
          scopeOptions={scopeOptions}
          includeSleep={includeSleepInDistribution}
          setIncludeSleep={setIncludeSleepInDistribution}
          averageMode={averageMode}
          setAverageMode={setAverageMode}
          averageInfo={averageInfo}
          selectedPrimaryCategory={selectedPrimaryCategory}
          setSelectedPrimaryCategory={setSelectedPrimaryCategory}
          kpiCards={kpiCards}
        />
      </section>

      <div className="panel weekly-table-panel weekly-section-block" ref={sectionRefs.table}>
        <div className="panel-title weekly-table-title">
          <div>
            <SectionTitle index="2" title="周时间大表" inline />
            <p className="record-hint">点击有时长的格子，可以查看当天该项目的推进和备注。</p>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => exportWeeklySummaryCsv(summary, tableActivityKeys, tableLevel)}>导出 CSV</button>
        </div>
        <div className="weekly-sub-toolbar compact-toolbar">
          <span>表格层级</span>
          <button className={tableLevel === "primary" ? "active" : ""} type="button" onClick={() => switchTableLevel("primary")}>一级分类</button>
          <button className={tableLevel === "secondary" ? "active" : ""} type="button" onClick={() => switchTableLevel("secondary")}>二级明细</button>
        </div>
        <div className="weekly-column-controls">
          {activeTableTotalsSource.map((activity) => (
            <label key={`weekly-column-${activity.key}`} className="mini-check">
              <input
                type="checkbox"
                checked={tableActivityKeys.includes(activity.key)}
                onChange={() => toggleWeeklyTableKey(activity.key)}
              />
              <span>{activity.label}</span>
            </label>
          ))}
        </div>
        <div className="weekly-table-wrap">
          <table className="weekly-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>星期</th>
                {tableActivityTotals.map((activity) => <th key={activity.key}>{activity.label}</th>)}
                <th>今日类型</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {summary.dailyRows.map((row) => (
                <tr key={row.id || row.date}>
                  <th>{row.date}</th>
                  <td>{weekdayLabel(row.date)}</td>
                  {(tableLevel === "secondary" ? row.secondaryActivities : row.activities).filter((activity) => tableActivityKeys.includes(activity.key)).map((activity) => (
                    <td key={`${row.id || row.date}-${activity.key}`}>
                      <button
                        className={activity.minutes > 0 ? "time-cell filled" : "time-cell"}
                        onClick={() => setSelectedInsight({ row, activity })}
                      >
                        {activity.minutes > 0 ? minutesLabel(activity.minutes) : "-"}
                      </button>
                    </td>
                  ))}
                  <td className="weekly-table-day-type-cell">
                    <DayTypeBadge row={row} />
                  </td>
                  <td>{row.raw?.state?.oneLineSummary || row.raw?.note || (row.hasRecord ? "-" : "未记录")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.dailyRows.length === 0 && <p className="empty-text">还没有可汇总的结算记录。</p>}
      </div>

      <section className="panel weekly-card weekly-section-block">
        <div className="panel-title"><div><SectionTitle index="2.1" title="结构化复盘与追踪" inline /><p className="record-hint">只读取最终复盘的实际分钟；计划排程不会计入。</p></div></div>
        <div className="weekly-schema-summary">{summary.schemaTotals.map((item) => <div key={item.id}><strong>{item.label}</strong><span>{minutesLabel(item.minutes)} · {item.days} 天 · 日均 {minutesLabel(item.averageMinutes)}</span></div>)}</div>
        <div className="weekly-schema-summary">{weeklyTrackers.map((tracker) => <div key={tracker.id}><strong>{tracker.name}</strong><span>{tracker.status?.label || "未记录"} · {trackerMetricText(tracker)}</span></div>)}</div>
      </section>

      {selectedInsight && (
        <div className="panel insight-panel">
          <div className="panel-title">
            <h2>{selectedInsight.row.date} · {selectedInsight.activity.label}</h2>
            <button className="secondary-button compact" type="button" onClick={() => setSelectedInsight(null)}>收起</button>
          </div>
          <p className="record-hint">时长：{minutesLabel(selectedInsight.activity.minutes)}</p>
          {selectedInsight.activity.key === "entertainment_rest" && selectedInsight.activity.breakdown?.length > 0 && (
            <EntertainmentBreakdownDonut items={selectedInsight.activity.breakdown} />
          )}
          {selectedInsight.activity.progress.length > 0 ? (
            <ul className="insight-list">
              {selectedInsight.activity.progress.map((item, index) => <li key={`insight-${index}`}>{item}</li>)}
            </ul>
          ) : (
            <p className="empty-text">这个项目当天没有识别到推进文字。时间已经记入大表。</p>
          )}
          {selectedInsight.activity.blockers.length > 0 && <p className="blocker-text">卡点：{selectedInsight.activity.blockers.join("；")}</p>}
        </div>
      )}

      <section className="weekly-section-block" ref={sectionRefs.mainline}>
        <SectionTitle index="3" title="主线检查 + 趋势" />
        <section className="weekly-middle-grid">
          <WeeklyContinuityPanel rows={summary.dailyRows} />
          <WeeklyBarChart title="本周趋势（总学习时长）" rows={summary.dailyRows} valueKey="study" max={studyMax} averageLabel="已记录日均" />
        </section>
      </section>

      <section className="weekly-section-block" ref={sectionRefs.health}>
        <SectionTitle index="4" title="健康洞悉" />
        <HealthInsightsPanel summary={summary.healthSummary} maskCycle={buildMaskCycleDisplay(data.profile)} />
      </section>

      <section className="weekly-section-block" ref={sectionRefs.dayType}>
        <SectionTitle index="5" title="日类型图例" />
        <DayTypeLegend />
      </section>

      <button className="back-to-top-button" type="button" onClick={() => scrollToSection("overview")}>↑ 顶部</button>
    </section>
  );
}

function QuickIndex({ activeKey, onJump }) {
  const items = [
    ["overview", "1 时间总览"],
    ["table", "2 周时间大表"],
    ["mainline", "3 主线检查"],
    ["health", "4 健康洞悉"],
    ["dayType", "5 日类型"],
  ];
  return (
    <div className="quick-index-card">
      <span className="quick-index-title">快速索引 · 点击可跳转</span>
      <div className="quick-index-tabs">
        {items.map(([key, label]) => (
          <button key={key} className={activeKey === key ? "quick-index-pill active" : "quick-index-pill"} type="button" onClick={() => onJump(key)}>
            {label}
          </button>
        ))}
      </div>
      <button className="quick-index-pin" type="button">固定索引</button>
    </div>
  );
}

function SectionTitle({ index, title, inline = false }) {
  return (
    <div className={inline ? "section-heading inline" : "section-heading"}>
      <span className="section-number">{index}</span>
      <h2>{title}</h2>
    </div>
  );
}

function TimeOverviewSection({
  summary,
  distributionItems,
  distributionScope,
  setDistributionScope,
  scopeOptions,
  includeSleep,
  setIncludeSleep,
  averageMode,
  setAverageMode,
  averageInfo,
  selectedPrimaryCategory,
  setSelectedPrimaryCategory,
  kpiCards,
}) {
  const primaryTotal = kpiCards.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const selectedPrimary = kpiCards.find((item) => item.key === selectedPrimaryCategory) || kpiCards[0];
  const secondaryItems = (summary.secondaryActivityTotals || [])
    .filter((item) => item.parentKey === selectedPrimaryCategory && Number(item.minutes || 0) > 0);
  const selectedTotal = Number(selectedPrimary?.minutes || 0);

  function choosePrimary(key) {
    setSelectedPrimaryCategory(key);
    setDistributionScope(key);
  }

  return (
    <div className="panel time-overview-card">
      <div className="time-overview-toolbar">
        <div className="weekly-sub-toolbar">
          <span>日均口径</span>
          {[
            ["recorded", "已记录日均"],
            ["elapsed", "本周进度日均"],
            ["natural", "自然周日均"],
          ].map(([key, label]) => (
            <button key={key} className={averageMode === key ? "active" : ""} type="button" onClick={() => setAverageMode(key)}>{label}</button>
          ))}
        </div>
        <div className="weekly-sub-toolbar">
          <span>图表视角</span>
          <select value={distributionScope} onChange={(event) => setDistributionScope(event.target.value)}>
            {scopeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <div className="time-overview-main">
        <WeeklyDistributionCard
          items={distributionItems}
          scope={distributionScope}
          includeSleep={includeSleep}
          onToggleSleep={setIncludeSleep}
        />
        <div className="primary-category-grid">
          {kpiCards.map((activity) => {
            const percent = primaryTotal ? Math.round((Number(activity.minutes || 0) / primaryTotal) * 1000) / 10 : 0;
            return (
              <button
                key={activity.key}
                className={selectedPrimaryCategory === activity.key ? "primary-category-card selected" : "primary-category-card"}
                type="button"
                onClick={() => choosePrimary(activity.key)}
              >
                <div className="category-icon">{weeklyKpiIcons[activity.key] || "▦"}</div>
                <span className="category-name">{activity.label}</span>
                <strong className="category-time">{minutesLabel(activity.minutes)}</strong>
                <small className="category-percent">{percent}% · {averageInfo.label} {minutesLabel(averageInfo.divisor ? Math.round(Number(activity.minutes || 0) / averageInfo.divisor) : 0)}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="secondary-detail-panel">
        <div className="secondary-detail-header">
          <span>{selectedPrimary?.label || "学习"}（二级分类明细）</span>
          <small>只展示当前一级分类下的有效明细。</small>
        </div>
        <div className="secondary-detail-grid">
          {secondaryItems.map((item) => {
            const percent = selectedTotal ? Math.round((Number(item.minutes || 0) / selectedTotal) * 1000) / 10 : 0;
            return (
              <div key={item.key} className="secondary-detail-card">
                <span className="secondary-name">{item.label}</span>
                <strong className="secondary-time">{minutesLabel(item.minutes)}</strong>
                <small className="secondary-percent">{percent}%</small>
              </div>
            );
          })}
          {!secondaryItems.length && <p className="empty-text">这个一级分类本周还没有可展开的二级明细。</p>}
        </div>
      </div>
    </div>
  );
}

const entertainmentBreakdownColors = ["#8B83F6", "#4ECDC4", "#F6C66F", "#F6A6C8", "#59C3D1", "#A6B1C2", "#F0A66E"];

function EntertainmentBreakdownDonut({ items = [] }) {
  const total = items.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    const size = total ? (Number(item.minutes || 0) / total) * 100 : 0;
    cursor += size;
    return `${entertainmentBreakdownColors[index % entertainmentBreakdownColors.length]} ${start}% ${cursor}%`;
  });
  const style = { background: total ? `conic-gradient(${segments.join(", ")})` : "#edf1f5" };
  return (
    <div className="entertainment-breakdown-card">
      <div className="mini-donut" style={style}>
        <div>
          <span>娱乐</span>
          <strong>{minutesLabel(total)}</strong>
        </div>
      </div>
      <div className="mini-donut-legend">
        {items.map((item, index) => (
          <span key={item.id || item.label}>
            <i style={{ background: entertainmentBreakdownColors[index % entertainmentBreakdownColors.length] }} />
            {item.label} {minutesLabel(item.minutes)}
          </span>
        ))}
      </div>
    </div>
  );
}

const weeklyDistributionColors = {
  study: "#7C83F6",
  work_affairs: "#F6C66F",
  life_maintenance: "#64C7B5",
  exercise: "#3FB9B1",
  sleep: "#8DB7FF",
  entertainment_rest: "#B48CF0",
  math: "#7C83F6",
  economy: "#64C7B5",
  english: "#8DB7FF",
  ielts: "#C7A7FF",
  thesis: "#7BD6A5",
  japanese: "#F6A6C8",
  reading: "#59C3D1",
  exerciseMinutes: "#3FB9B1",
  work: "#F6C66F",
  family: "#F0A66E",
  misc: "#A6B1C2",
  totalEntertainmentMinutes: "#B48CF0",
};

const weeklyKpiIcons = {
  study: "▥",
  work_affairs: "▤",
  life_maintenance: "⌂",
  exercise: "↗",
  sleep: "☾",
  entertainment_rest: "☁",
  studyMinutes: "▥",
  math: "∑",
  economy: "◈",
  english: "abc",
  ielts: "IELTS",
  thesis: "▣",
  japanese: "あ",
  reading: "□",
  exerciseMinutes: "↗",
  work: "▤",
  family: "⌂",
  misc: "⌘",
  totalEntertainmentMinutes: "☁",
};

function resolveWeeklyAverage(summary, mode) {
  if (mode === "elapsed") {
    return { label: "进度日均", divisor: Math.max(0, Number(summary.elapsedDays || 0)) };
  }
  if (mode === "natural") return { label: "自然周日均", divisor: 7 };
  return { label: "已记录日均", divisor: Math.max(0, Number(summary.recordedDays || 0)) };
}

function defaultWeeklyTableKeys(activityTotals = [], level = "primary") {
  const preferred = level === "secondary"
    ? ["study:math", "study:economy", "study:english", "study:ielts", "study:thesis", "study:japanese", "study:reading"]
    : ["study", "work_affairs", "life_maintenance", "exercise", "sleep", "entertainment_rest", "misc"];
  const keys = activityTotals.map((activity) => activity.key);
  const visible = preferred.filter((key) => keys.includes(key));
  return visible.length ? visible : keys;
}

function activityMinutesFromRow(row, key) {
  return Number(row.activities?.find((activity) => activity.key === key)?.minutes || 0);
}

function buildWeeklyDistributionItems(activityTotals = [], includeSleep = true, scope = "primary") {
  const included = new Set(["study", "work_affairs", "life_maintenance", "exercise", "sleep", "entertainment_rest", "misc"]);
  return activityTotals
    .filter((item) => (scope === "primary" ? included.has(item.key) : true) && (includeSleep || item.key !== "sleep"))
    .map((item) => ({ ...item, color: weeklyDistributionColors[item.key] || weeklyDistributionColors[item.parentKey] || colorFromKey(item.key) }))
    .filter((item) => Number(item.minutes || 0) > 0);
}

function colorFromKey(key) {
  const palette = ["#7C83F6", "#64C7B5", "#8DB7FF", "#C7A7FF", "#7BD6A5", "#F6A6C8", "#59C3D1", "#F6C66F", "#F0A66E", "#A6B1C2"];
  const index = [...String(key || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  return palette[index];
}

function WeeklyDistributionCard({ items, scope, includeSleep, onToggleSleep }) {
  const total = items.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  let cursor = 0;
  const segments = items.map((item) => {
    const start = cursor;
    const size = total ? (Number(item.minutes || 0) / total) * 100 : 0;
    cursor += size;
    return `${item.color} ${start}% ${cursor}%`;
  });
  const donutStyle = {
    background: total ? `conic-gradient(${segments.join(", ")})` : "#edf1f5",
  };

  return (
    <section className="panel weekly-card time-distribution-card">
      <div className="panel-title">
        <div>
          <h2>本周时间分配</h2>
          <p className="record-hint">{scope === "primary" ? "占比为相对于本周已记录主要时间的比例。" : "当前只展示所选一级分类内部的二级分配。"}</p>
        </div>
        {scope === "primary" && <div className="mini-segmented">
          <button className={!includeSleep ? "active" : ""} type="button" onClick={() => onToggleSleep(false)}>不含睡眠</button>
          <button className={includeSleep ? "active" : ""} type="button" onClick={() => onToggleSleep(true)}>含睡眠</button>
        </div>}
      </div>
      <div className="distribution-layout">
        <div className="donut-wrap" style={donutStyle}>
          <div className="donut-center">
            <span>总计</span>
            <strong>{minutesLabel(total)}</strong>
          </div>
        </div>
        <div className="distribution-legend">
          {items.map((item) => (
            <div className="distribution-row" key={`distribution-${item.key}`}>
              <span className="legend-dot" style={{ background: item.color }} />
              <span className="legend-name">{item.label}</span>
              <strong>{minutesLabel(item.minutes)}</strong>
              <span>{total ? Math.round((Number(item.minutes || 0) / total) * 1000) / 10 : 0}%</span>
            </div>
          ))}
          {!items.length && <p className="empty-text">还没有可用于分配图的记录。</p>}
        </div>
      </div>
    </section>
  );
}

function WeeklyKpiCard({ activity, days, averageLabel = "日均" }) {
  const daily = days ? Math.round(Number(activity.minutes || 0) / days) : 0;
  return (
    <article className="weekly-kpi-card">
      <div className="kpi-icon">{weeklyKpiIcons[activity.key] || "▦"}</div>
      <span className="kpi-label">{activity.label}</span>
      <strong className="kpi-value">{minutesLabel(activity.minutes)}</strong>
      <span className="kpi-sub">{averageLabel} {minutesLabel(daily)}</span>
    </article>
  );
}

function WeeklySleepCard({ sleep = {} }) {
  const lateReasons = sleep.lateReasonTop || [];
  return (
    <div className="panel weekly-card sleep-summary-card">
      <div className="panel-title">
        <div>
          <h2>睡眠卡片</h2>
          <p className="record-hint">睡眠单独统计，也可以从分配图中隐藏。</p>
        </div>
        <Moon size={20} />
      </div>
      <div className="sleep-summary-grid">
        <InfoLine label="本周总睡眠" value={minutesLabel(sleep.totalMinutes || 0)} />
        <InfoLine label="已记录日均" value={minutesLabel(sleep.averageMinutes || 0)} />
        <InfoLine label="平均入睡" value={sleep.averageBedtime || "未记录"} />
        <InfoLine label="平均起床" value={sleep.averageWakeTime || "未记录"} />
      </div>
      <div className="health-chip-section">
        <strong>晚睡原因 Top 3</strong>
        <div className="health-chip-row">
          {lateReasons.length ? lateReasons.map((item) => <span key={item.label}>{item.label} × {item.count}</span>) : <span>暂无</span>}
        </div>
      </div>
      <StatusChipGroup title="睡眠影响分布" counts={sleep.sleepImpactCounts || {}} />
    </div>
  );
}

function HealthInsightsPanel({ summary = {}, maskCycle = {} }) {
  const sleep = summary.sleep || {};
  const exercise = summary.exercise || {};
  const status = summary.status || {};
  const healthFields = summary.healthFields || {};
  const radarItems = [
    { label: "精力", value: status.avgEnergy },
    { label: "情绪", value: status.avgMood },
    { label: "学习质量", value: status.avgStudyQuality },
    { label: "执行稳定", value: null },
    { label: "睡眠影响", value: impactCountsToScore(sleep.sleepImpactCounts || {}) },
    { label: "手机干扰", value: impactCountsToScore(status.phoneDistractionCounts || {}) },
  ];
  return (
    <section className="panel health-insights-panel">
      <div className="panel-title">
        <div>
          <h2>健康洞悉</h2>
          <p className="record-hint">这里只做观察，不参与 dayType，也不做惩罚。</p>
        </div>
        <HeartPulse size={20} />
      </div>
      <div className="health-kpi-row">
        <HealthKpi label="平均睡眠" value={minutesLabel(sleep.averageMinutes || 0)} sub={sleep.recordedDays ? `${sleep.recordedDays} 天记录` : "未记录"} />
        <HealthKpi label="本周运动" value={minutesLabel(exercise.totalMinutes || 0)} sub={`${exercise.days || 0} 天`} />
        <HealthKpi label="平均精力" value={status.avgEnergy == null ? "未记录" : `${status.avgEnergy}/10`} sub="只观察，不扣分" />
        <HealthKpi label="面膜状态" value={maskCycle.status || "未开始"} sub={maskCycle.nextSuggestedDate ? `下次 ${maskCycle.nextSuggestedDate}` : "完成一次后开始"} />
      </div>
      <div className="health-insight-grid">
        <HealthMiniCard title="睡眠洞悉">
          <InfoLine label="平均睡眠" value={minutesLabel(sleep.averageMinutes || 0)} />
          <InfoLine label="平均入睡" value={sleep.averageBedtime || "未记录"} />
          <InfoLine label="平均起床" value={sleep.averageWakeTime || "未记录"} />
          <CompactCountList title="晚睡原因" counts={Object.fromEntries((sleep.lateReasonTop || []).map((item) => [item.label, item.count]))} />
          <CompactCountList title="睡眠影响" counts={sleep.sleepImpactCounts || {}} />
        </HealthMiniCard>
        <HealthMiniCard title="运动洞悉">
          <InfoLine label="本周运动" value={minutesLabel(exercise.totalMinutes || 0)} />
          <InfoLine label="运动天数" value={`${exercise.days || 0} 天`} />
          <CompactCountList title="强度分布" counts={exercise.intensityCounts || {}} />
        </HealthMiniCard>
        <HealthMiniCard title="状态洞悉">
          <MiniRadarChart items={radarItems} />
          <InfoLine label="平均精力" value={status.avgEnergy == null ? "未记录" : `${status.avgEnergy}/10`} />
          <InfoLine label="平均情绪" value={status.avgMood == null ? "未记录" : `${status.avgMood}/10`} />
          <CompactCountList title="手机干扰" counts={status.phoneDistractionCounts || {}} />
          <div className="health-relation-list">
            <strong>睡眠影响 × 学习质量</strong>
            {(status.sleepImpactStudyQuality || []).length ? status.sleepImpactStudyQuality.map((item) => (
              <span key={item.label}>{item.label}：{item.average}/10（{item.count}天）</span>
            )) : <span>暂无可计算关系</span>}
          </div>
        </HealthMiniCard>
        <HealthMiniCard title="身体维护补充">
          <CompactCountList title="三餐" counts={healthFields.meals || {}} />
          <CompactCountList title="饮水" counts={healthFields.water || {}} />
          <CompactCountList title="咖啡因/奶茶" counts={healthFields.caffeine || {}} />
          <CompactCountList title="基础护肤" counts={healthFields.skincare || {}} />
          <CompactCountList title="面膜" counts={healthFields.maskStatus || {}} />
          <CompactCountList title="皮肤状态" counts={healthFields.skinState || {}} />
          <CompactCountList title="身体信号" counts={healthFields.bodySignals || {}} />
          <CompactCountList title="恢复行为" counts={healthFields.recoveryActions || {}} />
        </HealthMiniCard>
        <HealthMiniCard title="面膜周期">
          <InfoLine label="上次敷面膜" value={maskCycle.lastMaskDate || "暂无"} />
          <InfoLine label="间隔" value={maskCycle.daysSinceLast == null ? "未开始" : `${maskCycle.daysSinceLast} 天`} />
          <InfoLine label="当前状态" value={maskCycle.status || "未开始"} />
          <InfoLine label="下次建议" value={maskCycle.nextSuggestedDate || "完成一次后开始"} />
          <p className="field-help">{maskCycle.message}</p>
        </HealthMiniCard>
        <HealthMiniCard title="本周观察">
          <p className="field-help">记录本周身体、情绪和生活状态的观察与感受。这里不计分，也不参与 dayType。</p>
          <CompactCountList title="皮肤状态" counts={healthFields.skinState || {}} />
          <CompactCountList title="身体信号" counts={healthFields.bodySignals || {}} />
        </HealthMiniCard>
      </div>
    </section>
  );
}

function HealthKpi({ label, value, sub }) {
  return (
    <article className="health-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}

function HealthMiniCard({ title, children }) {
  return (
    <article className="health-mini-card">
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function CompactCountList({ title, counts = {} }) {
  const entries = Object.entries(counts || {}).filter(([, count]) => Number(count || 0) > 0);
  return (
    <div className="compact-count-list">
      <strong>{title}</strong>
      <div>
        {entries.length ? entries.map(([label, count]) => <span key={label}>{label} × {count}</span>) : <span>暂无</span>}
      </div>
    </div>
  );
}

function WeeklyContinuityPanel({ rows }) {
  const checks = buildWeeklyContinuityChecks(rows);
  return (
    <div className="panel weekly-continuity-panel">
      <div className="panel-title"><h2>主线不断线检查</h2><Check size={20} /></div>
      <div className="continuity-grid">
        {checks.map((item) => (
          <div className={`continuity-item ${continuityTone(item.days)}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.days <= 0 ? "连续进行中" : item.days <= 2 ? "需要留意" : "需要关注"}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildWeeklyContinuityChecks(rows = []) {
  const subject = (row, key) => Number(row.raw?.subjects?.[key]?.minutes || 0);
  const breakDays = (predicate) => rows.filter(predicate).length;
  return [
    ["数学断线", breakDays((row) => subject(row, "math") <= 0)],
    ["英语断线", breakDays((row) => subject(row, "english") + subject(row, "ielts") <= 0)],
    ["论文断线", breakDays((row) => subject(row, "thesis") <= 0)],
    ["专业/经济断线", breakDays((row) => subject(row, "economy") <= 0)],
    ["睡眠低于7h", breakDays((row) => parseSleepMinutes(row.raw?.sleepDuration) < 420)],
    ["手机干扰中/大", breakDays((row) => /中|大/.test(row.raw?.state?.phoneDistraction || row.raw?.state?.phoneInterference || ""))],
  ].map(([label, days]) => ({ label, days, value: `${days} 天` }));
}

function continuityTone(days) {
  if (days <= 0) return "good";
  if (days <= 2) return "warn";
  return "alert";
}

const dayTypeMeta = {
  unrecorded: { label: "未记录", className: "day-type-empty" },
  high_quality_day: { label: "高质量推进日", className: "day-type-high" },
  normal_progress_day: { label: "普通推进日", className: "day-type-normal" },
  baseline_progress_day: { label: "保底推进日", className: "day-type-loose" },
  work_affairs_day: { label: "工作事务日", className: "day-type-work" },
  travel_day: { label: "出游日", className: "day-type-special" },
  loss_of_control_recovery_day: { label: "失控修复日", className: "day-type-repair" },
  light_day: { label: "普通日 / 轻量日", className: "day-type-empty" },
};

function getDayTypeMeta(row = {}) {
  const rawType = row.raw?.nextDayEntertainmentSourceDayType || row.raw?.dayType || "";
  const displayName = row.raw?.dayTypeDisplayName || row.dayType || "";
  if (dayTypeMeta[rawType]) return dayTypeMeta[rawType];
  if (/高质量/.test(displayName)) return dayTypeMeta.high_quality_day;
  if (/保底|保线|低状态/.test(displayName)) return dayTypeMeta.baseline_progress_day;
  if (/工作/.test(displayName)) return dayTypeMeta.work_affairs_day;
  if (/出游/.test(displayName)) return dayTypeMeta.travel_day;
  if (/特殊/.test(displayName)) return dayTypeMeta.work_affairs_day;
  if (/修复|失控/.test(displayName)) return dayTypeMeta.loss_of_control_recovery_day;
  if (/轻量|普通日/.test(displayName)) return dayTypeMeta.light_day;
  return dayTypeMeta.normal_progress_day;
}

function DayTypeBadge({ row }) {
  if (row?.hasRecord === false) return <span className={`day-type-badge ${dayTypeMeta.unrecorded.className}`}>{dayTypeMeta.unrecorded.label}</span>;
  const meta = getDayTypeMeta(row);
  return <span className={`day-type-badge ${meta.className}`}>{meta.label}</span>;
}

function DayTypeLegend() {
  const items = [
    dayTypeMeta.high_quality_day,
    dayTypeMeta.normal_progress_day,
    dayTypeMeta.baseline_progress_day,
    dayTypeMeta.work_affairs_day,
    dayTypeMeta.travel_day,
    dayTypeMeta.loss_of_control_recovery_day,
    dayTypeMeta.light_day,
  ];
  return (
    <div className="panel day-type-legend-panel">
      <div className="panel-title"><h2>日类型图例</h2><Award size={20} /></div>
      <div className="day-type-legend">
        {items.map((item) => <span className={`day-type-badge ${item.className}`} key={item.label}>{item.label}</span>)}
      </div>
    </div>
  );
}

function weekdayLabel(date) {
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return "-";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][value.getDay()];
}

function parseSleepMinutes(value) {
  const text = String(value || "");
  const hourMinute = text.match(/(\d+(?:\.\d+)?)\s*h\s*(\d+(?:\.\d+)?)?/i);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2] || 0);
  const chinese = text.match(/(\d+(?:\.\d+)?)\s*小时\s*(\d+(?:\.\d+)?)?\s*分?/);
  if (chinese) return Number(chinese[1]) * 60 + Number(chinese[2] || 0);
  const minute = text.match(/(\d+(?:\.\d+)?)\s*(?:min|分钟|分)/i);
  return minute ? Number(minute[1]) : Infinity;
}

function WeeklyBarChart({ title, rows, valueKey, max, averageLabel = "本周日均" }) {
  const valueForRow = (row) => activityMinutesFromRow(row, valueKey) || Number(row.raw[valueKey] || 0);
  const recordedRows = rows.filter((row) => row.hasRecord !== false);
  const average = recordedRows.length ? recordedRows.reduce((sum, row) => sum + valueForRow(row), 0) / recordedRows.length : 0;
  const averagePercent = Math.min(96, Math.max(0, (average / Math.max(1, max)) * 100));
  return (
    <div className="panel weekly-card chart-panel trend-card">
      <div className="panel-title">
        <div>
          <h2>{title}</h2>
          <p className="record-hint">虚线是{averageLabel} {minutesLabel(average)}。</p>
        </div>
        <Sparkles size={20} />
      </div>
      <div className="bar-chart trend-chart">
        <div className="trend-avg-line" style={{ bottom: `${averagePercent}%` }} />
        {rows.map((row) => {
          const value = valueForRow(row);
          const height = Math.max(4, Math.round((value / max) * 100));
          return (
            <div className="bar-item" key={`${title}-${row.id || row.date}`}>
              <div className="bar-track"><i style={{ height: `${height}%` }} /></div>
              <span>{minutesLabel(value)}</span>
              <small>{row.date.slice(5) || row.date}</small>
            </div>
          );
        })}
        {rows.length === 0 && <p className="empty-text">暂无趋势数据。</p>}
      </div>
    </div>
  );
}

function StatusSummaryCard({ summary }) {
  const radarItems = [
    { label: "精力", value: summary.avgEnergy },
    { label: "情绪", value: summary.avgMood },
    { label: "学习质量", value: summary.avgStudyQuality },
    { label: "执行稳定", value: summary.avgStability },
    { label: "睡眠影响", value: impactCountsToScore(summary.sleepImpactCounts) },
    { label: "手机干扰", value: impactCountsToScore(summary.phoneDistractionCounts) },
  ];

  return (
    <div className="panel weekly-card state-panel weekly-state-card status-card">
      <div className="panel-title">
        <div>
          <h2>状态小结</h2>
          <p className="record-hint">精力、情绪、质量和干扰情况合在一张小雷达里。</p>
        </div>
        <Sparkles size={20} />
      </div>
      <div className="status-main">
        <MiniRadarChart items={radarItems} />
        <div className="status-metrics">
          <StatusMetric label="平均精力" value={summary.avgEnergy} />
          <StatusMetric label="平均情绪" value={summary.avgMood} />
          <StatusMetric label="学习质量" value={summary.avgStudyQuality} />
          <StatusMetric label="执行稳定" value={summary.avgStability} />
        </div>
      </div>
      <div className="status-chip-grid">
        <StatusChipGroup title="睡眠影响" counts={summary.sleepImpactCounts} />
        <StatusChipGroup title="手机干扰" counts={summary.phoneDistractionCounts} />
      </div>
    </div>
  );
}

function impactCountsToScore(counts = {}) {
  const weights = { 无: 10, 小: 8, 中: 5.5, 大: 2.5 };
  const entries = Object.entries(counts || {});
  const total = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
  if (!total) return 0;
  return round1(entries.reduce((sum, [label, count]) => sum + (weights[label] ?? 5) * Number(count || 0), 0) / total);
}

function MiniRadarChart({ items }) {
  const size = 210;
  const center = size / 2;
  const maxRadius = 70;
  const levels = [0.25, 0.5, 0.75, 1];
  const getPoint = (index, ratio, radius = maxRadius) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / items.length;
    return {
      x: center + Math.cos(angle) * radius * ratio,
      y: center + Math.sin(angle) * radius * ratio,
    };
  };
  const polygonPoints = items
    .map((item, index) => {
      const ratio = Math.min(1, Math.max(0, Number(item.value || 0) / 10));
      const point = getPoint(index, ratio);
      return `${point.x},${point.y}`;
    })
    .join(" ");

  return (
    <div className="mini-radar">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="状态雷达图">
        {levels.map((level) => (
          <polygon
            key={level}
            points={items.map((_, index) => {
              const point = getPoint(index, level);
              return `${point.x},${point.y}`;
            }).join(" ")}
            className="radar-grid"
          />
        ))}
        {items.map((_, index) => {
          const point = getPoint(index, 1);
          return <line key={`axis-${index}`} x1={center} y1={center} x2={point.x} y2={point.y} className="radar-axis" />;
        })}
        <polygon points={polygonPoints} className="radar-area" />
        <polyline points={`${polygonPoints} ${polygonPoints.split(" ")[0]}`} className="radar-line" />
        {items.map((item, index) => {
          const labelPoint = getPoint(index, 1.24);
          return (
            <text key={item.label} x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle" className="radar-label">
              {item.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function StatusMetric({ label, value }) {
  const score = value === null || value === undefined ? null : Number(value);
  const width = score === null ? 0 : Math.min(100, Math.max(0, score * 10));
  const tag = score === null ? "暂无" : score >= 7 ? "良好" : score >= 5.5 ? "中等" : "注意";
  return (
    <div className="state-metric">
      <div className="state-metric-top">
        <span>{label}</span>
        <strong>{score === null ? "暂无" : `${score}/10`}</strong>
        <em className={`status-tag ${score === null ? "mid" : score >= 7 ? "good" : score >= 5.5 ? "mid" : "low"}`}>{tag}</em>
      </div>
      <div className="mini-meter"><i style={{ width: `${width}%` }} /></div>
    </div>
  );
}

function StatusChipGroup({ title, counts }) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="impact-card status-chip-panel">
      <strong className="status-chip-title">{title}</strong>
      <div className="impact-pills status-chip-list">
        {entries.map(([label, count]) => <span className="status-chip" key={`${title}-${label}`}>{label} × {count}</span>)}
        {entries.length === 0 && <small>还没有识别到这一项</small>}
      </div>
    </div>
  );
}

function LibraryPage({ books, sessions, diaryEntries, onSaveBook }) {
  const sortedSessions = [...sessions].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const sortedBooks = [...books].sort((a, b) => String(b.lastReadDate || "").localeCompare(String(a.lastReadDate || "")));
  const [statusFilter, setStatusFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [editingBook, setEditingBook] = useState(null);
  const stats = buildLibraryStats(sortedBooks, sortedSessions);
  const visibleBooks = sortedBooks.filter((book) => {
    if (statusFilter === "favorite" && !book.favorite) return false;
    if (statusFilter !== "all" && statusFilter !== "favorite" && book.status !== statusFilter) return false;
    const query = keyword.trim().toLowerCase();
    if (!query) return true;
    return [book.title, book.author, book.category, ...(book.tags || [])].join(" ").toLowerCase().includes(query);
  });
  const readingBooks = sortedBooks.filter((book) => book.status === "reading").slice(0, 6);
  const trendRows = buildReadingTrendRows(sortedSessions, 7);

  function saveBookPatch(patch) {
    onSaveBook({ ...editingBook, ...patch });
    setEditingBook(null);
  }

  return (
    <section className="content-stack">
      <div className="panel library-hero">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Xiaoye Library</p>
            <h2>小椰图书馆</h2>
          </div>
          <BookOpen size={22} />
        </div>
        <div className="library-stats-grid">
          <StatPill label="累计阅读" value={minutesLabel(stats.totalMinutes)} />
          <StatPill label="本月阅读" value={minutesLabel(stats.monthMinutes)} />
          <StatPill label="本周阅读" value={minutesLabel(stats.weekMinutes)} />
          <StatPill label="已记录书籍" value={`${stats.bookCount} 本`} />
          <StatPill label="正在读" value={`${stats.readingCount} 本`} />
          <StatPill label="读完啦" value={`${stats.finishedCount} 本`} />
          <StatPill label="阅读天数" value={`${stats.readingDays} 天`} />
          <StatPill label="最近阅读" value={stats.lastReadDate || "暂无"} />
        </div>
      </div>

      <section className="library-grid">
        <div className="panel">
          <div className="panel-title"><h2>正在读</h2><Sparkles size={20} /></div>
          <div className="library-book-list">
            {readingBooks.map((book) => (
              <LibraryBookCard key={book.id} book={book} sessions={sortedSessions} diaryEntries={diaryEntries} onEdit={setEditingBook} />
            ))}
            {readingBooks.length === 0 && <p className="empty-text">这里还没有书。今晚读一点点，小椰就帮你把它收进图书馆。</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title"><h2>最近阅读</h2><History size={20} /></div>
          <div className="reading-session-list">
            {sortedSessions.slice(0, 10).map((session) => (
              <article className="reading-session-card" key={session.id}>
                <time>{session.date}</time>
                <strong>{session.bookTitle}</strong>
                <span>{minutesLabel(session.minutes)}</span>
                {session.feeling && <p>{session.feeling}</p>}
              </article>
            ))}
            {sortedSessions.length === 0 && <p className="empty-text">今天还没有阅读记录。读 10 分钟也算，小椰会记得。</p>}
          </div>
        </div>
      </section>

      <section className="library-grid">
        <div className="panel chart-panel">
          <div className="panel-title"><h2>最近 7 天阅读</h2><CalendarClock size={20} /></div>
          <div className="bar-chart">
            {trendRows.map((row) => {
              const max = Math.max(1, ...trendRows.map((item) => item.minutes));
              const height = Math.max(4, Math.round((row.minutes / max) * 100));
              return (
                <div className="bar-item" key={row.date}>
                  <div className="bar-track"><i style={{ height: `${height}%` }} /></div>
                  <span>{minutesLabel(row.minutes)}</span>
                  <small>{row.date.slice(5)}</small>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title"><h2>我的书架</h2><BookOpen size={20} /></div>
          <div className="diary-filter-grid">
            <label className="field"><span>搜索</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="书名、作者、标签" /></label>
            <label className="field">
              <span>状态</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">全部</option>
                <option value="want-to-read">想读</option>
                <option value="reading">在读</option>
                <option value="finished">已读完</option>
                <option value="paused">暂停</option>
                <option value="abandoned">弃读</option>
                <option value="favorite">收藏</option>
              </select>
            </label>
          </div>
          <div className="library-shelf-grid">
            {visibleBooks.map((book) => <LibraryBookCard key={book.id} book={book} sessions={sortedSessions} diaryEntries={diaryEntries} onEdit={setEditingBook} compact />)}
          </div>
        </div>
      </section>

      {editingBook && (
        <div className="panel library-edit-panel">
          <div className="panel-title">
            <h2>编辑书籍</h2>
            <button className="secondary-button compact" type="button" onClick={() => setEditingBook(null)}>收起</button>
          </div>
          <LibraryBookEditor book={editingBook} onSave={saveBookPatch} />
        </div>
      )}
    </section>
  );
}

function getBookSessions(book, sessions = []) {
  const normalizedTitle = book.normalizedTitle || normalizeBookTitle(book.title || "");
  return sessions.filter((session) =>
    session.bookId === book.id ||
    session.normalizedBookTitle === normalizedTitle ||
    normalizeBookTitle(session.bookTitle || "") === normalizedTitle
  );
}

function LibraryBookCard({ book, sessions, diaryEntries, onEdit, onOpen, compact = false }) {
  const bookSessions = getBookSessions(book, sessions);
  const latest = bookSessions[0];
  const relatedDiary = latest ? diaryEntries.find((entry) => entry.date === latest.date) : null;
  return (
    <article className={compact ? "library-book-card compact clickable" : "library-book-card clickable"} onClick={() => onOpen?.(book)} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen?.(book)}>
      <div className="book-cover-placeholder">
        <span>{String(book.title || "书").slice(0, 6)}</span>
      </div>
      <div>
        <strong>{book.title}</strong>
        <span>{readingStatusText(book.status)} · 累计 {minutesLabel(book.totalMinutes)} · {book.sessionCount || 0} 次</span>
        <small>最近：{book.lastReadDate || "暂无"}{book.progressText ? ` · ${book.progressText}` : ""}</small>
        {latest?.feeling && <p>{latest.feeling}</p>}
        {relatedDiary && <small>相关日记：{relatedDiary.title || generateDiaryTitle(relatedDiary.content, relatedDiary.date)}</small>}
        <div className="detected-chip-list">
          {(book.tags || []).map((tag) => <span key={tag}>{tag}</span>)}
          {book.language && <span>{book.language}</span>}
          {book.favorite && <span>收藏</span>}
        </div>
      </div>
      <button className="secondary-button compact" type="button" onClick={(event) => { event.stopPropagation(); onEdit(book); }}>编辑</button>
    </article>
  );
}

function LibraryBookEditor({ book, onSave, availableTags = [] }) {
  const [form, setForm] = useState({
    title: book.title || "",
    author: book.author || "",
    status: book.status || "reading",
    progressText: book.progressText || "",
    category: book.category || "",
    tagsText: (book.tags || []).join("，"),
    newTag: "",
    language: book.language || "zh",
    type: book.type || "other",
    rating: book.rating || 0,
    favorite: book.favorite === true,
    finishedDate: book.finishedDate || "",
  });

  function submit(event) {
    event.preventDefault();
    onSave({
      ...form,
      tags: splitDiaryListValue(form.tagsText),
      rating: Number(form.rating || 0),
    });
  }

  function currentTags() {
    return splitDiaryListValue(form.tagsText);
  }

  function setTags(tags) {
    setForm({ ...form, tagsText: Array.from(new Set(tags.filter(Boolean))).join("，") });
  }

  function toggleTag(tag) {
    const tags = currentTags();
    setTags(tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]);
  }

  function addTag() {
    const tag = form.newTag.trim();
    if (!tag) return;
    setForm({ ...form, tagsText: Array.from(new Set([...currentTags(), tag])).join("，"), newTag: "" });
  }

  return (
    <form className="inline-product-form" onSubmit={submit}>
      <TextField label="书名" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
      <TextField label="作者" value={form.author} onChange={(value) => setForm({ ...form, author: value })} />
      <SelectField label="状态" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={[["want-to-read", "想读"], ["reading", "在读"], ["finished", "已读完"], ["paused", "暂停"], ["abandoned", "弃读"]]} />
      <TextField label="进度" value={form.progressText} onChange={(value) => setForm({ ...form, progressText: value })} />
      <div className="field library-tag-editor">
        <span>标签</span>
        <div className="library-tag-picker">
          {availableTags.map((tag) => (
            <button className={currentTags().includes(tag) ? "chip active" : "chip"} type="button" key={tag} onClick={() => toggleTag(tag)}>{tag}</button>
          ))}
          {availableTags.length === 0 && <small>还没有常用标签，可以先添加一个。</small>}
        </div>
        <div className="inline-input-row">
          <input value={form.newTag} onChange={(event) => setForm({ ...form, newTag: event.target.value })} placeholder="新增标签，例如：睡前阅读" />
          <button className="secondary-button compact" type="button" onClick={addTag}>添加</button>
        </div>
        <input value={form.tagsText} onChange={(event) => setForm({ ...form, tagsText: event.target.value })} placeholder="也可以直接编辑：文学，睡前阅读" />
      </div>
      <SelectField label="语言" value={form.language} onChange={(value) => setForm({ ...form, language: value })} options={[["zh", "中文"], ["en", "英文"], ["ja", "日文"], ["other", "其他"]]} />
      <SelectField label="类型" value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={[["nonfiction", "非虚构"], ["fiction", "小说"], ["academic", "学术"], ["history", "历史"], ["finance", "经济金融"], ["literature", "文学"], ["other", "其他"]]} />
      <NumberField label="评分 1-5" value={form.rating} onChange={(value) => setForm({ ...form, rating: value })} />
      <label className="field"><span>完成日期</span><input type="date" value={form.finishedDate} onChange={(event) => setForm({ ...form, finishedDate: event.target.value })} /></label>
      <label className="check-row inline"><input type="checkbox" checked={form.favorite} onChange={(event) => setForm({ ...form, favorite: event.target.checked })} />收藏</label>
      <button className="primary-button" type="submit"><Save size={18} />保存书籍</button>
    </form>
  );
}

function buildLibraryStats(books, sessions) {
  const today = todayIsoDate();
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const weekStart = new Date(`${today}T00:00:00`);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const totalMinutes = sessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const yearSessions = sessions.filter((item) => String(item.date || "").startsWith(year));
  const monthMinutes = sessions.filter((item) => String(item.date || "").startsWith(month)).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const weekMinutes = sessions.filter((item) => item.date >= weekStartIso).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const readingDates = new Set(sessions.map((item) => item.date).filter(Boolean));
  return {
    totalMinutes,
    yearMinutes: yearSessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0),
    monthMinutes,
    weekMinutes,
    bookCount: books.length,
    readingCount: books.filter((book) => book.status === "reading").length,
    finishedCount: books.filter((book) => book.status === "finished").length,
    readingDays: readingDates.size,
    yearReadingDays: new Set(yearSessions.map((item) => item.date).filter(Boolean)).size,
    currentStreak: readingStreak(readingDates, today),
    longestStreak: longestReadingStreak(readingDates),
    lastReadDate: sessions[0]?.date || "",
    topLanguage: topCountLabel(books.map((book) => book.language).filter(Boolean)),
    topType: topCountLabel(books.map((book) => book.type).filter(Boolean)),
  };
}

function readingStreak(dateSet, today) {
  let cursor = new Date(`${today}T00:00:00`);
  let count = 0;
  while (dateSet.has(cursor.toISOString().slice(0, 10))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function longestReadingStreak(dateSet) {
  const sorted = Array.from(dateSet).sort();
  let best = 0;
  let current = 0;
  let previous = null;
  sorted.forEach((date) => {
    const currentDate = new Date(`${date}T00:00:00`);
    const diff = previous ? (currentDate - previous) / 86400000 : 0;
    current = diff === 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = currentDate;
  });
  return best;
}

function topCountLabel(values = []) {
  const counts = values.reduce((map, value) => {
    const key = String(value || "").trim();
    if (!key) return map;
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function buildLibraryTagCounts(books = []) {
  const counts = {};
  books.forEach((book) => {
    (book.tags || []).forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 14);
}

function buildReadingYearHeatmap(sessions, year) {
  const sessionMap = sessions.reduce((map, session) => {
    if (!String(session.date || "").startsWith(String(year))) return map;
    const current = map[session.date] || { minutes: 0, books: new Set(), feelings: [] };
    current.minutes += Number(session.minutes || 0);
    if (session.bookTitle) current.books.add(session.bookTitle);
    if (session.feeling) current.feelings.push(session.feeling);
    map[session.date] = current;
    return map;
  }, {});
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const firstOffset = (start.getDay() + 6) % 7;
  const cells = [];
  const weeks = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = formatLocalIsoDate(cursor);
    const item = sessionMap[date] || { minutes: 0, books: new Set(), feelings: [] };
    const cell = {
      date,
      minutes: item.minutes,
      books: Array.from(item.books || []),
      feelings: item.feelings || [],
      level: readingHeatLevel(item.minutes),
      month: cursor.getMonth() + 1,
    };
    cells.push(cell);
    const weekIndex = Math.floor((firstOffset + cells.length - 1) / 7);
    const dayIndex = (firstOffset + cells.length - 1) % 7;
    weeks[weekIndex] = weeks[weekIndex] || Array.from({ length: 7 }, () => null);
    weeks[weekIndex][dayIndex] = cell;
  }
  const monthLabels = Array.from({ length: 12 }, (_, index) => {
    const firstDay = new Date(year, index, 1);
    const week = Math.floor((firstOffset + Math.floor((firstDay - start) / 86400000)) / 7);
    return { label: `${index + 1}月`, week };
  });
  return { cells, weeks, monthLabels, weekDays: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] };
}

function readingHeatLevel(minutes) {
  const value = Number(minutes || 0);
  if (value <= 0) return 0;
  if (value < 20) return 1;
  if (value < 40) return 2;
  if (value < 70) return 3;
  return 4;
}

function buildReadingTrendRowsByMode(sessions, mode = "day") {
  if (mode === "month") {
    const year = todayIsoDate().slice(0, 4);
    return Array.from({ length: 12 }, (_, index) => {
      const label = `${index + 1}月`;
      const key = `${year}-${String(index + 1).padStart(2, "0")}`;
      return { label, minutes: sessions.filter((session) => String(session.date || "").startsWith(key)).reduce((sum, item) => sum + Number(item.minutes || 0), 0) };
    });
  }
  if (mode === "week") {
    const today = new Date(`${todayIsoDate()}T00:00:00`);
    return Array.from({ length: 8 }, (_, index) => {
      const end = new Date(today);
      end.setDate(today.getDate() - (7 - index) * 7);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      const safeStartIso = formatLocalIsoDate(start);
      const safeEndIso = formatLocalIsoDate(end);
      return {
        label: `${safeStartIso.slice(5)}-${safeEndIso.slice(5)}`,
        minutes: sessions.filter((session) => session.date >= safeStartIso && session.date <= safeEndIso).reduce((sum, item) => sum + Number(item.minutes || 0), 0),
      };
    });
  }
  return buildReadingTrendRows(sessions, 9).map((row) => ({ label: row.date.slice(5), minutes: row.minutes }));
}

function buildReadingTrendRows(sessions, days = 7) {
  const today = new Date(`${todayIsoDate()}T00:00:00`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    const safeIso = formatLocalIsoDate(date);
    return {
      date: safeIso,
      minutes: sessions.filter((session) => session.date === safeIso).reduce((sum, item) => sum + Number(item.minutes || 0), 0),
    };
  });
}

function LibraryHomePage({ books, sessions, diaryEntries, onSaveBook }) {
  const sortedSessions = [...sessions].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const sortedBooks = [...books].sort((a, b) => String(b.lastReadDate || "").localeCompare(String(a.lastReadDate || "")));
  const [view, setView] = useState("home");
  const [statusFilter, setStatusFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [editingBook, setEditingBook] = useState(null);
  const [selectedBook, setSelectedBook] = useState(null);
  const [trendMode, setTrendMode] = useState("day");
  const [shelfStatus, setShelfStatus] = useState("reading");
  const [selectedHeatDay, setSelectedHeatDay] = useState(null);
  const heatmapRef = useRef(null);
  const stats = buildLibraryStats(sortedBooks, sortedSessions);
  const year = Number(todayIsoDate().slice(0, 4));
  const heatmap = buildReadingYearHeatmap(sortedSessions, year);
  const trendRows = buildReadingTrendRowsByMode(sortedSessions, trendMode);
  const readingBooks = sortedBooks.filter((book) => book.status === "reading").slice(0, view === "home" ? 4 : 12);
  const tagCounts = buildLibraryTagCounts(sortedBooks);
  const availableTags = tagCounts.map((item) => item.tag);
  const visibleBooks = sortedBooks.filter((book) => {
    if (statusFilter === "favorite" && !book.favorite) return false;
    if (statusFilter !== "all" && statusFilter !== "favorite" && book.status !== statusFilter) return false;
    const query = keyword.trim().toLowerCase();
    if (!query) return true;
    return [book.title, book.author, book.category, ...(book.tags || [])].join(" ").toLowerCase().includes(query);
  });
  const shelfPreviewBooks = sortedBooks
    .filter((book) => shelfStatus === "favorite" ? book.favorite : book.status === shelfStatus)
    .slice(0, 6);
  const noteSessions = sortedSessions.filter((session) => session.feeling);
  const navItems = [
    ["home", "阅读首页", BookOpen],
    ["calendar", "阅读日历", CalendarClock],
    ["stats", "阅读统计", History],
    ["shelf", "完整书架", BookOpen],
    ["notes", "阅读小札", Edit3],
    ["tags", "分类标签", Palette],
  ];
  const activeBook = selectedBook
    ? sortedBooks.find((book) => book.id === selectedBook.id || normalizeBookTitle(book.title || "") === normalizeBookTitle(selectedBook.title || "")) || selectedBook
    : null;
  const activeBookSessions = activeBook ? getBookSessions(activeBook, sortedSessions) : [];

  useEffect(() => {
    if (!selectedHeatDay) return undefined;
    function closeOnOutsideClick(event) {
      if (heatmapRef.current && !heatmapRef.current.contains(event.target)) {
        setSelectedHeatDay(null);
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [selectedHeatDay]);

  function saveBookPatch(patch) {
    onSaveBook({ ...editingBook, ...patch });
    setEditingBook(null);
  }

  function openBook(book) {
    setSelectedBook(book);
    setView("book");
  }

  function startNewBook(status = "reading") {
    setEditingBook({
      status,
      title: "",
      author: "",
      category: "",
      tags: [],
      language: "中文",
      type: "纸质书",
    });
    setView("shelf");
  }

  function renderHeatmap(full = false) {
    return (
      <div className={full ? "library-heatmap-wrap full" : "library-heatmap-wrap"} ref={heatmapRef}>
        <div className="library-month-row" style={{ gridTemplateColumns: `3rem repeat(${heatmap.weeks.length}, minmax(0.58rem, 1fr))` }}>
          <span />
          {heatmap.weeks.map((_, index) => {
            const month = heatmap.monthLabels.find((item) => item.week === index);
            return <span key={`month-${index}`}>{month?.label || ""}</span>;
          })}
        </div>
        <div className="library-calendar-grid" style={{ gridTemplateColumns: `3rem repeat(${heatmap.weeks.length}, minmax(0.58rem, 1fr))` }}>
          {heatmap.weekDays.map((day, dayIndex) => (
            <Fragment key={day}>
              <span className="library-weekday">{day}</span>
              {heatmap.weeks.map((week, weekIndex) => {
                const cell = week[dayIndex];
                if (!cell) return <span className="library-heat-cell empty" key={`${day}-${weekIndex}`} />;
                return (
                  <button
                    className={`library-heat-cell heat-${cell.level}`}
                    type="button"
                    key={cell.date}
                    title={`${cell.date}｜${minutesLabel(cell.minutes)}${cell.books.length ? `｜${cell.books.join("、")}` : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedHeatDay(cell);
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="library-heatmap-legend">
          <span>少</span><i className="heat-0" /><i className="heat-1" /><i className="heat-2" /><i className="heat-3" /><i className="heat-4" /><span>多</span>
        </div>
        {selectedHeatDay && (
          <div className="library-day-popover" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{selectedHeatDay.date}</strong>
            <span>阅读 {minutesLabel(selectedHeatDay.minutes)}</span>
            <p>{selectedHeatDay.books.length ? `书籍：${selectedHeatDay.books.join("、")}` : "这一天还没有阅读记录。"}</p>
            {selectedHeatDay.feelings[0] && <p>{selectedHeatDay.feelings[0]}</p>}
          </div>
        )}
      </div>
    );
  }

  function renderTrendChart(tall = false) {
    const max = Math.max(1, ...trendRows.map((item) => item.minutes));
    return (
      <div className={tall ? "bar-chart reading-bars tall" : "bar-chart reading-bars"}>
        {trendRows.map((row) => {
          const height = Math.max(row.minutes > 0 ? 8 : 2, Math.round((row.minutes / max) * 100));
          return (
            <div className="bar-item" key={row.label}>
              <div className="bar-track"><i style={{ height: `${height}%` }} /></div>
              <span>{row.minutes ? minutesLabel(row.minutes) : ""}</span>
              <small>{row.label}</small>
            </div>
          );
        })}
      </div>
    );
  }

  function renderShelfGrid(limit = null) {
    const booksToShow = limit ? visibleBooks.slice(0, limit) : visibleBooks;
    return (
      <div className="library-shelf-grid">
        {booksToShow.map((book) => <LibraryBookCard key={book.id || book.title} book={book} sessions={sortedSessions} diaryEntries={diaryEntries} onEdit={setEditingBook} onOpen={openBook} compact />)}
        {booksToShow.length === 0 && <p className="empty-text">这个分区暂时空着，等一本书被小椰登记进来。</p>}
      </div>
    );
  }

  function renderNotes(limit = null) {
    const notes = limit ? noteSessions.slice(0, limit) : noteSessions;
    return (
      <div className="library-note-list">
        {notes.map((session) => (
          <blockquote key={`note-${session.id}`}>
            <p>{session.feeling}</p>
            <cite>《{session.bookTitle}》 · {session.date}</cite>
          </blockquote>
        ))}
        {notes.length === 0 && <p className="empty-text">这里还没有摘录。哪天读到一句很喜欢的话，就把它留在这里吧。</p>}
      </div>
    );
  }

  function renderFullShelfControls() {
    return (
      <div className="diary-filter-grid compact-filters">
        <label className="field"><span>搜索</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="书名、作者、标签" /></label>
        <label className="field">
          <span>状态</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">全部</option>
            <option value="want-to-read">想读</option>
            <option value="reading">在读</option>
            <option value="finished">已读完</option>
            <option value="paused">暂停</option>
            <option value="abandoned">弃读</option>
            <option value="favorite">收藏</option>
          </select>
        </label>
      </div>
    );
  }

  const pageTitle = view === "book" ? activeBook?.title || "书籍详情" : navItems.find(([id]) => id === view)?.[1] || "阅读首页";

  return (
    <section className="content-stack library-page">
      <div className="library-banner">
        <div className="library-banner-shelves" />
        <div className="library-banner-text">
          <p className="eyebrow">Xiaoye Library</p>
          <h2>阅读</h2>
          <span>Claire 的私人阅读空间</span>
        </div>
        <div className="library-banner-actions">
          <button className="secondary-button compact" type="button" onClick={() => startNewBook("reading")}><Plus size={16} />新增书籍</button>
          <button className="secondary-button compact" type="button" onClick={() => setView("notes")}><Edit3 size={16} />新增笔记</button>
          <button className="secondary-button compact" type="button" onClick={() => setView("shelf")}><BookOpen size={16} />完整书架</button>
        </div>
        <img src="/yeye/yeye-jump-clean.png" alt="小椰猫猫头" />
      </div>

      <section className="library-dashboard">
        <aside className="panel library-aside">
          <div className="library-profile">
            <img src="/yeye/yeye-main-clean.png" alt="" />
            <div>
              <strong>Claire</strong>
              <span>自动从每日复盘长出来的私人图书馆</span>
            </div>
          </div>
          <div className="library-aside-nav">
            {navItems.map(([id, label, Icon]) => (
              <button className={view === id ? "active" : ""} type="button" key={id} onClick={() => setView(id)}>
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="library-overview-list">
            <InfoLine label="累计阅读" value={minutesLabel(stats.totalMinutes)} />
            <InfoLine label="本周阅读" value={minutesLabel(stats.weekMinutes)} />
            <InfoLine label="本月阅读" value={minutesLabel(stats.monthMinutes)} />
            <InfoLine label="阅读天数" value={`${stats.readingDays} 天`} />
            <InfoLine label="连续阅读" value={`${stats.currentStreak} 天`} />
            <InfoLine label="最近阅读" value={stats.lastReadDate || "暂无"} />
          </div>
        </aside>

        <div className="library-main">
          {view !== "home" && (
            <div className="panel library-page-head">
              <button className="secondary-button compact" type="button" onClick={() => setView("home")}><ChevronRight size={16} />返回首页</button>
              <div>
                <p className="eyebrow">Library View</p>
                <h2>{pageTitle}</h2>
              </div>
              <img src="/yeye/yeye-jump-clean.png" alt="" />
            </div>
          )}

          {view === "home" && (
            <>
              <section className="library-main-row library-main-row-top">
                <div className="panel library-overview-card">
                  <div className="panel-title"><h2>阅读总览</h2><BookOpen size={20} /></div>
                  <div className="library-stats-grid compact">
                    <StatPill label="已记录书籍" value={`${stats.bookCount} 本`} />
                    <StatPill label="正在读" value={`${stats.readingCount} 本`} />
                    <StatPill label="读完啦" value={`${stats.finishedCount} 本`} />
                    <StatPill label="最长连续" value={`${stats.longestStreak} 天`} />
                  </div>
                  <button className="ghost-link" type="button" onClick={() => setView("stats")}>查看阅读统计 <ChevronRight size={16} /></button>
                </div>

                <div className="panel library-heatmap-panel">
                  <div className="panel-title">
                    <div>
                      <h2>{year} 年度阅读记录</h2>
                      <p className="record-hint">累计 {minutesLabel(stats.yearMinutes)} · 阅读 {stats.yearReadingDays} 天 · 最长连续 {stats.longestStreak} 天</p>
                    </div>
                    <button className="secondary-button compact" type="button" onClick={() => setView("calendar")}>查看日历</button>
                  </div>
                  {renderHeatmap()}
                </div>
              </section>

              <section className="library-main-row">
                <div className="panel chart-panel">
                  <div className="panel-title">
                    <h2>阅读时长趋势</h2>
                    <div className="segmented-control">
                      {[["day", "按日"], ["week", "按周"], ["month", "按月"]].map(([id, label]) => (
                        <button className={trendMode === id ? "active" : ""} type="button" key={id} onClick={() => setTrendMode(id)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {renderTrendChart()}
                </div>

                <div className="panel">
                  <div className="panel-title"><h2>当前在读</h2><button className="ghost-link" type="button" onClick={() => setView("shelf")}>查看全部</button></div>
                  <div className="library-book-list card-strip">
                    {readingBooks.map((book) => <LibraryBookCard key={book.id || book.title} book={book} sessions={sortedSessions} diaryEntries={diaryEntries} onEdit={setEditingBook} onOpen={openBook} />)}
                    {readingBooks.length === 0 && <p className="empty-text">还没有正在读的书。等你翻开第一本，这里就会亮起来。</p>}
                  </div>
                </div>
              </section>

              <section className="library-main-row">
                <div className="panel">
                  <div className="panel-title"><h2>最近阅读</h2><History size={20} /></div>
                  <div className="reading-session-list">
                    {sortedSessions.slice(0, 8).map((session) => (
                      <article className="reading-session-card" key={session.id}>
                        <time>{session.date}</time>
                        <strong>{session.bookTitle}</strong>
                        <span>{minutesLabel(session.minutes)}</span>
                        {session.feeling && <p>{session.feeling}</p>}
                      </article>
                    ))}
                    {sortedSessions.length === 0 && <p className="empty-text">今天还没有阅读记录。读 10 分钟也算，小椰会记得。</p>}
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-title"><h2>我的书架</h2><button className="ghost-link" type="button" onClick={() => setView("shelf")}>进入完整书架</button></div>
                  <div className="library-shelf-tabs">
                    {[["reading", "在读"], ["want-to-read", "想读"], ["finished", "已读"], ["favorite", "收藏"]].map(([id, label]) => (
                      <button className={shelfStatus === id ? "chip active" : "chip"} type="button" key={id} onClick={() => setShelfStatus(id)}>{label}</button>
                    ))}
                  </div>
                  <div className="library-shelf-grid preview">
                    {shelfPreviewBooks.map((book) => <LibraryBookCard key={book.id || book.title} book={book} sessions={sortedSessions} diaryEntries={diaryEntries} onEdit={setEditingBook} onOpen={openBook} compact />)}
                    {shelfPreviewBooks.length === 0 && <p className="empty-text">这个分区暂时空着。</p>}
                  </div>
                </div>
              </section>

              <section className="library-main-row">
                <div className="panel">
                  <div className="panel-title"><h2>阅读小札</h2><button className="ghost-link" type="button" onClick={() => setView("notes")}>查看全部</button></div>
                  {renderNotes(2)}
                </div>
                <div className="panel">
                  <div className="panel-title"><h2>分类与标签</h2><Palette size={20} /></div>
                  <div className="library-tag-cloud">
                    {tagCounts.map(({ tag, count }) => <span key={tag}>{tag} · {count}</span>)}
                    {tagCounts.length === 0 && <span>睡前阅读 · 待添加</span>}
                  </div>
                  <div className="library-mini-facts">
                    <InfoLine label="最常读语言" value={stats.topLanguage || "-"} />
                    <InfoLine label="最常读类型" value={stats.topType || "-"} />
                  </div>
                </div>
              </section>
            </>
          )}

          {view === "calendar" && (
            <section className="panel library-detail-panel library-heatmap-panel">
              <div className="panel-title">
                <div>
                  <h2>{year} 年度阅读记录</h2>
                  <p className="record-hint">带月份和周几，可以点开某天，再点空白处收起。</p>
                </div>
                <span className="library-year-pill">{year}</span>
              </div>
              {renderHeatmap(true)}
            </section>
          )}

          {view === "stats" && (
            <section className="library-main-row">
              <div className="panel chart-panel">
                <div className="panel-title">
                  <h2>阅读时长趋势</h2>
                  <div className="segmented-control">
                    {[["day", "按日"], ["week", "按周"], ["month", "按月"]].map(([id, label]) => (
                      <button className={trendMode === id ? "active" : ""} type="button" key={id} onClick={() => setTrendMode(id)}>{label}</button>
                    ))}
                  </div>
                </div>
                {renderTrendChart(true)}
              </div>
              <div className="panel">
                <div className="panel-title"><h2>统计摘要</h2><Sparkles size={20} /></div>
                <div className="library-stats-grid compact">
                  <StatPill label="年度阅读" value={minutesLabel(stats.yearMinutes)} />
                  <StatPill label="本月阅读" value={minutesLabel(stats.monthMinutes)} />
                  <StatPill label="本周阅读" value={minutesLabel(stats.weekMinutes)} />
                  <StatPill label="阅读天数" value={`${stats.readingDays} 天`} />
                  <StatPill label="连续阅读" value={`${stats.currentStreak} 天`} />
                  <StatPill label="最长连续" value={`${stats.longestStreak} 天`} />
                </div>
              </div>
            </section>
          )}

          {view === "shelf" && (
            <section className="panel library-detail-panel">
              <div className="panel-title">
                <div><h2>完整书架</h2><p className="record-hint">按状态筛选，也可以直接新增一本书。</p></div>
                <button className="primary-button compact" type="button" onClick={() => startNewBook("reading")}><Plus size={16} />新增书籍</button>
              </div>
              {renderFullShelfControls()}
              {renderShelfGrid()}
            </section>
          )}

          {view === "notes" && (
            <section className="library-detail-panel-grid">
              <div className="panel">
                <div className="panel-title"><h2>阅读小札</h2><Edit3 size={20} /></div>
                {renderNotes()}
              </div>
              <div className="panel library-cat-note">
                <img src="/yeye/yeye-main-clean.png" alt="" />
                <strong>小椰提示</strong>
                <p>阅读小札优先从每日复盘里的阅读感受同步。这样你不用多填一遍，图书馆会自己慢慢长出来。</p>
              </div>
            </section>
          )}

          {view === "tags" && (
            <section className="library-main-row">
              <div className="panel">
                <div className="panel-title"><h2>分类与标签</h2><Palette size={20} /></div>
                <div className="library-tag-cloud large">
                  {tagCounts.map(({ tag, count }) => <span key={tag}>{tag} · {count}</span>)}
                  {tagCounts.length === 0 && <span>睡前阅读 · 待添加</span>}
                </div>
              </div>
              <div className="panel">
                <div className="panel-title"><h2>阅读偏好</h2><Sparkles size={20} /></div>
                <div className="library-mini-facts">
                  <InfoLine label="最常读语言" value={stats.topLanguage || "-"} />
                  <InfoLine label="最常读类型" value={stats.topType || "-"} />
                  <InfoLine label="收藏书籍" value={`${sortedBooks.filter((book) => book.favorite).length} 本`} />
                </div>
              </div>
            </section>
          )}

          {view === "book" && activeBook && (
            <section className="library-detail-panel-grid">
              <div className="panel library-book-detail">
                <div className="library-book-detail-head">
                  <div className="book-cover-placeholder large"><span>{String(activeBook.title || "书").slice(0, 8)}</span></div>
                  <div>
                    <p className="eyebrow">Book Archive</p>
                    <h2>{activeBook.title}</h2>
                    <span>{activeBook.author || "未填写作者"} · {readingStatusText(activeBook.status)} · 累计 {minutesLabel(activeBook.totalMinutes)} · {activeBook.sessionCount || activeBookSessions.length} 次</span>
                    {activeBook.progressText && <p>{activeBook.progressText}</p>}
                    <div className="detected-chip-list">
                      {(activeBook.tags || []).map((tag) => <span key={tag}>{tag}</span>)}
                      {activeBook.language && <span>{activeBook.language}</span>}
                      {activeBook.type && <span>{activeBook.type}</span>}
                      {activeBook.favorite && <span>收藏</span>}
                    </div>
                  </div>
                  <button className="secondary-button compact" type="button" onClick={() => setEditingBook(activeBook)}>编辑</button>
                </div>
                <div className="library-session-timeline">
                  {activeBookSessions.map((session) => {
                    const relatedDiary = diaryEntries.find((entry) => entry.date === session.date);
                    return (
                      <article className="reading-session-card detail" key={session.id || `${session.date}-${session.bookTitle}`}>
                        <time>{session.date}</time>
                        <div>
                          <strong>{minutesLabel(session.minutes)} · {session.bookTitle || activeBook.title}</strong>
                          {session.feeling ? <p>{session.feeling}</p> : <p className="empty-text">这次还没有留下感受。</p>}
                          {relatedDiary && <small>相关日记：{relatedDiary.title || generateDiaryTitle(relatedDiary.content, relatedDiary.date)}</small>}
                        </div>
                      </article>
                    );
                  })}
                  {activeBookSessions.length === 0 && <p className="empty-text">这本书还没有阅读记录。之后从复盘识别到它，就会自动挂到这里。</p>}
                </div>
              </div>
              <div className="panel library-cat-note">
                <img src="/yeye/yeye-jump-clean.png" alt="" />
                <strong>这本书的小档案</strong>
                <p>以后你每次在复盘里写到这本书的阅读感受，都会自动汇到这里，像给一本书慢慢贴便利贴。</p>
              </div>
            </section>
          )}

          {editingBook && (
            <div className="panel library-edit-panel">
              <div className="panel-title">
                <h2>编辑书籍</h2>
                <button className="secondary-button compact" type="button" onClick={() => setEditingBook(null)}>收起</button>
              </div>
              <LibraryBookEditor book={editingBook} onSave={saveBookPatch} availableTags={availableTags} />
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function DiaryArchivePage({ entries, onSave }) {
  const sortedEntries = [...entries].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const tagCounts = buildDiaryTagCounts(sortedEntries);
  const allTags = tagCounts.map((item) => item.tag);
  const [view, setView] = useState("home");
  const [selectedTag, setSelectedTag] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [month, setMonth] = useState(todayIsoDate().slice(0, 7));
  const [editing, setEditing] = useState(null);
  const [fullScreenEditor, setFullScreenEditor] = useState(false);
  const [form, setForm] = useState(() => makeDiaryForm());
  const visibleEntries = filterDiaryEntries(sortedEntries, { selectedTag, keyword, favoriteOnly });
  const monthEntries = sortedEntries.filter((entry) => String(entry.date || "").startsWith(month));
  const stats = buildDiaryStats(sortedEntries);
  const groups = groupDiaryEntriesByMonth(visibleEntries);
  const calendarDays = buildDiaryCalendarDays(month, sortedEntries);

  function makeDiaryForm(entry = {}) {
    return {
      date: entry.date || todayIsoDate(),
      title: entry.title || "",
      summary: entry.summary || generateDiarySummary(entry.content || ""),
      content: entry.content || "",
      tagsText: (entry.normalizedTags || entry.rawTags || []).join("，"),
      peopleText: (entry.people || []).join("，"),
      placesText: (entry.places || []).join("，"),
      isPrivate: entry.isPrivate !== false,
      favorite: entry.favorite === true,
    };
  }

  function edit(entry) {
    setEditing(entry.date);
    setForm(makeDiaryForm(entry));
    setView("home");
  }

  function reset() {
    setEditing(null);
    setForm(makeDiaryForm());
  }

  function submit(event) {
    event.preventDefault();
    const tags = normalizeDiaryTags(form.tagsText);
    onSave({
      date: form.date,
      title: form.title || generateDiaryTitle(form.content, form.date),
      summary: form.summary || generateDiarySummary(form.content),
      content: form.content,
      rawTags: tags,
      normalizedTags: tags,
      tagGroups: groupDiaryTags(tags),
      people: splitDiaryListValue(form.peopleText),
      places: splitDiaryListValue(form.placesText),
      favorite: form.favorite,
      isPrivate: form.isPrivate,
      source: "manual",
      manuallyEdited: true,
    });
    reset();
  }

  function chooseTag(tag) {
    setSelectedTag(tag);
    setView("search");
  }

  return (
    <section className="content-stack">
      <div className="panel diary-hero-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Diary Archive</p>
            <h2>日记档案馆</h2>
          </div>
          <Edit3 size={21} />
        </div>
        <div className="diary-stats-grid">
          <StatPill label="总日记" value={`${stats.total} 篇`} />
          <StatPill label="本月" value={`${stats.monthCount} 篇`} />
          <StatPill label="连续记录" value={`${stats.streak} 天`} />
          <StatPill label="常用标签" value={stats.topTag || "暂无"} />
        </div>
        <div className="diary-view-tabs">
          {[
            ["home", "主页"],
            ["timeline", "时间线"],
            ["calendar", "月历"],
            ["tags", "标签"],
            ["search", "搜索"],
            ["export", "导出"],
          ].map(([id, label]) => (
            <button className={view === id ? "chip active" : "chip"} type="button" key={id} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="diary-workspace">
        <div className={fullScreenEditor ? "panel form-panel diary-editor-panel fullscreen" : "panel form-panel diary-editor-panel"}>
          <div className="panel-title">
            <h2>{editing ? "编辑日记" : "手动补记"}</h2>
            <div className="diary-editor-tools">
              <span>{countDiaryWords(form.content)} 字</span>
              <button className="secondary-button compact" type="button" onClick={() => setFullScreenEditor((value) => !value)}>
                {fullScreenEditor ? "退出全屏" : "全屏编辑"}
              </button>
            </div>
          </div>
          <form className="content-stack" onSubmit={submit}>
            <div className="two-column-fields">
              <label className="field"><span>日期</span><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
              <TextField label="标题" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
            </div>
            <TextField label="摘要" value={form.summary} onChange={(value) => setForm({ ...form, summary: value })} />
            <label className="field">
              <span>正文</span>
              <textarea
                className="diary-editor-textarea"
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value, summary: form.summary || generateDiarySummary(event.target.value) })}
                required
              />
            </label>
            <TextField label="标签" value={form.tagsText} onChange={(value) => setForm({ ...form, tagsText: value })} />
            <div className="two-column-fields">
              <TextField label="人物" value={form.peopleText} onChange={(value) => setForm({ ...form, peopleText: value })} />
              <TextField label="地点" value={form.placesText} onChange={(value) => setForm({ ...form, placesText: value })} />
            </div>
            <div className="diary-toggle-row">
              <label><input type="checkbox" checked={form.isPrivate} onChange={(event) => setForm({ ...form, isPrivate: event.target.checked })} /> 私密</label>
              <label><input type="checkbox" checked={form.favorite} onChange={(event) => setForm({ ...form, favorite: event.target.checked })} /> 收藏</label>
            </div>
            <div className="button-row">
              <button className="primary-button" type="submit"><Save size={18} />{editing ? "保存修改" : "新增日记"}</button>
              <button className="secondary-button" type="button" onClick={() => setForm({ ...form, content: formatDiaryContent(form.content), summary: form.summary || generateDiarySummary(form.content) })}>一键排版</button>
              <button className="secondary-button" type="button" onClick={reset}>清空</button>
            </div>
          </form>
        </div>

        <div className="panel diary-list-panel">
          {view === "home" && (
            <div className="content-stack">
              <div className="panel-title"><h2>最近归档</h2><span>{sortedEntries.length} 篇</span></div>
              <DiaryEntryList entries={sortedEntries.slice(0, 7)} onEdit={edit} onTag={chooseTag} />
            </div>
          )}

          {view === "timeline" && (
            <div className="content-stack">
              <DiaryFilterBar keyword={keyword} setKeyword={setKeyword} selectedTag={selectedTag} setSelectedTag={setSelectedTag} allTags={allTags} favoriteOnly={favoriteOnly} setFavoriteOnly={setFavoriteOnly} />
              {groups.map((group) => (
                <div className="diary-month-group" key={group.month}>
                  <h3>{group.month}</h3>
                  <DiaryEntryList entries={group.entries} onEdit={edit} onTag={chooseTag} />
                </div>
              ))}
              {visibleEntries.length === 0 && <p className="empty-text">没有匹配的日记。</p>}
            </div>
          )}

          {view === "calendar" && (
            <div className="content-stack">
              <div className="diary-month-switch">
                <button className="secondary-button compact" type="button" onClick={() => setMonth(shiftMonth(month, -1))}>上个月</button>
                <strong>{month}</strong>
                <button className="secondary-button compact" type="button" onClick={() => setMonth(shiftMonth(month, 1))}>下个月</button>
              </div>
              <div className="diary-calendar-grid">
                {["一", "二", "三", "四", "五", "六", "日"].map((day) => <b key={day}>{day}</b>)}
                {calendarDays.map((day) => (
                  <button
                    className={day.entry ? `diary-calendar-cell has-entry heat-${diaryHeatLevel(day.entry)}` : "diary-calendar-cell"}
                    type="button"
                    key={day.key}
                    disabled={!day.date}
                    onClick={() => day.entry && edit(day.entry)}
                  >
                    <span>{day.label}</span>
                    {day.entry && <small>{countDiaryWords(day.entry.content)}字</small>}
                  </button>
                ))}
              </div>
              <DiaryEntryList entries={monthEntries} onEdit={edit} onTag={chooseTag} />
            </div>
          )}

          {view === "tags" && (
            <div className="content-stack">
              <div className="panel-title"><h2>标签索引</h2><span>{tagCounts.length} 个</span></div>
              <div className="diary-tag-cloud">
                {tagCounts.map(({ tag, count }) => (
                  <button type="button" key={tag} onClick={() => chooseTag(tag)}>
                    <span>{tag}</span>
                    <strong>{count}</strong>
                  </button>
                ))}
              </div>
              {tagCounts.length === 0 && <p className="empty-text">还没有标签。可以在日记里写“标签：红会，自我成长”。</p>}
            </div>
          )}

          {view === "search" && (
            <div className="content-stack">
              <DiaryFilterBar keyword={keyword} setKeyword={setKeyword} selectedTag={selectedTag} setSelectedTag={setSelectedTag} allTags={allTags} favoriteOnly={favoriteOnly} setFavoriteOnly={setFavoriteOnly} />
              <DiaryEntryList entries={visibleEntries} onEdit={edit} onTag={chooseTag} />
            </div>
          )}

          {view === "export" && (
            <div className="content-stack">
              <div className="panel-title"><h2>导出</h2><Download size={20} /></div>
              <p className="record-hint">可以导出全部 JSON、全部 Markdown，或只导出当前月份 Markdown。</p>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => downloadText("xiaoye-diary-all.json", JSON.stringify(sortedEntries, null, 2), "application/json")}>全部 JSON</button>
                <button className="secondary-button" type="button" onClick={() => downloadText("xiaoye-diary-all.md", entriesToDiaryMarkdown(sortedEntries))}>全部 Markdown</button>
                <button className="secondary-button" type="button" onClick={() => downloadText(`xiaoye-diary-${month}.md`, entriesToDiaryMarkdown(monthEntries))}>{month} Markdown</button>
              </div>
              <DiaryEntryList entries={sortedEntries.slice(0, 10)} onEdit={edit} onTag={chooseTag} showExport />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="diary-stat-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DiaryFilterBar({ keyword, setKeyword, selectedTag, setSelectedTag, allTags, favoriteOnly, setFavoriteOnly }) {
  return (
    <div className="diary-filter-grid">
      <label className="field">
        <span>关键词</span>
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜正文、标题、摘要、人物、地点" />
      </label>
      <label className="field">
        <span>标签</span>
        <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
          <option value="all">全部标签</option>
          {allTags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}
        </select>
      </label>
      <label className="diary-checkbox-filter">
        <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
        只看收藏
      </label>
    </div>
  );
}

function DiaryEntryList({ entries, onEdit, onTag, showExport = false }) {
  const [expandedDate, setExpandedDate] = useState("");

  return (
    <div className="diary-entry-list">
      {entries.map((entry) => {
        const isExpanded = expandedDate === entry.date;
        const body = String(entry.content || "");
        const preview = entry.summary || generateDiarySummary(body) || `${body.slice(0, 130)}${body.length > 130 ? "..." : ""}`;
        return (
        <article className={isExpanded ? "diary-entry-card expanded" : "diary-entry-card"} key={entry.date}>
          <div>
            <div className="diary-entry-meta">
              <time>{entry.date}</time>
              {entry.favorite && <span>收藏</span>}
              <span>{entry.isPrivate === false ? "公开" : "私密"}</span>
            </div>
            <strong>{entry.title || generateDiaryTitle(entry.content, entry.date)}</strong>
            <p>{preview}</p>
            {isExpanded && <div className="diary-full-content">{body}</div>}
            <div className="diary-entry-context">
              {entry.studyMinutes > 0 && <span>学习 {minutesLabel(entry.studyMinutes)}</span>}
              {entry.energyScore && <span>精力 {entry.energyScore}/10</span>}
              {entry.moodScore && <span>情绪 {entry.moodScore}/10</span>}
              {entry.sleepImpact && <span>睡眠 {entry.sleepImpact}</span>}
              {entry.phoneInterference && <span>手机 {entry.phoneInterference}</span>}
            </div>
            <div className="detected-chip-list">
              {(entry.normalizedTags || []).map((tag) => <button type="button" key={tag} onClick={() => onTag(tag)}>{tag}</button>)}
            </div>
            <small>{entry.source === "daily-settlement" ? "来自每日结算" : "手动编辑"} · {countDiaryWords(entry.content)} 字</small>
          </div>
          <div className="diary-card-actions">
            {body.length > 0 && (
              <button className="secondary-button compact" type="button" onClick={() => setExpandedDate(isExpanded ? "" : entry.date)}>
                {isExpanded ? "收起" : "全文"}
              </button>
            )}
            {showExport && <button className="secondary-button compact" type="button" onClick={() => downloadText(`xiaoye-diary-${entry.date}.md`, diaryToMarkdown(entry))}>导出</button>}
            <button className="secondary-button compact" type="button" onClick={() => onEdit(entry)}>编辑</button>
          </div>
        </article>
        );
      })}
      {entries.length === 0 && <p className="empty-text">还没有日记。每日结算识别到 🧩 日记后，会自动归档到这里。</p>}
    </div>
  );
}

function buildDiaryTagCounts(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    (entry.normalizedTags || []).forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1));
  });
  return Array.from(map.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hans-CN"));
}

function buildDiaryStats(entries) {
  const currentMonth = todayIsoDate().slice(0, 7);
  const tagCounts = buildDiaryTagCounts(entries);
  return {
    total: entries.length,
    monthCount: entries.filter((entry) => String(entry.date || "").startsWith(currentMonth)).length,
    streak: calculateDiaryStreak(entries),
    topTag: tagCounts[0]?.tag || "",
  };
}

function calculateDiaryStreak(entries) {
  const dates = new Set(entries.map((entry) => entry.date).filter(Boolean));
  let cursor = new Date(`${todayIsoDate()}T00:00:00`);
  let streak = 0;
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function filterDiaryEntries(entries, { selectedTag, keyword, favoriteOnly }) {
  const query = String(keyword || "").trim().toLowerCase();
  return entries.filter((entry) => {
    const tags = entry.normalizedTags || [];
    if (selectedTag !== "all" && !tags.includes(selectedTag)) return false;
    if (favoriteOnly && !entry.favorite) return false;
    if (!query) return true;
    const haystack = [
      entry.date,
      entry.title,
      entry.summary,
      entry.content,
      ...(entry.people || []),
      ...(entry.places || []),
      ...tags,
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function groupDiaryEntriesByMonth(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const key = String(entry.date || "未标日期").slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  });
  return Array.from(map.entries()).map(([month, monthEntries]) => ({ month, entries: monthEntries }));
}

function buildDiaryCalendarDays(month, entries) {
  const entryMap = new Map(entries.map((entry) => [entry.date, entry]));
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: leading }, (_, index) => ({ key: `empty-${index}`, date: "", label: "" }));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({ key: date, date, label: String(day), entry: entryMap.get(date) });
  }
  return cells;
}

function diaryHeatLevel(entry) {
  const words = countDiaryWords(entry?.content || "");
  if (words >= 900) return 4;
  if (words >= 500) return 3;
  if (words >= 180) return 2;
  return 1;
}

function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(year, monthNumber - 1 + offset, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function diaryToMarkdown(entry) {
  const tags = (entry.normalizedTags || []).join("，");
  const people = (entry.people || []).join("，");
  const places = (entry.places || []).join("，");
  return [
    `# ${entry.date || "未标日期"} ${entry.title || generateDiaryTitle(entry.content, entry.date)}`,
    entry.summary ? `> ${entry.summary}` : "",
    tags ? `标签：${tags}` : "",
    people ? `人物：${people}` : "",
    places ? `地点：${places}` : "",
    "",
    entry.content || "",
    "",
  ].filter((line, index) => line || index > 4).join("\n");
}

function entriesToDiaryMarkdown(entries) {
  return entries.map(diaryToMarkdown).join("\n---\n\n");
}

function formatDiaryContent(content) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return "";
      return lines
        .map((line) => {
          const clean = line.replace(/^[　\s]+/, "");
          if (/^(#{1,6}\s|[-*+]\s|\d+[.)、]\s|>|标签[:：]|人物[:：]|地点[:：])/.test(clean)) return clean;
          return `　　${clean}`;
        })
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function downloadText(filename, content, type = "text/markdown;charset=utf-8") {
  const blob = new Blob([content || ""], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function EnglishTrackingPage({ settlements }) {
  const { columns, days } = buildEnglishDailyRows(settlements);
  const [selectedDetail, setSelectedDetail] = useState(null);

  return (
    <section className="content-stack">
      <div className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">English Tracker</p>
            <h2>英语与雅思学习追踪</h2>
          </div>
          <Sparkles size={20} />
        </div>
        <p className="record-hint">
          日期纵向排列，横向按单词、写作、阅读、听力、口语打卡。雅思专项只识别关键词；点亮的格子可以点击查看当天详细备注。
        </p>
      </div>

      <div className="english-tracker-layout">
        <div className="panel english-table-panel">
          <div className="weekly-table-wrap">
            <table className="weekly-table english-table">
              <thead>
                <tr>
                  <th>日期</th>
                  {columns.map((column) => <th key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <th>{day.date}</th>
                    {columns.map((column) => {
                      const cell = day.cells[column.key];
                      return (
                        <td key={`${day.date}-${column.key}`}>
                          {cell ? (
                            <button className="english-cell-button" type="button" onClick={() => setSelectedDetail({ date: day.date, label: column.label, ...cell })}>
                              <Check size={16} />
                              {cell.minutes > 0 && <strong>{minutesLabel(cell.minutes)}</strong>}
                            </button>
                          ) : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {days.length === 0 && <p className="empty-text">还没有可识别的英语或雅思记录。把复盘粘贴进每日结算后，这里会自动亮起来。</p>}
        </div>

        {selectedDetail && (
          <aside className="panel english-detail-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">{selectedDetail.date}</p>
                <h2>{selectedDetail.label}备注</h2>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => setSelectedDetail(null)}>收起</button>
            </div>
            {selectedDetail.minutes > 0 && <div className="detail-time">{minutesLabel(selectedDetail.minutes)}</div>}
            <p>{selectedDetail.text || "这一天只识别到打卡关键词，还没有详细备注。"}</p>
          </aside>
        )}
      </div>
    </section>
  );
}

function buildEnglishDailyRows(settlements) {
  const columns = [
    { key: "words", label: "单词" },
    { key: "writing", label: "写作" },
    { key: "reading", label: "阅读" },
    { key: "listening", label: "听力" },
    { key: "speaking", label: "口语" },
  ];
  const recent = [...settlements]
    .sort((a, b) => new Date(a.reviewDate || a.createdAt || 0) - new Date(b.reviewDate || b.createdAt || 0))
    .slice(-14);
  const days = recent.map((item) => {
    const date = item.reviewDate || formatDateOnly(item.createdAt);
    const cells = {};
    const english = item.subjects?.english;
    const englishText = [reviewValueText(english?.progress), english?.summary].filter(Boolean).join("；");
    if (english?.minutes || /单词|新词|复习/.test(englishText)) {
      cells.words = {
        minutes: Number(english.minutes || 0),
        text: shortEnglishText(englishText),
      };
    }

    const ielts = item.subjects?.ielts;
    const ieltsLines = splitEnglishNotes(ielts?.progress?.length ? ielts.progress : [ielts?.summary]);
    ieltsLines.forEach((line) => {
      const key = detectIeltsCategory(line);
      if (!key) return;
      cells[key] = {
        minutes: extractMinutesFromText(line),
        text: shortEnglishText(line),
      };
    });

    return { date, cells };
  });

  return { columns, days };
}

function splitEnglishNotes(items) {
  return items
    .filter(Boolean)
    .flatMap((item) => String(item).split(/[；;\n]/))
    .map((item) => item.replace(/^[\s>*#\-]+/, "").trim())
    .filter(Boolean);
}

function detectIeltsCategory(text) {
  if (/写作|作文|大作文|小作文|逻辑链|writing/i.test(text)) return "writing";
  if (/阅读|精读|reading/i.test(text)) return "reading";
  if (/听力|听写|listening/i.test(text)) return "listening";
  if (/口语|part\s*[123]?|speaking/i.test(text)) return "speaking";
  return "";
}

function extractMinutesFromText(text) {
  const value = String(text || "");
  const hourMinute = value.match(/(\d+(?:\.\d+)?)\s*h\s*(\d+(?:\.\d+)?)?\s*(?:min|分钟|分)?/i);
  if (hourMinute) return Math.round(Number(hourMinute[1]) * 60 + Number(hourMinute[2] || 0));
  const minute = value.match(/(\d+(?:\.\d+)?)\s*(?:min|分钟|分)/i);
  if (minute) return Math.round(Number(minute[1]));
  return 0;
}

function shortEnglishText(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > 52 ? `${value.slice(0, 52)}...` : value;
}

function CategoryManager({ categories, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankCategory);

  function edit(category) {
    setEditing(category.id);
    setForm(category);
  }

  function reset() {
    setEditing(null);
    setForm(blankCategory);
  }

  function submit(event) {
    event.preventDefault();
    onSave({ ...form, id: editing });
    reset();
  }

  return (
    <section className="manager-layout">
      <form className="panel form-panel" onSubmit={submit}>
        <div className="panel-title"><h2>{editing ? "编辑分类" : "新增分类"}</h2><Palette size={21} /></div>
        <TextField label="名称" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
        <TextField label="图标" value={form.icon} onChange={(value) => setForm({ ...form, icon: value })} />
        <label className="field"><span>颜色</span><input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label>
        <TextField label="描述" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
        <div className="button-row">
          <button className="primary-button" type="submit"><Save size={18} />保存</button>
          <button className="secondary-button" type="button" onClick={reset}>清空</button>
        </div>
      </form>

      <div className="category-list">
        {categories.map((category) => (
          <div className="category-card" key={category.id} style={{ "--accent": category.color }}>
            <span className="category-mark">{category.icon}</span>
            <div><strong>{category.name}</strong><small>{category.description || category.color}</small></div>
            <div className="row-actions">
              <button className="icon-button" onClick={() => edit(category)} aria-label="编辑分类"><Edit3 size={17} /></button>
              <button className="icon-button danger" onClick={() => onDelete(category.id)} aria-label="删除分类"><Trash2 size={17} /></button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Records({ data, onDeleteSettlement, onRollbackSettlements, onDeleteRedemption, onSyncDiary, onSaveProjectReward }) {
  const latestSettlement = data.settlements[0];
  const previousSettlement = data.settlements[1];
  const latestRedemption = data.redemptions[0];
  const [editingProjectReward, setEditingProjectReward] = useState(null);
  const fallbackProfile = previousSettlement
    ? {
        todayBalanceMinutes: previousSettlement.generatedMinutes,
        nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
        nextDayEntertainmentLimitReason: previousSettlement.nextDayEntertainmentLimitReason || "",
        nextDayEntertainmentSourceDayType: previousSettlement.nextDayEntertainmentSourceDayType || "",
      }
    : { todayBalanceMinutes: 0, nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN, nextDayEntertainmentLimitReason: "", nextDayEntertainmentSourceDayType: "normal_progress_day" };

  return (
    <section className="records-layout">
      <div className="panel">
        <div className="panel-title">
          <h2>结算记录</h2>
          <button className="secondary-button compact" type="button" onClick={() => exportSettlementsCsv(data.settlements)}>导出 CSV</button>
        </div>
        <p className="record-hint">写错时用“撤回最新”。如果要退回到某一天，用“回退到此日”，会移除这一天之后的结算记录；兑换记录不会自动删除。</p>
        {data.settlements.map((item, index) => (
          <div className="record-row" key={item.id}>
            <div>
              <strong>+{formatPoints(item.pointsAdded)} 分 · 生成 {item.generatedMinutes}min</strong>
              <span>
                学习 {item.studyMinutes}min / 入账 {item.studyCredit}min · 自由娱乐 {item.totalEntertainmentMinutes ?? (Number(item.beneficialMinutes || 0) + Number(item.actualGameMinutesToday || 0))}/{item.freeEntertainmentLimitMinutes || DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min
                {Number(item.reviewTimelinessBonus || 0) > 0 && ` · 复盘归档 +${item.reviewTimelinessBonus}分`}
                {item.entertainmentScoreDelta !== undefined
                  ? ` · 娱乐积分 ${Number(item.entertainmentScoreDelta) > 0 ? "+" : ""}${item.entertainmentScoreDelta}分`
                  : Number(item.entertainmentPenaltyPoints || 0) > 0 && ` · 娱乐超限 -${item.entertainmentPenaltyPoints}分`}
              </span>
              <small>
                {item.recognizedEntertainmentMinutes !== undefined && ` · 复盘识别 ${item.recognizedEntertainmentMinutes}min`}
                {item.entertainmentOverLimitMinutes !== undefined && ` · 超限 ${item.entertainmentOverLimitMinutes}min`}
                {item.entertainmentFenceNote && ` · ${item.entertainmentFenceNote}`}
              </small>
              {item.dayTypeDisplayName && <small>{item.dayTypeDisplayName}：{item.nextDayEntertainmentLimitReason}</small>}
              {item.note && <small>{item.note}</small>}
            </div>
            <div className="record-actions">
              <time>{item.reviewDate || formatDateOnly(item.createdAt)}</time>
              {item.rawReview && (
                <button className="secondary-button compact" onClick={() => onSyncDiary(item)}>
                  同步日记
                </button>
              )}
              {latestSettlement?.id === item.id && (
                <button className="secondary-button compact" onClick={() => onDeleteSettlement(item, fallbackProfile)}>
                  撤回最新
                </button>
              )}
              {latestSettlement?.id !== item.id && (
                <button
                  className="secondary-button compact"
                  onClick={() => {
                    const newerSettlements = data.settlements.slice(0, index);
                    const ok = window.confirm(`确定回退到这条结算吗？将移除之后 ${newerSettlements.length} 条结算记录，兑换记录不会自动删除。`);
                    if (ok) onRollbackSettlements(newerSettlements, item);
                  }}
                >
                  回退到此日
                </button>
              )}
            </div>
          </div>
        ))}
        {data.settlements.length === 0 && <p className="empty-text">暂无结算记录。</p>}
      </div>

      <div className="panel">
        <div className="panel-title">
          <h2>兑换记录</h2>
          <button className="secondary-button compact" type="button" onClick={() => exportRedemptionsCsv(data.redemptions)}>导出 CSV</button>
        </div>
        <p className="record-hint">兑换点错时可以撤销最新一次兑换，消耗的积分会加回银行。</p>
        {data.redemptions.map((item) => (
          <div className="record-row" key={item.id}>
              <div>
                <strong>{item.productName}</strong>
                <span>
                  {item.type === "project_reward" ? `+${formatPoints(item.pointsAdded || Math.abs(Number(item.price || 0)))} 分` : `-${formatPoints(item.price)} 分`}
                  {" "}· 剩余 {item.remainingPoints == null ? "未知" : formatPoints(item.remainingPoints)} 分{item.type === "entertainment_extension" ? ` · 仅 ${item.date || "当天"} 有效` : ""}
                </span>
              </div>
            <div className="record-actions">
            <time>{formatDateOnly(item.createdAt)}</time>
              {latestRedemption?.id === item.id && (
                <button
                  className="secondary-button compact"
                  onClick={() => onDeleteRedemption(item, data.products.find((product) => product.id === item.productId))}
                >
                  撤销
                </button>
              )}
            </div>
          </div>
        ))}
        {data.redemptions.length === 0 && <p className="empty-text">暂无兑换记录。</p>}
      </div>

      <div className="panel">
        <div className="panel-title">
          <h2>结项申请</h2>
          <Sparkles size={20} />
        </div>
        <p className="record-hint">这里只记录结项申请和最终加分，不参与 dayType 自动判定。</p>
        {(data.projectRewardApplications || []).map((item) => (
          <div className="record-row" key={item.id}>
            <div>
              <strong>{item.eventName || "未命名事件"}</strong>
              <span>申请 +{item.requestedPoints || 0} · 最终 +{item.finalPoints || 0} · {item.result || "未填写结果"}</span>
              <small>{item.archived ? "已总结归档" : "未归档"}{item.note ? ` · ${item.note}` : ""}</small>
            </div>
            <div className="record-actions">
              <button className="secondary-button compact" type="button" onClick={() => setEditingProjectReward(item)}>编辑</button>
              {item.eventBookLink && <button className="secondary-button compact" type="button" onClick={() => window.open(item.eventBookLink, "_blank", "noopener,noreferrer")}>事件簿</button>}
              <time>{formatDateOnly(item.createdAt)}</time>
            </div>
          </div>
        ))}
        {(data.projectRewardApplications || []).length === 0 && <p className="empty-text">暂无结项申请。</p>}
      </div>
      {editingProjectReward && (
        <ProjectRewardApplicationPanel
          profile={data.profile}
          application={editingProjectReward}
          onClose={() => setEditingProjectReward(null)}
          onSave={(application) => {
            onSaveProjectReward(application);
            setEditingProjectReward(null);
          }}
        />
      )}
    </section>
  );
}

function catkeeperStatusText(status) {
  return {
    not_configured: "尚未配置或连接未启用",
    testing: "正在测试连接…",
    syncing: "正在同步…",
    connected: "连接成功",
    accepted: "Snapshot 已接收",
    duplicate: "Snapshot 内容重复",
    ignored_stale: "Cyberboss 已有更新版本",
    unauthorized: "token 错误",
    schema_rejected: "Snapshot schema 被拒绝",
    receiver_unavailable: "Cyberboss 未启动或无法连接",
    cors_or_network_error: "浏览器跨域或网络错误",
    timeout: "连接超时",
  }[status] || "尚未配置";
}

function CyberbossConnectionPanel({ snapshot, categoryCatalog, onOpenSchedule }) {
  const [settings, setSettings] = useState(() => loadConnectionSettings());
  const [activity, setActivity] = useState("");

  function persist() {
    const saved = saveConnectionSettings(settings);
    setSettings(saved);
    setActivity("本机连接配置已保存");
  }

  async function handleTest() {
    setActivity("testing");
    const result = await testConnection(settings);
    setSettings(loadConnectionSettings());
    setActivity(result.status);
  }

  async function handleSync() {
    if (!snapshot) {
      setActivity("请先打开明日排程以加载当前计划");
      return;
    }
    setActivity("syncing");
    const currentSnapshot = buildAgentDaySnapshot({
      date: snapshot.date,
      timezone: snapshot.timezone,
      timeline: snapshot.timeline,
      review: snapshot.review,
      metadata: {
        available: snapshot.available,
        planUpdatedAt: snapshot.planUpdatedAt,
        sourceMode: snapshot.source.mode,
        revision: snapshot.source.revision,
      },
      now: new Date(),
    });
    const result = await sendSnapshot(currentSnapshot, settings);
    setSettings(loadConnectionSettings());
    setActivity(result.status);
  }

  async function handleCatalogSync() {
    setActivity("syncing_catalog");
    const result = await sendCategoryCatalog(categoryCatalog, settings);
    setSettings(loadConnectionSettings());
    setActivity(result.status);
  }

  function clear() {
    setSettings(clearConnectionSettings());
    setActivity("本机连接配置已清除");
  }

  const status = activity || settings.lastSyncStatus || settings.lastTestStatus || "not_configured";
  return (
    <div className="settings-block">
      <strong>纪雪尘 / Cyberboss 连接</strong>
      <p className="field-help">地址、token 和最近状态仅保存在此浏览器的 localStorage，不会保存到 Firebase、profile 或 demo 数据。仅支持本机 127.0.0.1 连接。</p>
      <label className="check-field"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />启用 Cyberboss 连接</label>
      <TextField label="Cyberboss 地址" value={settings.baseUrl} onChange={(value) => setSettings((current) => ({ ...current, baseUrl: value }))} />
      <label className="field">
        <span>本地 token</span>
        <input type="password" autoComplete="off" value={settings.token} onChange={(event) => setSettings((current) => ({ ...current, token: event.target.value }))} placeholder="仅保存在当前浏览器" />
      </label>
      <div className="button-row">
        <button className="secondary-button compact" type="button" onClick={persist}>保存本机配置</button>
        <button className="secondary-button compact" type="button" onClick={handleTest} disabled={activity === "testing"}>{activity === "testing" ? "测试中…" : "测试连接"}</button>
        <button className="primary-button compact" type="button" onClick={handleSync} disabled={activity === "syncing"}>{activity === "syncing" ? "同步中…" : "立即同步当前计划"}</button>
        <button className="secondary-button compact danger-text" type="button" onClick={clear}>清除配置</button>
      </div>
      <div className="button-row">
        <button className="secondary-button compact" type="button" onClick={handleCatalogSync} disabled={activity === "syncing_catalog"}>Sync category catalog</button>
      </div>
      {!snapshot && <div className="field-help">尚未加载当前排程快照。<button className="text-button" type="button" onClick={onOpenSchedule}>打开明日排程</button> 后再返回此处同步。</div>}
      {snapshot && <p className="field-help">待发送计划日期：{snapshot.date}；时间线 {snapshot.timeline.length} 块；复盘状态：{snapshot.review.status}。</p>}
      <p className="field-help">最近状态：{catkeeperStatusText(status)}{settings.lastSyncedAt ? ` · 最近同步 ${formatDateTime(settings.lastSyncedAt)}` : ""}{settings.lastSyncedDate ? ` · 日期 ${settings.lastSyncedDate}` : ""}</p>
    </div>
  );
}

function SettingsPage({ profile, settlements = [], onSave, agentSnapshot, onOpenSchedule, userReady = false, onApplyTaxonomyMigration }) {
  const [form, setForm] = useState({
    displayName: profile.displayName || "Claire",
    points: profile.points || 0,
    defaultTomorrowGameMinutes: profile.defaultTomorrowGameMinutes || 30,
    beneficialProtectionMinutes: profile.beneficialProtectionMinutes || 60,
    miscTags: mergeMiscReviewTags(profile.miscTags || []),
    entertainmentTags: mergeEntertainmentReviewTags(profile.entertainmentTags || []),
    classificationTaxonomy: normalizeClassificationTaxonomy(profile.classificationTaxonomy || []),
    plannerCategoryColors: profile.plannerCategoryColors || {},
    travelDayBonusPoints: profile.travelDayBonusPoints ?? 1,
    eventBookLink: profile.eventBookLink || "",
    dashboardGoalTitle: profile.dashboardGoalTitle || "",
    dashboardGoalMessage: profile.dashboardGoalMessage || "",
    dashboardGoalDate: profile.dashboardGoalDate || "",
    dashboardGoalImage: profile.dashboardGoalImage || "",
    healthMaintenanceItems: mergeHealthMaintenanceItems(profile.healthMaintenanceItems || []),
    reviewProjects: Array.isArray(profile.reviewProjects) ? profile.reviewProjects : [],
  });
  const [tagDraft, setTagDraft] = useState({ name: "", keywords: "" });
  const [entertainmentTagDraft, setEntertainmentTagDraft] = useState({ name: "", keywords: "" });
  const [goalImageState, setGoalImageState] = useState("");
  const [maintenanceDraft, setMaintenanceDraft] = useState("");
  const [taxonomyDrag, setTaxonomyDrag] = useState(null);
  const [reviewProjectDragId, setReviewProjectDragId] = useState("");
  const referencedReviewProjectNames = useMemo(() => new Set((settlements || []).flatMap((settlement) => [
    ...(Array.isArray(settlement?.projects) ? settlement.projects.map((project) => project?.name) : []),
    ...(Array.isArray(settlement?.reviewData?.projects) ? settlement.reviewData.projects.map((project) => project?.name) : []),
  ]).filter(Boolean).map((name) => String(name).trim())), [settlements]);
  const categoryCatalog = useMemo(() => buildCatkeeperCategoryCatalog({
    taxonomy: profile.classificationTaxonomy,
    scheduleSettings: profile.scheduleAssistantSettings,
  }), [profile.classificationTaxonomy, profile.scheduleAssistantSettings]);

  function cleanTags(tags, prefix = "tag") {
    return (tags || [])
      .map((tag, index) => ({
        id: tag.id || `${prefix}-${Date.now()}-${index}`,
        name: String(tag.name || "").trim(),
        keywords: String(tag.keywords || tag.name || "").trim(),
      }))
      .filter((tag) => tag.name && tag.keywords);
  }

  function cleanMiscTags(tags) {
    return cleanTags(tags, "misc-tag");
  }

  function cleanEntertainmentTags(tags) {
    return cleanTags(tags, "entertainment-tag");
  }

  function addMiscTag() {
    const name = tagDraft.name.trim();
    const keywords = (tagDraft.keywords || name).trim();
    if (!name || !keywords) return;
    setForm((current) => ({
      ...current,
      miscTags: [...(current.miscTags || []), { id: `misc-tag-${Date.now()}`, name, keywords }],
    }));
    setTagDraft({ name: "", keywords: "" });
  }

  function updateMiscTag(id, field, value) {
    setForm((current) => ({
      ...current,
      miscTags: (current.miscTags || []).map((tag) => (tag.id === id ? { ...tag, [field]: value } : tag)),
    }));
  }

  function deleteMiscTag(id) {
    if (defaultMiscReviewTags.some((tag) => tag.id === id)) return;
    setForm((current) => ({
      ...current,
      miscTags: (current.miscTags || []).filter((tag) => tag.id !== id),
    }));
  }

  function addEntertainmentTag() {
    const name = entertainmentTagDraft.name.trim();
    const keywords = (entertainmentTagDraft.keywords || name).trim();
    if (!name || !keywords) return;
    setForm((current) => ({
      ...current,
      entertainmentTags: [...(current.entertainmentTags || []), { id: `entertainment-tag-${Date.now()}`, name, keywords }],
    }));
    setEntertainmentTagDraft({ name: "", keywords: "" });
  }

  function updateEntertainmentTag(id, field, value) {
    setForm((current) => ({
      ...current,
      entertainmentTags: (current.entertainmentTags || []).map((tag) => (tag.id === id ? { ...tag, [field]: value } : tag)),
    }));
  }

  function deleteEntertainmentTag(id) {
    if (defaultEntertainmentReviewTags.some((tag) => tag.id === id)) return;
    setForm((current) => ({
      ...current,
      entertainmentTags: (current.entertainmentTags || []).filter((tag) => tag.id !== id),
    }));
  }

  function addMaintenanceItem() {
    const name = maintenanceDraft.trim();
    if (!name) return;
    setForm((current) => ({ ...current, healthMaintenanceItems: [...(current.healthMaintenanceItems || []), { id: `maintenance-${Date.now()}`, name, hidden: false, builtIn: false }] }));
    setMaintenanceDraft("");
  }

  function updateMaintenanceItem(id, patch) {
    setForm((current) => ({ ...current, healthMaintenanceItems: current.healthMaintenanceItems.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }

  function deleteMaintenanceItem(id) {
    setForm((current) => ({ ...current, healthMaintenanceItems: current.healthMaintenanceItems.filter((item) => item.id !== id || item.builtIn) }));
  }

  function addReviewProject() {
    setForm((current) => ({ ...current, reviewProjects: [...(current.reviewProjects || []), { id: `review-project-${Date.now()}`, name: "新项目", paused: false, archived: false }] }));
  }

  function updateReviewProject(id, patch) {
    setForm((current) => ({ ...current, reviewProjects: (current.reviewProjects || []).map((project) => project.id === id ? { ...project, ...patch } : project) }));
  }

  function moveReviewProject(id, direction) {
    setForm((current) => {
      const rows = [...(current.reviewProjects || [])];
      const index = rows.findIndex((project) => project.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= rows.length) return current;
      [rows[index], rows[target]] = [rows[target], rows[index]];
      return { ...current, reviewProjects: rows };
    });
  }

  function reorderReviewProject(targetId) {
    if (!reviewProjectDragId || reviewProjectDragId === targetId) return;
    setForm((current) => {
      const rows = [...(current.reviewProjects || [])];
      const from = rows.findIndex((project) => project.id === reviewProjectDragId);
      const to = rows.findIndex((project) => project.id === targetId);
      if (from < 0 || to < 0) return current;
      const [project] = rows.splice(from, 1);
      rows.splice(to, 0, project);
      return { ...current, reviewProjects: rows };
    });
    setReviewProjectDragId("");
  }

  function deleteReviewProject(id) {
    setForm((current) => {
      const project = (current.reviewProjects || []).find((item) => item.id === id);
      const name = String(project?.name || "").trim();
      if (name && referencedReviewProjectNames.has(name)) {
        return {
          ...current,
          reviewProjects: (current.reviewProjects || []).map((item) => item.id === id ? { ...item, archived: true } : item),
        };
      }
      return { ...current, reviewProjects: (current.reviewProjects || []).filter((item) => item.id !== id) };
    });
  }

  function updatePrimaryCategory(primaryId, field, value) {
    setForm((current) => ({ ...current, classificationTaxonomy: current.classificationTaxonomy.map((primary) => primary.id === primaryId ? { ...primary, [field]: value } : primary) }));
  }

  function updateSecondaryCategory(primaryId, secondaryId, field, value) {
    setForm((current) => ({ ...current, classificationTaxonomy: current.classificationTaxonomy.map((primary) => primary.id === primaryId ? { ...primary, children: primary.children.map((secondary) => secondary.id === secondaryId ? { ...secondary, [field]: value } : secondary) } : primary) }));
  }

  function updateTertiaryCategory(primaryId, secondaryId, tertiaryId, field, value) {
    setForm((current) => ({
      ...current,
      classificationTaxonomy: current.classificationTaxonomy.map((primary) => primary.id !== primaryId ? primary : {
        ...primary,
        children: primary.children.map((secondary) => secondary.id !== secondaryId ? secondary : {
          ...secondary,
          children: (secondary.children || []).map((tertiary) => tertiary.id === tertiaryId ? { ...tertiary, [field]: value } : tertiary),
        }),
      }),
    }));
  }

  function addPrimaryCategory() {
    setForm((current) => ({ ...current, classificationTaxonomy: [...current.classificationTaxonomy, { id: "primary-" + Date.now(), name: "新一级分类", color: "#64748B", children: [] }] }));
  }

  function addSecondaryCategory(primaryId) {
    setForm((current) => ({ ...current, classificationTaxonomy: current.classificationTaxonomy.map((primary) => primary.id === primaryId ? { ...primary, children: [...primary.children, { id: "secondary-" + Date.now(), name: "新二级分类", keywords: "", color: primary.color || "#64748B", statGroup: primary.id === "study" ? "study" : "life" }] } : primary) }));
  }

  function addTertiaryCategory(primaryId, secondaryId) {
    setForm((current) => ({
      ...current,
      classificationTaxonomy: current.classificationTaxonomy.map((primary) => primary.id !== primaryId ? primary : {
        ...primary,
        children: primary.children.map((secondary) => secondary.id !== secondaryId ? secondary : {
          ...secondary,
          children: [...(secondary.children || []), { id: `${secondary.id}.detail-${Date.now()}`, name: "新三级分类", keywords: "", enabled: true, trackInWeeklyReview: true }],
        }),
      }),
    }));
  }

  function moveCategorySibling(primaryId, secondaryId, tertiaryId, direction) {
    setForm((current) => {
      const move = (rows, id) => {
        const next = [...rows]; const index = next.findIndex((item) => item.id === id); const target = index + direction;
        if (index < 0 || target < 0 || target >= next.length) return rows;
        [next[index], next[target]] = [next[target], next[index]];
        return next.map((item, order) => ({ ...item, order }));
      };
      if (!primaryId) return { ...current, classificationTaxonomy: move(current.classificationTaxonomy, secondaryId) };
      return { ...current, classificationTaxonomy: current.classificationTaxonomy.map((primary) => primary.id !== primaryId ? primary : !tertiaryId ? { ...primary, children: move(primary.children, secondaryId) } : { ...primary, children: primary.children.map((secondary) => secondary.id !== secondaryId ? secondary : { ...secondary, children: move(secondary.children || [], tertiaryId) }) }) };
    });
  }

  function reorderCategorySibling(primaryId, secondaryId, tertiaryId, targetId) {
    if (!taxonomyDrag || taxonomyDrag.level !== (tertiaryId ? 3 : primaryId ? 2 : 1)) return;
    setForm((current) => {
      const reorder = (rows, fromId, toId) => {
        const next = [...rows]; const from = next.findIndex((item) => item.id === fromId); const to = next.findIndex((item) => item.id === toId);
        if (from < 0 || to < 0 || from === to) return rows;
        const [item] = next.splice(from, 1); next.splice(to, 0, item);
        return next.map((item, order) => ({ ...item, order }));
      };
      if (!primaryId) return { ...current, classificationTaxonomy: reorder(current.classificationTaxonomy, taxonomyDrag.id, targetId) };
      return { ...current, classificationTaxonomy: current.classificationTaxonomy.map((primary) => primary.id !== primaryId ? primary : !tertiaryId ? { ...primary, children: reorder(primary.children, taxonomyDrag.id, targetId) } : { ...primary, children: primary.children.map((secondary) => secondary.id !== secondaryId ? secondary : { ...secondary, children: reorder(secondary.children || [], taxonomyDrag.id, targetId) }) }) };
    });
    setTaxonomyDrag(null);
  }

  function submitSettings(event) {
    event.preventDefault();
    const taxonomy = normalizeClassificationTaxonomy(form.classificationTaxonomy);
    const taxonomyColors = Object.fromEntries(classificationSecondaryItems(taxonomy).map((item) => [item.id, item.color]));
    onSave({ ...form, classificationTaxonomy: taxonomy, plannerCategoryColors: { ...(form.plannerCategoryColors || {}), ...taxonomyColors }, miscTags: cleanMiscTags(form.miscTags), entertainmentTags: cleanEntertainmentTags(form.entertainmentTags) });
  }

  function handleGoalImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 850 * 1024) {
      setGoalImageState("图片太大，尽量压到 850KB 内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setForm((current) => ({ ...current, dashboardGoalImage: reader.result }));
        setGoalImageState("图片已载入");
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <section className="manager-layout">
      <form className="panel form-panel" onSubmit={submitSettings}>
        <div className="panel-title"><h2>设置</h2><Settings size={21} /></div>
        <TextField label="昵称" value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} />
        <NumberField label="当前银行积分校准" value={form.points} onChange={(value) => setForm({ ...form, points: value })} />
        <p className="field-help">自由娱乐额度固定为每天90min，不再由前一天日型决定；结算时按实际自由娱乐时长加扣分。</p>
        <div className="settings-block">
          <strong>事件簿与出游日</strong>
          <TextField label="事件簿链接" value={form.eventBookLink} onChange={(value) => setForm({ ...form, eventBookLink: value })} />
          <NumberField label="出游日默认额外奖励" value={form.travelDayBonusPoints} onChange={(value) => setForm({ ...form, travelDayBonusPoints: value })} />
          <p className="field-help">事件簿链接用于首页“查看事件簿”；出游日只在每日结算手动勾选时生效。</p>
        </div>
        <div className="settings-block">
          <strong>首页倒计时目标卡</strong>
          <p className="field-help">这里设置首页右上角那张小卡。可以只写目标和鼓励话，也可以加目标日做倒计时。</p>
          <TextField label="目标" value={form.dashboardGoalTitle} onChange={(value) => setForm({ ...form, dashboardGoalTitle: value })} />
          <TextField label="目标日（可空）" type="date" value={form.dashboardGoalDate} onChange={(value) => setForm({ ...form, dashboardGoalDate: value })} />
          <label className="field">
            <span>激励的话</span>
            <textarea value={form.dashboardGoalMessage} onChange={(event) => setForm({ ...form, dashboardGoalMessage: event.target.value })} placeholder="比如：慢慢来，但今天也要往前走一点。" />
          </label>
          <label className="field">
            <span>激励图片</span>
            <input type="file" accept="image/*" onChange={handleGoalImageChange} />
          </label>
          {goalImageState && <p className="field-help">{goalImageState}</p>}
          <div className="settings-goal-preview">
            {form.dashboardGoalImage ? <img src={form.dashboardGoalImage} alt="目标卡预览" /> : <div className="dashboard-goal-image-empty">这里会显示首页小卡用的图片</div>}
            <div className="dashboard-goal-copy">
              <strong>{form.dashboardGoalTitle || "还没有写目标"}</strong>
              {form.dashboardGoalDate && <span>目标日：{form.dashboardGoalDate}</span>}
              <p>{form.dashboardGoalMessage || "写一句温柔但有力的话，放在首页看板里。"}</p>
            </div>
            {form.dashboardGoalImage && (
              <button className="secondary-button compact" type="button" onClick={() => setForm((current) => ({ ...current, dashboardGoalImage: "" }))}>
                清空图片
              </button>
            )}
          </div>
        </div>
        <CyberbossConnectionPanel snapshot={agentSnapshot} categoryCatalog={categoryCatalog} onOpenSchedule={onOpenSchedule} />
        <div className="settings-block">
          <strong>身体维护快捷项</strong>
          <p className="field-help">这里只配置每日复盘页的快捷按钮；当天完成记录保存在结算 `health` 字段，不会写入 Markdown。</p>
          <div className="settings-tag-list">
            {(form.healthMaintenanceItems || []).map((item) => <div className="settings-tag-row" key={item.id}>
              <input value={item.name || ""} onChange={(event) => updateMaintenanceItem(item.id, { name: event.target.value })} aria-label="身体维护项目名称" />
              <label className="mini-check"><input type="checkbox" checked={item.hidden === true} onChange={(event) => updateMaintenanceItem(item.id, { hidden: event.target.checked })} />隐藏</label>
              {!item.builtIn && <button className="icon-button danger" type="button" onClick={() => deleteMaintenanceItem(item.id)} aria-label="删除身体维护项目"><Trash2 size={17} /></button>}
            </div>)}
          </div>
          <div className="tag-draft-grid"><TextField label="新快捷项" value={maintenanceDraft} onChange={setMaintenanceDraft} /><button className="secondary-button" type="button" onClick={addMaintenanceItem}>添加快捷项</button></div>
        </div>
        <div className="settings-block">
          <strong>复盘动态项目</strong>
          <p className="field-help">“个人管理系统”固定保留；这里的项目会自动进入默认复盘 Markdown。暂停或归档不会删除历史复盘引用。</p>
          <div className="settings-tag-list">{(form.reviewProjects || []).map((project, index) => {
            const referenced = referencedReviewProjectNames.has(String(project.name || "").trim());
            return <div className="settings-tag-row" key={project.id} draggable onDragStart={() => setReviewProjectDragId(project.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderReviewProject(project.id)}><GripVertical size={16} /><input value={project.name || ""} onChange={(event) => updateReviewProject(project.id, { name: event.target.value })} aria-label="动态项目名称" /><label className="mini-check"><input type="checkbox" checked={project.paused === true} onChange={(event) => updateReviewProject(project.id, { paused: event.target.checked })} />暂停</label><label className="mini-check"><input type="checkbox" checked={project.archived === true} onChange={(event) => updateReviewProject(project.id, { archived: event.target.checked })} />归档</label><button className="secondary-button compact" type="button" onClick={() => moveReviewProject(project.id, -1)} disabled={index === 0}>↑</button><button className="secondary-button compact" type="button" onClick={() => moveReviewProject(project.id, 1)} disabled={index === form.reviewProjects.length - 1}>↓</button><button className="icon-button danger" type="button" onClick={() => deleteReviewProject(project.id)} title={referenced ? "已有历史引用，点击后归档保留" : "删除未引用项目"} aria-label={referenced ? "归档历史引用项目" : "删除未引用的动态项目"}><Trash2 size={17} /></button></div>;
          })}</div>
          <button className="secondary-button compact" type="button" onClick={addReviewProject}>新增项目</button>
        </div>
        <TaxonomyManager
          taxonomy={form.classificationTaxonomy}
          referencedTokens={buildReferencedCategoryTokens({ settlements, profile })}
          onChange={(classificationTaxonomy) => setForm((current) => ({ ...current, classificationTaxonomy }))}
        />
        <TaxonomyMigrationPanel
          liveTaxonomy={profile.classificationTaxonomy}
          ready={userReady}
          onApply={onApplyTaxonomyMigration}
        />
        <div className="settings-block">
          <strong>杂项标签识别</strong>
          <p className="field-help">用于把杂项内容拆进周时间大表。关键词用逗号分隔，识别到对应行后会读取这一行里的分钟数。</p>
          <div className="tag-draft-grid">
            <TextField label="标签名" value={tagDraft.name} onChange={(value) => setTagDraft({ ...tagDraft, name: value })} />
            <TextField label="关键词" value={tagDraft.keywords} onChange={(value) => setTagDraft({ ...tagDraft, keywords: value })} />
            <button className="secondary-button" type="button" onClick={addMiscTag}>添加标签</button>
          </div>
          <div className="settings-tag-list">
            {(form.miscTags || []).map((tag) => {
              const locked = defaultMiscReviewTags.some((item) => item.id === tag.id);
              return (
                <div className="settings-tag-row" key={tag.id}>
                  <input value={tag.name || ""} onChange={(event) => updateMiscTag(tag.id, "name", event.target.value)} aria-label="标签名" />
                  <input value={tag.keywords || ""} onChange={(event) => updateMiscTag(tag.id, "keywords", event.target.value)} aria-label="关键词" />
                  <button className="icon-button danger" type="button" disabled={locked} onClick={() => deleteMiscTag(tag.id)} aria-label="删除标签"><Trash2 size={17} /></button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="settings-block">
          <strong>娱乐来源标签识别</strong>
          <p className="field-help">用于读取复盘里“娱乐 - 来源”下面的明细。默认有文游、小说、游戏、视频、短视频；你可以继续加自己的娱乐分类。</p>
          <div className="tag-draft-grid">
            <TextField label="标签名" value={entertainmentTagDraft.name} onChange={(value) => setEntertainmentTagDraft({ ...entertainmentTagDraft, name: value })} />
            <TextField label="关键词" value={entertainmentTagDraft.keywords} onChange={(value) => setEntertainmentTagDraft({ ...entertainmentTagDraft, keywords: value })} />
            <button className="secondary-button" type="button" onClick={addEntertainmentTag}>添加标签</button>
          </div>
          <div className="settings-tag-list">
            {(form.entertainmentTags || []).map((tag) => {
              const locked = defaultEntertainmentReviewTags.some((item) => item.id === tag.id);
              return (
                <div className="settings-tag-row" key={tag.id}>
                  <input value={tag.name || ""} onChange={(event) => updateEntertainmentTag(tag.id, "name", event.target.value)} aria-label="娱乐标签名" />
                  <input value={tag.keywords || ""} onChange={(event) => updateEntertainmentTag(tag.id, "keywords", event.target.value)} aria-label="娱乐关键词" />
                  <button className="icon-button danger" type="button" disabled={locked} onClick={() => deleteEntertainmentTag(tag.id)} aria-label="删除娱乐标签"><Trash2 size={17} /></button>
                </div>
              );
            })}
          </div>
        </div>
        <button className="primary-button full" type="submit"><Save size={18} />保存设置</button>
      </form>
      <div className="panel">
        <div className="panel-title"><h2>数据结构</h2><Sparkles size={20} /></div>
        <p className="empty-text">云端数据按 Firebase user.uid 隔离：分类、商品、结算、兑换记录都会同步到同一 Google 账号。杂项标签保存在个人设置里，之后识别复盘会按这些关键词拆分。</p>
      </div>
    </section>
  );
}

function buildReferencedCategoryTokens({ settlements = [], profile = {} } = {}) {
  const source = JSON.stringify({ settlements, scheduleAssistantDraft: profile.scheduleAssistantDraft || {}, scheduleAssistantSettings: profile.scheduleAssistantSettings || {} });
  return new Set(String(source || "").split(/[^一-龥a-zA-Z0-9_.-]+/).filter(Boolean));
}

function taxonomyNodeLabel(node = {}) {
  return node.name || "未命名分类";
}

function flattenTaxonomyNodes(nodes = [], parentId = "", level = 1, path = [], labelPath = []) {
  return (Array.isArray(nodes) ? nodes : []).flatMap((node) => {
    const current = { ...node, parentId, level, path: [...path, node.id], labelPath: [...labelPath, taxonomyNodeLabel(node)] };
    return [current, ...flattenTaxonomyNodes(node.children || [], node.id, level + 1, current.path, current.labelPath)];
  });
}

function TaxonomyManager({ taxonomy = [], referencedTokens = new Set(), onChange }) {
  const [selectedId, setSelectedId] = useState(() => flattenTaxonomyNodes(taxonomy)[0]?.id || "");
  const [dragging, setDragging] = useState(null);
  const flat = flattenTaxonomyNodes(taxonomy);
  const selected = flat.find((node) => node.id === selectedId) || flat[0] || null;
  const updateTree = (visitor) => onChange(visitor(taxonomy));
  const updateNode = (id, patch) => updateTree((nodes) => mapTaxonomyNodes(nodes, (node) => node.id === id ? { ...node, ...patch } : node));
  const addChild = (parent) => {
    const level = Number(parent?.level || 1) + 1;
    if (!parent || level > 3) return;
    const child = { id: (level === 2 ? "secondary-" : parent.id + ".detail-") + Date.now(), name: level === 2 ? "新二级分类" : "新三级分类", keywords: "", color: parent.color || "#64748B", enabled: true, archived: false, trackInWeeklyReview: true, children: [] };
    updateTree((nodes) => mapTaxonomyNodes(nodes, (node) => node.id === parent.id ? { ...node, children: [...(node.children || []), child] } : node));
    setSelectedId(child.id);
  };
  const deleteOrArchive = (node) => {
    const referenced = referencedTokens.has(node.id) || referencedTokens.has(node.name);
    if (referenced) {
      updateNode(node.id, { archived: true, archivedAt: todayIsoDate() });
      return;
    }
    updateTree((nodes) => removeTaxonomyNode(nodes, node.id));
    setSelectedId(flat.find((item) => item.id !== node.id)?.id || "");
  };
  const moveNode = (node, direction) => updateTree((nodes) => moveTaxonomyNode(nodes, node.id, direction));
  const reorderNode = (target) => {
    if (!dragging || dragging.id === target.id || dragging.parentId !== target.parentId || dragging.level !== target.level) return;
    updateTree((nodes) => reorderTaxonomyNode(nodes, dragging.id, target.id));
    setDragging(null);
  };
  return <div className="settings-block taxonomy-manager-block"><strong>复盘与排程分类</strong><p className="field-help">左侧管理分类树，右侧只编辑当前选中的一个分类。</p><div className="taxonomy-manager-grid"><div className="taxonomy-tree-panel"><div className="taxonomy-tree-toolbar"><button className="secondary-button compact" type="button" onClick={() => { const item = { id: "primary-" + Date.now(), name: "新一级分类", color: "#64748B", children: [] }; onChange([...taxonomy, item]); setSelectedId(item.id); }}>添加一级分类</button><button className="secondary-button compact" type="button" onClick={() => onChange(normalizeClassificationTaxonomy([]))}>恢复默认</button></div><div className="taxonomy-tree-list">{taxonomy.map((node) => <TaxonomyTreeNode key={node.id} node={node} level={1} selectedId={selected?.id} dragging={dragging} onSelect={setSelectedId} onAddChild={addChild} onDragStart={setDragging} onDrop={reorderNode} />)}</div></div><div className="taxonomy-detail-panel">{selected ? <TaxonomyDetail node={selected} canAddChild={selected.level < 3} isLeaf={!Array.isArray(selected.children) || selected.children.length === 0} onChange={(patch) => updateNode(selected.id, patch)} onAddChild={() => addChild(selected)} onMove={(direction) => moveNode(selected, direction)} onDelete={() => deleteOrArchive(selected)} /> : <div className="empty-text">请先选择左侧分类。</div>}</div></div></div>;
}

function mapTaxonomyNodes(nodes = [], mapper) {
  return nodes.map((node) => mapper({ ...node, children: mapTaxonomyNodes(node.children || [], mapper) }));
}

function removeTaxonomyNode(nodes = [], id) {
  return nodes.filter((node) => node.id !== id).map((node) => ({ ...node, children: removeTaxonomyNode(node.children || [], id) }));
}

function moveTaxonomyNode(nodes = [], id, direction) {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) return nodes;
    const next = [...nodes];
    [next[index], next[target]] = [next[target], next[index]];
    return next.map((node, order) => ({ ...node, order }));
  }
  return nodes.map((node) => ({ ...node, children: moveTaxonomyNode(node.children || [], id, direction) }));
}

function reorderTaxonomyNode(nodes = [], fromId, toId) {
  const from = nodes.findIndex((node) => node.id === fromId);
  const to = nodes.findIndex((node) => node.id === toId);
  if (from >= 0 && to >= 0) {
    const next = [...nodes];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next.map((node, order) => ({ ...node, order }));
  }
  return nodes.map((node) => ({ ...node, children: reorderTaxonomyNode(node.children || [], fromId, toId) }));
}

function TaxonomyTreeNode({ node, level, selectedId, onSelect, onAddChild, onDragStart, onDrop }) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  return <details className="taxonomy-tree-node" open><summary onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop({ ...node, level, parentId: node.parentId || "" })}><button className="drag-handle" type="button" draggable onDragStart={() => onDragStart({ id: node.id, level, parentId: node.parentId || "" })}><GripVertical size={15} /></button><button className={selectedId === node.id ? "taxonomy-node-label active" : "taxonomy-node-label"} type="button" onClick={() => onSelect(node.id)}><span>{taxonomyNodeLabel(node)}</span><small>{levelText(level)}{node.archived ? " · 已归档" : node.enabled === false ? " · 未启用" : ""}</small></button>{level < 3 && <button className="secondary-button compact" type="button" onClick={() => onAddChild({ ...node, level })}>添加子分类</button>}</summary>{hasChildren && <div className="taxonomy-tree-children">{node.children.map((child) => <TaxonomyTreeNode key={child.id} node={{ ...child, parentId: node.id }} level={level + 1} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} onDragStart={onDragStart} onDrop={onDrop} />)}</div>}</details>;
}

function levelText(level) {
  return { 1: "一级", 2: "二级", 3: "三级" }[level] || "分类";
}

function toggleTaxonomyArchived(node, nextArchived, todayIso) {
  return nextArchived
    ? { archived: true, archivedAt: todayIso }
    : { archived: false, archivedAt: "" };
}

// A leaf is any node with no children — same definition used everywhere else
// (isLeafTaxonomyNode in taxonomyContract.js). Only leaves get a 每日复盘 block:
// group headings (nodes with children) never render duration/progress/adjustment
// inputs directly.
function TaxonomyReviewConfigFields({ node, onChange }) {
  const config = node.reviewConfig || { enabled: false, recordDuration: false, recordProgress: false, recordAdjustment: false, defaultMinutes: 0 };
  const update = (patch) => onChange({ reviewConfig: { ...config, ...patch } });
  return (
    <div className="taxonomy-review-config">
      <p className="field-help">每日复盘</p>
      <div className="two-column-fields">
        <label className="mini-check">
          <input type="checkbox" checked={config.enabled === true} onChange={(event) => update({ enabled: event.target.checked })} />
          在每日复盘中显示
        </label>
        <label className="mini-check">
          <input type="checkbox" checked={config.recordDuration === true} disabled={!config.enabled} onChange={(event) => update({ recordDuration: event.target.checked })} />
          记录时长
        </label>
        <label className="mini-check">
          <input type="checkbox" checked={config.recordProgress === true} disabled={!config.enabled} onChange={(event) => update({ recordProgress: event.target.checked })} />
          记录今日推进
        </label>
        <label className="mini-check">
          <input type="checkbox" checked={config.recordAdjustment === true} disabled={!config.enabled} onChange={(event) => update({ recordAdjustment: event.target.checked })} />
          记录今日调整
        </label>
      </div>
      <label className="field">
        <span>默认时长（分钟，今日新增该项时应用一次）</span>
        <input
          type="number"
          min="0"
          step="5"
          disabled={!config.enabled || !config.recordDuration}
          value={config.defaultMinutes || ""}
          placeholder="不设置默认时长"
          onChange={(event) => update({ defaultMinutes: event.target.value === "" ? 0 : Math.max(0, Number(event.target.value) || 0) })}
        />
      </label>
    </div>
  );
}

function TaxonomyDetail({ node, canAddChild, isLeaf, onChange, onAddChild, onMove, onDelete }) {
  const todayIso = todayIsoDate();
  const handleArchiveToggle = (nextArchived) => onChange(toggleTaxonomyArchived(node, nextArchived, todayIso));
  const confirmArchive = () => {
    const message = isLeaf
      ? "归档后，新日期的每日复盘和新排程都不会再显示这一项；已有历史记录（含当时的名称和颜色）不会被删除，随时可以恢复。确认归档吗？"
      : "这是一个分组，归档会连同它下面的所有子分类一起归档。新日期的每日复盘和新排程都不会再显示它们；已有历史记录不会被删除，随时可以恢复。确认归档整棵子树吗？";
    if (window.confirm(message)) handleArchiveToggle(true);
  };
  return (
    <div className="taxonomy-detail-card">
      <div className="panel-title">
        <div>
          <p className="eyebrow">{levelText(node.level)}</p>
          <h3>{taxonomyNodeLabel(node)}</h3>
        </div>
        <span className={node.archived ? "status-pill muted" : "status-pill ok"}>{node.archived ? "已归档" : "正常"}</span>
      </div>
      <TextField label="名称" value={node.name || ""} onChange={(name) => onChange({ name })} />
      <label className="field"><span>颜色</span><input type="color" value={node.color || "#64748B"} onChange={(event) => onChange({ color: event.target.value })} /></label>
      <label className="field"><span>关键词</span><textarea value={node.keywords || ""} onChange={(event) => onChange({ keywords: event.target.value })} placeholder="用逗号分隔，用于复盘识别" /></label>
      <div className="two-column-fields">
        <label className="mini-check"><input type="checkbox" checked={node.enabled !== false} onChange={(event) => onChange({ enabled: event.target.checked })} />启用</label>
        <label className="mini-check"><input type="checkbox" checked={node.archived === true} onChange={(event) => event.target.checked ? confirmArchive() : handleArchiveToggle(false)} />归档</label>
        <label className="mini-check"><input type="checkbox" checked={node.trackInWeeklyReview !== false} onChange={(event) => onChange({ trackInWeeklyReview: event.target.checked })} />进入周大表</label>
      </div>
      {isLeaf && <TaxonomyReviewConfigFields node={node} onChange={onChange} />}
      <div className="button-row">
        {canAddChild && <button className="secondary-button compact" type="button" onClick={onAddChild}>添加子分类</button>}
        <button className="secondary-button compact" type="button" onClick={() => onMove(-1)}>上移</button>
        <button className="secondary-button compact" type="button" onClick={() => onMove(1)}>下移</button>
        <button className="secondary-button compact" type="button" onClick={() => node.archived ? handleArchiveToggle(false) : confirmArchive()}>{node.archived ? "恢复" : "归档"}</button>
        <button className="secondary-button compact danger-text" type="button" onClick={onDelete}>删除</button>
      </div>
      <details className="advanced-info">
        <summary>高级信息</summary>
        <code>{(node.labelPath || [taxonomyNodeLabel(node)]).join(" > ")}</code>
      </details>
    </div>
  );
}

function ListPanel({ items, render }) {
  return <div className="table-panel">{items.map(render)}</div>;
}

function NumberField({ label, value, onChange, step = 5 }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min="0" step={step} value={value ?? 0} onChange={(event) => onChange(Math.max(0, toNumber(event.target.value)))} />
    </label>
  );
}

function TextField({ label, value, onChange, required, type = "text", placeholder = "" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value || ""} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, labelText]) => <option key={id} value={id}>{labelText}</option>)}
      </select>
    </label>
  );
}

function displayDays(value) {
  if (value === Infinity) return "暂时无法估算";
  if (value <= 0) return "现在";
  return `${value} 天`;
}

function rarityText(value) {
  return { common: "普通", rare: "稀有", epic: "史诗", legendary: "传说" }[value] || "普通";
}

function priorityText(value) {
  return { low: "低优先", medium: "中优先", high: "高优先" }[value] || "中优先";
}

function statusText(value) {
  return { available: "可用", wishlist: "愿望单", paused: "暂缓", redeemed: "已兑换" }[value] || "可用";
}

function developmentTypeText(value) {
  return { feature: "功能", theme: "外观", data: "统计", polish: "体验优化" }[value] || "功能";
}

function developmentPlanCost(plan) {
  if (plan?.kind === "bug") return 1;
  return Math.max(1, Math.ceil(legacyDevelopmentMinutes(plan) / 15));
}

function legacyDevelopmentMinutes(plan) {
  const minutes = Number(plan?.estimatedMinutes || 0);
  if (minutes > 0) return minutes;
  return { micro: 15, small: 30 }[plan?.size] || 15;
}

function sleepLabel(value) {
  return sleepAdjustmentOptions.find((option) => option.value === Number(value))?.label || "睡眠积分未设置";
}
