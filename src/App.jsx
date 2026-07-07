import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Coins,
  Copy,
  Download,
  Edit3,
  Gamepad2,
  Gift,
  History,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  Plus,
  Palette,
  Save,
  Settings,
  Sparkles,
  Target,
  Trash2,
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
  rollbackSettlementsTo,
  saveCategory,
  saveDevelopmentPlan,
  saveDiaryEntry,
  saveEntertainmentLog,
  saveMathProgressRecord,
  saveProfessionalProgressRecord,
  saveBookEntry,
  saveProduct,
  saveProfileSettings,
  syncDiaryFromSettlement,
  syncReadingFromSettlement,
  subscribeUserData,
} from "./services/dataService";
import { loadDemoData, saveDemoData } from "./services/demoStore";
import {
  calculateBankPointsAdded,
  calculateDaysLeft,
  calculateFreeEntertainmentScore,
  DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
  calculateGeneratedMinutes,
  estimateDaysToCart,
  estimateDaysToProduct,
  formatDateOnly,
  formatDateTime,
  intensityPresets,
  round1,
  toNumber,
} from "./utils/calculations";
import { parseReviewMarkdown } from "./utils/reviewParser";
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

const defaultScheduleAssistantSettings = {
  defaultWakeUpTime: "07:30",
  defaultBedTime: "23:20",
  defaultScene: "uncertain",
  defaultLunchBlockMinutes: 90,
  defaultStartupBufferMinutes: 20,
  defaultFormalRestMinutes: 30,
  defaultFormalRestBlocks: 1,
  defaultMorningPrepMinutes: 20,
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
};

function makeDemoUser() {
  return {
    uid: "demo-user",
    displayName: "Claire",
    email: "本地演示模式，配置 Firebase 后启用云同步",
    photoURL: "",
    isDemo: true,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [user, setUser] = useState(isFirebaseConfigured ? null : makeDemoUser());
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [toast, setToast] = useState("");
  const [data, setData] = useState(() => (isFirebaseConfigured ? null : loadDemoData()));

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
      setData(nextData);
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
        createSettlement: (settlement) => createSettlement(user.uid, settlement),
        deleteLatestSettlement: (settlement, fallbackProfile) => deleteLatestSettlement(user.uid, settlement, fallbackProfile),
        rollbackSettlementsTo: (settlementsToDelete, targetSettlement) => rollbackSettlementsTo(user.uid, settlementsToDelete, targetSettlement),
        deleteLatestRedemption: (redemption, product) => deleteLatestRedemption(user.uid, redemption, product),
        saveMathProgress: (record) => saveMathProgressRecord(user.uid, record),
        saveProfessionalProgress: (record) => saveProfessionalProgressRecord(user.uid, record),
        saveProfileSettings: (settings) => saveProfileSettings(user.uid, settings),
        completeScheduleSegmentGoal: (goalEntry) => completeScheduleSegmentGoal(user.uid, goalEntry, goalEntry.rewardPointsAdded),
        saveDiaryEntry: (entry) => saveDiaryEntry(user.uid, entry),
        syncDiaryFromSettlement: (entry, strategy) => syncDiaryFromSettlement(user.uid, entry, strategy),
        syncReadingFromSettlement: (reading) => syncReadingFromSettlement(user.uid, reading),
        saveBookEntry: (book) => saveBookEntry(user.uid, book),
      };
    }

    const updateDemo = (updater) => {
      setData((current) => {
        const next = updater(structuredClone(current));
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
          current.profile.updatedAt = new Date().toISOString();
          current.settlements.unshift({ ...settlement, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
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
                language: /[A-Za-z]/.test(title) && !/[\u4e00-\u9fa5]/.test(title) ? "en" : "zh",
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

  async function handleSettlementSubmit(settlement, diaryOptions) {
    try {
      await actions.createSettlement(settlement);
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
    }
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
          />
        )}
        {activeTab === "settlement" && (
          <Settlement
            data={data}
            profile={data.profile}
            settlements={data.settlements}
            onSaveMathProgress={(records) =>
              runAction(() => Promise.all(records.map((record) => actions.saveMathProgress(record))), `已同步 ${records.length} 个数学进度打卡。`)
            }
            onSaveProfessionalProgress={(records) =>
              runAction(() => Promise.all(records.map((record) => actions.saveProfessionalProgress(record))), `已同步 ${records.length} 个专业课进度打卡。`)
            }
            diaryEntries={data.diaryEntries || []}
            onSubmit={handleSettlementSubmit}
          />
        )}
        {activeTab === "schedule" && (
          <ScheduleAssistant
            data={data}
            onSaveProfile={(settings) => actions.saveProfileSettings(settings)}
          />
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
          <SettingsPage profile={data.profile} onSave={(settings) => runAction(() => actions.saveProfileSettings(settings), "设置已保存，小椰会按新的边界帮你记账。")} />
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
  const total = currentPoints + settlement.pointsAdded;
  const extras = [
    settlement.sleepAdjustmentPoints ? `睡眠 ${settlement.sleepAdjustmentPoints > 0 ? "+" : ""}${settlement.sleepAdjustmentPoints}` : "",
    settlement.exerciseBonusPoints ? `运动 +${settlement.exerciseBonusPoints}` : "",
    settlement.reviewTimelinessBonus ? `当天复盘 +${settlement.reviewTimelinessBonus}` : "",
    settlement.entertainmentScoreDelta ? `自由娱乐 ${settlement.entertainmentScoreDelta > 0 ? "+" : ""}${settlement.entertainmentScoreDelta}` : "",
  ].filter(Boolean);
  const bonusText = extras.length ? `，含${extras.join("、")}分` : "";
  return `结算完成：今日生成价值 ${settlement.generatedMinutes}min，转入 ${settlement.pointsAdded} 分${bonusText}。自由娱乐 ${settlement.totalEntertainmentMinutes || 0}/${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min。当前银行 ${total} 分。`;
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
        <span>{profile.points || 0}</span>
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

function Dashboard({ data, setActiveTab, onCompleteScheduleSegmentGoal }) {
  const profile = data.profile;
  const recentSettlement = data.settlements[0];
  const entertainment = entertainmentSnapshot(data);
  const segmentGoalState = buildTodaySegmentGoalState(data);

  return (
    <section className="dashboard-home">
      <div className="dashboard-metrics">
        <StatCard icon={Coins} title="奖励银行" value={`${profile.points || 0} 分`} text="用来兑换商场里的阶段性战利品。" tone="coin" />
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
                <strong>+{recentSettlement.pointsAdded} 分</strong>
                <span>{recentSettlement.dayTypeDisplayName || dayTypeLabels[recentSettlement.nextDayEntertainmentSourceDayType] || "已结算"} · 自由娱乐 {recentSettlement.totalEntertainmentMinutes || 0}/{DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min</span>
                <small>{formatDateTime(recentSettlement.createdAt)}</small>
              </div>
            ) : (
              <p className="empty-text">还没有结算记录。第一次复盘后，奖励银行就会亮起来。</p>
            )}
          </div>
        </div>
      </div>
    </section>
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
  return Boolean(reviewDate && reviewDate === todayIsoDate() && minutesSinceMidnight() >= 4 * 60);
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

function Settlement({ data, profile, settlements, diaryEntries = [], onSubmit, onSaveMathProgress, onSaveProfessionalProgress }) {
  const [reviewMarkdown, setReviewMarkdown] = useState("");
  const [parseSummary, setParseSummary] = useState("");
  const [catMessage, setCatMessage] = useState("");
  const [progressDate, setProgressDate] = useState(new Date().toISOString().slice(0, 10));
  const [detectedMathProgress, setDetectedMathProgress] = useState([]);
  const [detectedProfessionalProgress, setDetectedProfessionalProgress] = useState([]);
  const [diaryDraft, setDiaryDraft] = useState(null);
  const [syncDiary, setSyncDiary] = useState(true);
  const [diaryConflictStrategy, setDiaryConflictStrategy] = useState("overwrite");
  const [detectedProgressMode, setDetectedProgressMode] = useState({ course: true, exercise: false, useDate: true });
  const [form, setForm] = useState({
    studyMinutes: 450,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 0.5,
    actualGameMinutesToday: 0,
    beneficialMinutes: 0,
    totalEntertainmentMinutes: 0,
    recognizedEntertainmentMinutes: 0,
    entertainmentFenceNote: "",
    reviewDate: todayIsoDate(),
    note: "",
  });
  const detail = calculateGeneratedMinutes(form);
  const dayClassification = classifyDay({ ...form, totalEntertainmentMinutes: detail.totalEntertainmentMinutes });
  const bankPointsAdded = calculateBankPointsAdded(detail.availableMinutes);
  const reviewTimelinessBonus = isTodayReview(form.reviewDate) ? 1 : 0;
  const sleepAdjustmentPoints = Number(detail.sleepAdjustment || 0);
  const exerciseBonusPoints = Number(detail.exerciseBonusPoints || 0);
  const entertainmentScore = calculateFreeEntertainmentScore(detail.totalEntertainmentMinutes);
  const entertainmentPenalty = {
    overLimitMinutes: entertainmentScore.overtimeMinutes,
    penaltyPoints: Math.max(0, -entertainmentScore.scoreDelta),
    label: entertainmentScore.label,
  };
  const pointsAdded = round1(bankPointsAdded + sleepAdjustmentPoints + exerciseBonusPoints + reviewTimelinessBonus + entertainmentScore.scoreDelta);
  const existingDiary = diaryEntries.find((entry) => entry.date === form.reviewDate);
  const diaryHasManualConflict = Boolean(existingDiary && (existingDiary.manuallyEdited || existingDiary.source === "manual"));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function importReviewMarkdown() {
    const parsed = parseReviewMarkdown(reviewMarkdown, { miscTags: profile.miscTags || [] });
    const detected = extractMathProgressFromReview(parsed);
    const detectedProfessional = extractProfessionalProgressFromReview(parsed);
    const parsedDate = parsed.reviewDate || todayIsoDate();
    const parsedDiary = parseDiaryFromMarkdown(reviewMarkdown, parsedDate);
    const reviewMinutes = Number(parsed.totalEntertainmentMinutes || 0);
    setForm((current) => ({
      ...current,
      studyMinutes: parsed.studyMinutes || current.studyMinutes,
      exerciseMinutes: parsed.exerciseMinutes,
      exerciseIntensity: parsed.exerciseIntensity,
      sleepAdjustment: parsed.sleepAdjustment,
      actualGameMinutesToday: parsed.actualGameMinutesToday,
      beneficialMinutes: parsed.beneficialMinutes,
      totalEntertainmentMinutes: reviewMinutes,
      recognizedEntertainmentMinutes: reviewMinutes,
      entertainmentFenceNote: "",
      note: parsed.note || current.note,
      rawReview: parsed.rawReview,
      subjects: parsed.subjects,
      readingMinutes: parsed.readingMinutes,
      readingBookTitle: parsed.readingBookTitle,
      readingFeeling: parsed.readingFeeling,
      readingSessions: parsed.readingSessions,
      state: parsed.state,
      wakeTime: parsed.wakeTime,
      sleepDuration: parsed.sleepDuration,
      lateSleepReason: parsed.lateSleepReason,
      reviewDate: parsedDate,
      parsedBedtime: parsed.bedtime,
      parsedSleepAdjustmentLabel: parsed.sleepAdjustmentLabel,
    }));
    setProgressDate(parsed.reviewDate || new Date().toISOString().slice(0, 10));
    setParseSummary(
      `已识别：日期 ${parsedDate}，学习 ${parsed.studyMinutes || 0}min，阅读 ${parsed.readingMinutes || 0}min，运动 ${parsed.exerciseMinutes || 0}min，${parsed.sleepAdjustmentLabel}，复盘写到娱乐 ${reviewMinutes}min。`
    );
    setDetectedMathProgress(detected);
    setDetectedProfessionalProgress(detectedProfessional);
    setDiaryDraft(parsedDiary);
    setSyncDiary(Boolean(parsedDiary?.content));
    setDiaryConflictStrategy("overwrite");
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
      reviewTimelinessBonus,
      entertainmentOverLimitMinutes: entertainmentPenalty.overLimitMinutes,
      entertainmentPenaltyPoints: entertainmentPenalty.penaltyPoints,
      entertainmentPenaltyLabel: entertainmentPenalty.label,
      entertainmentScoreDelta: entertainmentScore.scoreDelta,
      entertainmentScoreLabel: entertainmentScore.label,
      pointsAdded,
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
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={importReviewMarkdown}>识别复盘</button>
          <button className="secondary-button" type="button" onClick={() => { setReviewMarkdown(""); setParseSummary(""); setDetectedMathProgress([]); setDetectedProfessionalProgress([]); setDiaryDraft(null); }}>清空粘贴区</button>
        </div>
        {parseSummary && <div className="parse-summary">{parseSummary}</div>}
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

        <NumberField label="有效学习分钟" value={form.studyMinutes} onChange={(value) => update("studyMinutes", value)} />
        <NumberField label="运动分钟" value={form.exerciseMinutes} onChange={(value) => update("exerciseMinutes", value)} />
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
            <span>复盘识别娱乐</span>
            <strong>{form.recognizedEntertainmentMinutes || 0} min</strong>
            <small>每日固定自由娱乐额度 {DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min。默认按复盘识别值入账，若你想手动修正，就直接改下面的实际娱乐分钟。</small>
          </div>
          <span className="settlement-limit-badge">按90min加扣分</span>
        </div>
        <NumberField label="实际娱乐分钟" value={form.totalEntertainmentMinutes} onChange={(value) => update("totalEntertainmentMinutes", value)} />
        <TextField label="修正原因（可空）" value={form.entertainmentFenceNote} onChange={(value) => update("entertainmentFenceNote", value)} />
        <p className="field-help">如果复盘里漏写了，或者你想按回忆修正真实娱乐时间，就在这里直接改。系统会按固定90min自由娱乐额度计算加扣分。</p>
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

      <aside className="settlement-summary">
        <div className="summary-card big">
          <span>当日生成时间价值</span>
          <strong>{detail.generatedMinutes} min</strong>
          <p>不再分配明日娱乐额度，直接按 10min = 1分 转入奖励银行。</p>
        </div>
        <FormulaLine label="学习入账" value={`${detail.studyCredit} min`} />
        <FormulaLine label="运动入账" value={`${detail.exerciseCredit} min`} />
        <FormulaLine label="睡眠积分" value={`${detail.sleepAdjustment >= 0 ? "+" : ""}${detail.sleepAdjustment} 分`} />
        <FormulaLine label="运动额外积分" value={`${detail.exerciseBonusPoints ? "+1 分" : "0 分"}`} />
        <FormulaLine label="自由娱乐" value={`${detail.totalEntertainmentMinutes}/${DAILY_FREE_ENTERTAINMENT_LIMIT_MIN} min`} />
        <FormulaLine label="娱乐超时" value={entertainmentPenalty.overLimitMinutes > 0 ? `${entertainmentPenalty.overLimitMinutes} min` : "未超时"} />
        <FormulaLine label="娱乐积分" value={`${entertainmentScore.scoreDelta > 0 ? "+" : ""}${entertainmentScore.scoreDelta} 分`} />
        <FormulaLine label="当天复盘奖励" value={`+${reviewTimelinessBonus} 分`} />
        {!reviewTimelinessBonus && form.reviewDate === todayIsoDate() && minutesSinceMidnight() < 4 * 60 && (
          <p className="field-help">凌晨 00:00-03:59 视为补复盘窗口，不发当天复盘奖励。</p>
        )}
        <div className="summary-card">
          <span>今日类型</span>
          <strong>{dayClassification.displayName}</strong>
          <p>{dayClassification.reason}</p>
        </div>
        <div className="summary-card">
          <span>固定自由娱乐额度</span>
          <strong>{DAILY_FREE_ENTERTAINMENT_LIMIT_MIN} min</strong>
          <p>自由娱乐额度每天固定90min，不随日型变化。时间价值转入 {bankPointsAdded} 分，睡眠/运动/当天复盘另计，自由娱乐按“{entertainmentScore.label}”，总入账 {pointsAdded} 分。</p>
        </div>
      </aside>
    </section>
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

function ScheduleAssistant({ data, onSaveProfile }) {
  const autoContext = useMemo(() => buildScheduleAutoContext(data), [data]);
  const [settings, setSettings] = useState(() => mergeScheduleSettings(data.profile.scheduleAssistantSettings));
  const [draft, setDraft] = useState(() => makeScheduleDraft(data.profile.scheduleAssistantDraft, data.profile.scheduleAssistantSettings, autoContext));
  const [generatedPrompt, setGeneratedPrompt] = useState(() => shouldReuseScheduleDraft(data.profile.scheduleAssistantDraft, autoContext) ? data.profile.scheduleAssistantDraft?.generatedPrompt || "" : "");
  const [saveState, setSaveState] = useState("已载入");
  const initializedRef = useRef(false);
  const saveProfileRef = useRef(onSaveProfile);

  useEffect(() => {
    saveProfileRef.current = onSaveProfile;
  }, [onSaveProfile]);

  useEffect(() => {
    const nextSettings = mergeScheduleSettings(data.profile.scheduleAssistantSettings);
    setSettings(nextSettings);
    setDraft(makeScheduleDraft(data.profile.scheduleAssistantDraft, nextSettings, autoContext));
    setGeneratedPrompt(shouldReuseScheduleDraft(data.profile.scheduleAssistantDraft, autoContext) ? data.profile.scheduleAssistantDraft?.generatedPrompt || "" : "");
  }, [data.profile.id, autoContext.sourceReviewDate]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return undefined;
    }
    setSaveState("保存中...");
    const timer = window.setTimeout(async () => {
      try {
        await saveProfileRef.current({
          scheduleAssistantSettings: settings,
          scheduleAssistantDraft: { ...draft, segmentGoals, generatedPrompt, savedOn: beijingIsoDate(), updatedAt: new Date().toISOString() },
          scheduleSegmentGoals: upsertScheduleSegmentGoalEntry(data.profile.scheduleSegmentGoals, draft.targetDate, segmentGoals),
        });
        setSaveState("已自动保存");
      } catch {
        setSaveState("自动保存失败");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [settings, draft, generatedPrompt]);

  const selectedTemplate = settings.mathTemplates.find((item) => item.id === draft.mathTemplateId) || settings.mathTemplates[0];
  const selectedEnglishTemplate = settings.englishTemplates.find((item) => item.id === draft.englishTemplateId) || settings.englishTemplates[0];
  const englishSkills = resolveEnglishSkills(draft, settings, data.settlements, selectedEnglishTemplate);
  const effectiveMorningPrepMinutes = resolveMorningPrepMinutes(draft);
  const showerPlan = shouldScheduleShower(draft);
  const scheduleEstimate = estimateScheduleDuration(draft, selectedTemplate, selectedEnglishTemplate, effectiveMorningPrepMinutes, showerPlan);
  const segmentGoals = useMemo(() => buildSegmentGoals(scheduleEstimate.studyMinutes), [scheduleEstimate.studyMinutes]);

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
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
      defaultLunchBlockMinutes: Number(draft.lunchBlockMinutes || 90),
      defaultStartupBufferMinutes: Number(draft.startupBufferMinutes || 20),
      defaultFormalRestMinutes: Number(draft.formalRestMinutes || 30),
      defaultFormalRestBlocks: Number(draft.formalRestBlocks || 1),
      defaultMorningPrepMinutes: Number(draft.morningPrepMinutes || 20),
      defaultMathTemplateId: draft.mathTemplateId,
      defaultEnglishTemplateId: draft.englishTemplateId,
      defaultThesisMinutes: Number(draft.thesisMinutes || 90),
      defaultProfessionalMinutes: Number(draft.professionalMinutes || 50),
      defaultSystemDevelopmentLimit: draft.systemDevelopmentLimit,
      defaultRestPreference: draft.restPreference,
    }));
  }

  function addFixedEvent() {
    updateDraft("fixedEvents", [
      ...(draft.fixedEvents || []),
      { id: `event-${Date.now()}`, title: "", startTime: "", endTime: "", location: "", note: "" },
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
      showerPlan,
    });
    setGeneratedPrompt(prompt);
  }

  async function copyPrompt() {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setSaveState("已复制 prompt");
  }

  return (
    <section className="schedule-layout">
      <div className="panel wide schedule-hero">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Tomorrow Planner</p>
            <h2>明日排程助手</h2>
          </div>
          <Wand2 size={22} />
        </div>
        <p>小椰只整理情报、比例和边界，生成给 AI 的高质量排程请求；具体学哪一节，交给你和小椰当晚确认。</p>
        <div className="schedule-meta-row">
          <span>{saveState}</span>
          <span>复盘来源：{autoContext.sourceReviewDate || "暂无"}</span>
          <span>固定自由娱乐：{DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>系统自动读取</h2><History size={20} /></div>
        <div className="auto-read-list">
          <InfoLine label="今日类型" value={autoContext.dayTypeDisplayName} />
          <InfoLine label="判断原因" value={autoContext.dayTypeReason} />
          <InfoLine label="昨日运动" value={autoContext.previousDayExercised ? `${autoContext.previousDayExerciseMinutes}min` : "未运动 / 未记录"} />
          <InfoLine label="昨日睡眠" value={autoContext.sleepSummary} />
          <InfoLine label="最大卡点" value={autoContext.biggestBlocker || "未填写"} />
          <InfoLine label="明日调整" value={autoContext.tomorrowAdjustment || "未填写"} />
        </div>
      </div>

      <form className="panel form-panel" onSubmit={(event) => { event.preventDefault(); generatePrompt(); }}>
        <div className="panel-title"><h2>明日基础信息</h2><CalendarClock size={21} /></div>
        <TextField label="排程目标日期" value={draft.targetDate} onChange={(value) => updateDraft("targetDate", value)} />
        <div className="two-column-fields">
          <TextField label="计划起床时间" value={draft.wakeUpTime} onChange={(value) => updateDraft("wakeUpTime", value)} />
          <TextField label="目标上床时间" value={draft.targetBedTime} onChange={(value) => updateDraft("targetBedTime", value)} />
        </div>
        <SelectField label="明天场景" value={draft.scene} onChange={(value) => updateDraft("scene", value)} options={scheduleSceneOptions} />
        <SelectField label="是否有通勤" value={draft.commuteStatus} onChange={(value) => updateDraft("commuteStatus", value)} options={[["no", "否"], ["yes", "是"], ["uncertain", "不确定"]]} />
        <NumberField label="起床后到可学习地点准备时间" value={effectiveMorningPrepMinutes} onChange={(value) => updateDraft("morningPrepMinutes", value)} />
        <p className="field-help">如果场景是在校且不通勤，默认按 40min：洗漱20min + 到教室10min + 缓冲10min，不能起床后立刻安排学习。</p>
        <div className="two-column-fields">
          <NumberField label="午间时长分钟" value={draft.lunchBlockMinutes} onChange={(value) => updateDraft("lunchBlockMinutes", value)} />
          <NumberField label="启动缓冲分钟" value={draft.startupBufferMinutes} onChange={(value) => updateDraft("startupBufferMinutes", value)} />
        </div>
        <label className="field">
          <span>补充说明</span>
          <textarea value={draft.specialNotes} onChange={(event) => updateDraft("specialNotes", event.target.value)} placeholder="例如：下午可能出门 / 晚饭较晚 / 今天只要稳住主线" />
        </label>
        <div className="settings-block">
          <strong>固定事件</strong>
          {(draft.fixedEvents || []).map((eventItem) => (
            <div className="fixed-event-row" key={eventItem.id}>
              <input placeholder="事件" value={eventItem.title} onChange={(event) => updateFixedEvent(eventItem.id, "title", event.target.value)} />
              <input placeholder="开始" value={eventItem.startTime} onChange={(event) => updateFixedEvent(eventItem.id, "startTime", event.target.value)} />
              <input placeholder="结束" value={eventItem.endTime} onChange={(event) => updateFixedEvent(eventItem.id, "endTime", event.target.value)} />
              <button className="icon-button danger" type="button" onClick={() => deleteFixedEvent(eventItem.id)} aria-label="删除固定事件"><Trash2 size={16} /></button>
            </div>
          ))}
          <button className="secondary-button compact" type="button" onClick={addFixedEvent}>添加固定事件</button>
        </div>
        <button className="secondary-button" type="button" onClick={saveCurrentAsDefaults}>把当前填写保存为默认值</button>
      </form>

      <div className="panel">
        <div className="panel-title"><h2>数学比例</h2><Check size={21} /></div>
        <SelectField label="今日使用模板" value={draft.mathTemplateId} onChange={(value) => updateDraft("mathTemplateId", value)} options={settings.mathTemplates.map((template) => [template.id, template.name])} />
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

      <div className="panel">
        <div className="panel-title"><h2>英语 / 雅思</h2><Sparkles size={21} /></div>
        <SelectField label="今日英语模板" value={draft.englishTemplateId} onChange={(value) => updateDraft("englishTemplateId", value)} options={settings.englishTemplates.map((template) => [template.id, template.name])} />
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

      <div className="panel">
        <div className="panel-title"><h2>论文与专业课</h2><BookOpen size={21} /></div>
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
      </div>

      <div className="panel">
        <div className="panel-title"><h2>运动与边界</h2><Gamepad2 size={21} /></div>
        <div className="two-column-fields">
          <TextField label="运动类型" value={draft.exerciseType} onChange={(value) => updateDraft("exerciseType", value)} />
          <NumberField label="运动计划分钟" value={draft.exerciseMinutes} onChange={(value) => updateDraft("exerciseMinutes", value)} />
          <NumberField label="正式休息块数" value={draft.formalRestBlocks} onChange={(value) => updateDraft("formalRestBlocks", Math.max(1, Number(value || 1)))} />
          <NumberField label="每块休息分钟" value={draft.formalRestMinutes} onChange={(value) => updateDraft("formalRestMinutes", value)} />
        </div>
        <SelectField label="系统开发上限" value={draft.systemDevelopmentLimit} onChange={(value) => updateDraft("systemDevelopmentLimit", value)} options={systemDevelopmentLimitOptions} />
        <p className="field-help">正式休息娱乐只给排程留出时段，不指定形式：{draft.formalRestBlocks || 1}块 × {draft.formalRestMinutes || 0}min。</p>
        {autoContext.boundaryIssue && <p className="blocker-text">今日存在边界偏松/失控信号，建议系统开发最多 30min，22:00 后不碰复杂系统。</p>}
      </div>

      <div className="panel wide estimate-panel">
        <div className="panel-title"><h2>明日预估</h2><Target size={21} /></div>
        <div className="estimate-grid">
          <InfoLine label="预计纯学习时长" value={minutesLabel(scheduleEstimate.studyMinutes)} />
          <InfoLine label="上午累计目标" value={minutesLabel(segmentGoals.morning.targetMinutes)} />
          <InfoLine label="下午累计目标" value={minutesLabel(segmentGoals.afternoon.targetMinutes)} />
          <InfoLine label="晚上累计目标" value={minutesLabel(segmentGoals.evening.targetMinutes)} />
          <InfoLine label="运动 / 恢复" value={minutesLabel(scheduleEstimate.exerciseMinutes)} />
          <InfoLine label="正式休息娱乐" value={minutesLabel(scheduleEstimate.formalRestMinutes)} />
          {scheduleEstimate.weeklyReviewMinutes > 0 && <InfoLine label="周日总复盘" value={minutesLabel(scheduleEstimate.weeklyReviewMinutes)} />}
          <InfoLine label="洗澡安排" value={showerPlan.shouldShower ? `安排，${showerPlan.reason}` : `不默认安排，${showerPlan.reason}`} />
          <InfoLine label="生活 / 收束 / 准备" value={minutesLabel(scheduleEstimate.lifeMinutes)} />
          <InfoLine label="全天已占用" value={minutesLabel(scheduleEstimate.totalOccupiedMinutes)} />
          <InfoLine label="状态" value={scheduleEstimate.warning} />
        </div>
      </div>

      <div className="panel wide">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Prompt</p>
            <h2>给小椰的排程请求</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={generatePrompt}>生成</button>
        </div>
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
      </div>
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

function mergeScheduleSettings(saved = {}) {
  const savedEnglish = saved.englishRotationSettings || {};
  const mathTemplates = Array.isArray(saved.mathTemplates) && saved.mathTemplates.length ? saved.mathTemplates : defaultMathTemplates;
  const englishTemplates = Array.isArray(saved.englishTemplates) && saved.englishTemplates.length ? saved.englishTemplates : defaultEnglishTemplates;
  return {
    ...defaultScheduleAssistantSettings,
    ...saved,
    mathTemplates,
    englishTemplates,
    englishRotationSettings: {
      ...defaultScheduleAssistantSettings.englishRotationSettings,
      ...savedEnglish,
      enabledSkills: savedEnglish.enabledSkills?.length ? savedEnglish.enabledSkills : defaultScheduleAssistantSettings.englishRotationSettings.enabledSkills,
    },
  };
}

function makeScheduleDraft(saved = {}, rawSettings = {}, autoContext = {}) {
  const settings = mergeScheduleSettings(rawSettings);
  const defaultTargetDate = autoContext.sourceReviewDate ? shiftIsoDate(autoContext.sourceReviewDate, 1) : beijingIsoDate(1);
  const shouldReuseSaved = shouldReuseScheduleDraft(saved, autoContext);
  const defaultSystemLimit = autoContext.boundaryIssue ? "max_30" : settings.defaultSystemDevelopmentLimit;
  const defaultRest = settings.defaultRestPreference;
  const baseDraft = {
    targetDate: defaultTargetDate,
    sourceReviewDate: autoContext.sourceReviewDate || "",
    wakeUpTime: settings.defaultWakeUpTime,
    targetBedTime: settings.defaultBedTime,
    scene: settings.defaultScene,
    fixedEvents: [],
    commuteStatus: "uncertain",
    commuteNote: "",
    specialNotes: "",
    lunchBlockMinutes: settings.defaultLunchBlockMinutes,
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
    restPreference: defaultRest,
    systemDevelopmentLimit: defaultSystemLimit,
    generatedPrompt: "",
  };
  return {
    ...baseDraft,
    ...(shouldReuseSaved ? saved : {}),
    targetDate: shouldReuseSaved && saved.targetDate ? saved.targetDate : defaultTargetDate,
    sourceReviewDate: autoContext.sourceReviewDate || "",
    thesisNote: shouldReuseSaved && saved.thesisNote ? saved.thesisNote : baseDraft.thesisNote,
    professionalNote: shouldReuseSaved && saved.professionalNote ? saved.professionalNote : baseDraft.professionalNote,
  };
}

function shouldReuseScheduleDraft(saved = {}, autoContext = {}) {
  return Boolean(
    saved &&
    saved.sourceReviewDate &&
    saved.sourceReviewDate === autoContext.sourceReviewDate &&
    saved.savedOn === beijingIsoDate()
  );
}

function buildScheduleAutoContext(data) {
  const todaySettlement = (data.settlements || []).find((item) => item.reviewDate === todayIsoDate());
  const source = todaySettlement || data.settlements?.[0] || {};
  const subjects = source.subjects || {};
  const state = source.state || {};
  const boundaryIssue = /边界|失控|修复/.test(source.dayTypeDisplayName || dayTypeLabels[source.nextDayEntertainmentSourceDayType] || "");
  const sleepSummary = [source.sleepDuration, state.sleepImpact ? `睡眠影响${state.sleepImpact}` : "", source.lateSleepReason ? `晚睡原因：${source.lateSleepReason}` : ""]
    .filter(Boolean)
    .join("，") || "未填写";
  return {
    source,
    sourceReviewDate: source.reviewDate || "",
    dayTypeDisplayName: source.dayTypeDisplayName || dayTypeLabels[source.nextDayEntertainmentSourceDayType] || "普通推进日",
    dayTypeReason: source.nextDayEntertainmentLimitReason || data.profile?.nextDayEntertainmentLimitReason || "没有找到日型判断结果，默认按普通学习日处理；自由娱乐额度固定90min。",
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    previousDayExerciseMinutes: Number(source.exerciseMinutes || 0),
    previousDayExercised: Number(source.exerciseMinutes || 0) > 0,
    sleepSummary,
    biggestBlocker: state.biggestBlocker || "",
    tomorrowAdjustment: state.tomorrowAdjustment || "",
    oneSentenceSummary: state.oneLineSummary || source.note || "",
    mathProgressText: summarizeItems(subjects.math?.progress),
    mathBlockers: summarizeItems(subjects.math?.blockers),
    thesisOutputText: summarizeItems(subjects.thesis?.progress),
    thesisAdjustmentText: summarizeItems(subjects.thesis?.blockers),
    englishText: summarizeItems([...(subjects.english?.progress || []), ...(subjects.ielts?.progress || [])]),
    ieltsAdjustment: summarizeItems(subjects.ielts?.blockers),
    econProgressText: summarizeItems(subjects.economy?.progress),
    econBlockers: summarizeItems(subjects.economy?.blockers),
    recentReadingTitle: data.books?.find((book) => book.status === "reading")?.title || data.readingSessions?.[0]?.bookTitle || "",
    totalEntertainmentMinutes: Number(source.totalEntertainmentMinutes || 0),
    boundaryIssue,
  };
}

function summarizeItems(items = []) {
  return (items || []).filter(Boolean).slice(0, 5).join("；");
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

function estimateScheduleDuration(draft, mathTemplate, englishTemplate, morningPrepMinutes, showerPlan = { shouldShower: false }) {
  const mathMinutes =
    Number(mathTemplate.lectureBlocks50 || 0) * 50 +
    Number(mathTemplate.exerciseBlocks50 || 0) * 50 +
    Number(mathTemplate.reviewBlocks30 || 0) * 30 +
    Number(mathTemplate.errorReviewBlocks50 || 0) * 50 +
    Number(mathTemplate.summaryBlocks30 || 0) * 30;
  const englishMinutes = Number(englishTemplate.wordMinutes || 0) + Number(englishTemplate.skillCount || 1) * Number(englishTemplate.skillMinutes || 0);
  const studyMinutes = mathMinutes + englishMinutes + Number(draft.thesisMinutes || 0) + Number(draft.professionalMinutes || 0);
  const exerciseMinutes = Number(draft.exerciseMinutes || 0);
  const formalRestMinutes = Number(draft.formalRestBlocks || 1) * Number(draft.formalRestMinutes || 0);
  const systemMinutes = { none: 0, max_30: 30, max_50: 50, only_if_mainlines_done: 30 }[draft.systemDevelopmentLimit] || 0;
  const showerMinutes = showerPlan.shouldShower ? 25 : 0;
  const weeklyReviewMinutes = isSundayDate(draft.targetDate) ? 30 : 0;
  const lifeMinutes =
    Number(morningPrepMinutes || 0) +
    Number(draft.lunchBlockMinutes || 0) +
    Number(draft.startupBufferMinutes || 0) +
    40 + // 晚饭
    showerMinutes +
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
  return { studyMinutes, exerciseMinutes, formalRestMinutes, systemMinutes, showerMinutes, weeklyReviewMinutes, lifeMinutes, totalOccupiedMinutes, warning };
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
  if ((draft.scene === "school" || draft.scene === "school_with_exercise") && draft.commuteStatus === "no") {
    return Number(draft.morningPrepMinutes || 0) <= 20 ? 40 : Number(draft.morningPrepMinutes || 40);
  }
  return Number(draft.morningPrepMinutes || 20);
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

function buildSchedulePrompt({ draft, autoContext, mathTemplate, englishTemplate, englishSkills, effectiveMorningPrepMinutes, scheduleEstimate, showerPlan }) {
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
【生活/收束/准备】${minutesLabel(scheduleEstimate.lifeMinutes)}
【全天已占用】${minutesLabel(scheduleEstimate.totalOccupiedMinutes)}
【容量判断】${scheduleEstimate.warning}

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

function WeeklySummary({ data }) {
  const summary = buildWeeklySummary(data.settlements, { miscTags: data.profile?.miscTags || [] });
  const [selectedInsight, setSelectedInsight] = useState(null);
  const allActivityKeys = summary.activityTotals.map((activity) => activity.key);
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
  const tableActivityTotals = summary.activityTotals.filter((activity) => tableActivityKeys.includes(activity.key));
  const studyMax = Math.max(1, ...summary.dailyRows.map((row) => Number(row.raw.studyMinutes || 0)));
  const visibleActivities = summary.activityTotals.filter((item) => item.minutes > 0 || ["studyMinutes", "exerciseMinutes", "totalEntertainmentMinutes"].includes(item.key));
  const distributionItems = buildWeeklyDistributionItems(summary.activityTotals);
  const kpiActivities = visibleActivities.filter((item) => item.key !== "studyMinutes");
  const kpiCards = [{ key: "studyMinutes", label: "总学习", minutes: summary.totals.studyMinutes }, ...kpiActivities];

  function resolveWeeklyTableKeys(state) {
    const selected = state.selected || [];
    const known = state.known || [];
    if (!known.length && !selected.length) return allActivityKeys;
    const storedKeys = selected.filter((key) => allActivityKeys.includes(key));
    const newKeys = allActivityKeys.filter((key) => !known.includes(key));
    const newMiscTagKeys = newKeys.filter((key) => key.startsWith("miscTag:"));
    const resolved = [...storedKeys, ...newMiscTagKeys];
    return resolved.length ? resolved : allActivityKeys;
  }

  function toggleWeeklyTableKey(key) {
    const next = tableActivityKeys.includes(key)
      ? tableActivityKeys.filter((item) => item !== key)
      : [...tableActivityKeys, key];
    if (!next.length) return;
    const nextState = { selected: next, known: allActivityKeys };
    setWeeklyTableState(nextState);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("yeye-weekly-table-keys", JSON.stringify(nextState));
    }
  }

  return (
    <section className="content-stack weekly-page">
      <div className="weekly-page-head">
        <div>
          <p className="eyebrow">Weekly Review</p>
          <h2>周复盘总览</h2>
        </div>
        <div className="weekly-head-actions">
          <span>{summary.range}</span>
          <button className="secondary-button compact" type="button" onClick={() => exportWeeklySummaryCsv(summary, tableActivityKeys)}>导出周报</button>
        </div>
      </div>

      <section className="weekly-hero-grid">
        <WeeklyDistributionCard items={distributionItems} />
        <div className="weekly-kpi-grid">
          {kpiCards.map((activity) => (
            <WeeklyKpiCard key={`weekly-kpi-${activity.key}`} activity={activity} days={summary.days} />
          ))}
        </div>
      </section>

      <section className="weekly-middle-grid">
        <WeeklyBarChart title="本周趋势（总学习时长）" rows={summary.dailyRows} valueKey="studyMinutes" max={studyMax} />
        <div className="panel state-panel weekly-state-card">
          <div className="panel-title"><h2>状态小结</h2><Sparkles size={20} /></div>
          <div className="state-grid">
            <StateMetric label="平均精力" value={summary.avgEnergy} />
            <StateMetric label="平均情绪" value={summary.avgMood} />
            <StateMetric label="学习质量" value={summary.avgStudyQuality} />
            <StateMetric label="执行稳定" value={summary.avgStability} />
          </div>
          <div className="impact-grid">
            <ImpactPills title="睡眠影响" counts={summary.sleepImpactCounts} />
            <ImpactPills title="手机干扰" counts={summary.phoneDistractionCounts} />
          </div>
        </div>
      </section>

      <section className="weekly-check-grid">
        <WeeklyContinuityPanel rows={summary.dailyRows} />
        <DayTypeLegend />
      </section>

      <div className="panel weekly-table-panel">
        <div className="panel-title weekly-table-title">
          <div>
            <h2>周时间大表</h2>
            <p className="record-hint">点击有时长的格子，可以查看当天该项目的推进和备注。</p>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => exportWeeklySummaryCsv(summary, tableActivityKeys)}>导出 CSV</button>
        </div>
        <div className="weekly-column-controls">
          {summary.activityTotals.map((activity) => (
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
              </tr>
            </thead>
            <tbody>
              {summary.dailyRows.map((row) => (
                <tr key={row.id || row.date}>
                  <th>{row.date}</th>
                  <td>{weekdayLabel(row.date)}</td>
                  {row.activities.filter((activity) => tableActivityKeys.includes(activity.key)).map((activity) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.dailyRows.length === 0 && <p className="empty-text">还没有可汇总的结算记录。</p>}
      </div>

      {selectedInsight && (
        <div className="panel insight-panel">
          <div className="panel-title">
            <h2>{selectedInsight.row.date} · {selectedInsight.activity.label}</h2>
            <button className="secondary-button compact" type="button" onClick={() => setSelectedInsight(null)}>收起</button>
          </div>
          <p className="record-hint">时长：{minutesLabel(selectedInsight.activity.minutes)}</p>
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
    </section>
  );
}

const weeklyDistributionColors = {
  math: "#7C83F6",
  economy: "#64C7B5",
  english: "#8DB7FF",
  ielts: "#C7A7FF",
  thesis: "#7BD6A5",
  japanese: "#F6A6C8",
  reading: "#59C3D1",
  exerciseMinutes: "#3FB9B1",
  work: "#F6C66F",
  misc: "#A6B1C2",
  totalEntertainmentMinutes: "#B48CF0",
};

const weeklyKpiIcons = {
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
  misc: "⌘",
  totalEntertainmentMinutes: "☁",
};

function buildWeeklyDistributionItems(activityTotals = []) {
  const included = new Set(["math", "economy", "english", "ielts", "thesis", "japanese", "reading", "exerciseMinutes", "work", "misc", "totalEntertainmentMinutes"]);
  return activityTotals
    .filter((item) => included.has(item.key))
    .map((item) => ({ ...item, color: weeklyDistributionColors[item.key] || "#A6B1C2" }))
    .filter((item) => Number(item.minutes || 0) > 0);
}

function WeeklyDistributionCard({ items }) {
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
          <p className="record-hint">占比为相对于本周已记录主要时间的比例。</p>
        </div>
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

function WeeklyKpiCard({ activity, days }) {
  const daily = days ? Math.round(Number(activity.minutes || 0) / days) : 0;
  return (
    <article className="weekly-kpi-card">
      <div className="kpi-icon">{weeklyKpiIcons[activity.key] || "▦"}</div>
      <span className="kpi-label">{activity.label}</span>
      <strong className="kpi-value">{minutesLabel(activity.minutes)}</strong>
      <span className="kpi-sub">日均 {minutesLabel(daily)}</span>
    </article>
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
  const activity = (row, key) => row.activities?.find((item) => item.key === key)?.minutes || 0;
  const breakDays = (predicate) => rows.filter(predicate).length;
  return [
    ["数学断线", breakDays((row) => activity(row, "math") <= 0)],
    ["英语断线", breakDays((row) => activity(row, "english") + activity(row, "ielts") <= 0)],
    ["论文断线", breakDays((row) => activity(row, "thesis") <= 0)],
    ["专业/经济断线", breakDays((row) => activity(row, "economy") <= 0)],
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
  high_quality_day: { label: "高质量推进日", className: "day-type-high" },
  normal_progress_day: { label: "普通推进日", className: "day-type-normal" },
  normal_progress_day_with_boundary_issue: { label: "边界偏松日", className: "day-type-loose" },
  low_state_but_kept_lines: { label: "保线日", className: "day-type-loose" },
  special_affairs_day: { label: "特殊事务日", className: "day-type-special" },
  loss_of_control_recovery_day: { label: "修复日", className: "day-type-repair" },
};

function getDayTypeMeta(row = {}) {
  const rawType = row.raw?.nextDayEntertainmentSourceDayType || row.raw?.dayType || "";
  const displayName = row.raw?.dayTypeDisplayName || row.dayType || "";
  if (dayTypeMeta[rawType]) return dayTypeMeta[rawType];
  if (/高质量/.test(displayName)) return dayTypeMeta.high_quality_day;
  if (/边界|保线|低状态/.test(displayName)) return dayTypeMeta.normal_progress_day_with_boundary_issue;
  if (/特殊/.test(displayName)) return dayTypeMeta.special_affairs_day;
  if (/修复|失控/.test(displayName)) return dayTypeMeta.loss_of_control_recovery_day;
  return dayTypeMeta.normal_progress_day;
}

function DayTypeBadge({ row }) {
  const meta = getDayTypeMeta(row);
  return <span className={`day-type-badge ${meta.className}`}>{meta.label}</span>;
}

function DayTypeLegend() {
  const items = [
    dayTypeMeta.high_quality_day,
    dayTypeMeta.normal_progress_day,
    dayTypeMeta.normal_progress_day_with_boundary_issue,
    dayTypeMeta.loss_of_control_recovery_day,
    dayTypeMeta.special_affairs_day,
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

function WeeklyBarChart({ title, rows, valueKey, max }) {
  return (
    <div className="panel chart-panel">
      <div className="panel-title"><h2>{title}</h2><Sparkles size={20} /></div>
      <div className="bar-chart">
        {rows.map((row) => {
          const value = Number(row.raw[valueKey] || 0);
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

function StateMetric({ label, value }) {
  const score = value === null || value === undefined ? null : Number(value);
  const width = score === null ? 0 : Math.min(100, Math.max(0, score * 10));
  return (
    <div className="state-metric">
      <span>{label}</span>
      <strong>{score === null ? "暂无" : `${score}/10`}</strong>
      <div className="mini-meter"><i style={{ width: `${width}%` }} /></div>
    </div>
  );
}

function ImpactPills({ title, counts }) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="impact-card">
      <strong>{title}</strong>
      <div className="impact-pills">
        {entries.map(([label, count]) => <span key={`${title}-${label}`}>{label} × {count}</span>)}
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
    const englishText = [english?.progress?.join("；"), english?.summary].filter(Boolean).join("；");
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

function Records({ data, onDeleteSettlement, onRollbackSettlements, onDeleteRedemption, onSyncDiary }) {
  const latestSettlement = data.settlements[0];
  const previousSettlement = data.settlements[1];
  const latestRedemption = data.redemptions[0];
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
              <strong>+{item.pointsAdded} 分 · 生成 {item.generatedMinutes}min</strong>
              <span>
                学习 {item.studyMinutes}min / 入账 {item.studyCredit}min · 自由娱乐 {item.totalEntertainmentMinutes ?? (Number(item.beneficialMinutes || 0) + Number(item.actualGameMinutesToday || 0))}/{item.freeEntertainmentLimitMinutes || DAILY_FREE_ENTERTAINMENT_LIMIT_MIN}min
                {Number(item.reviewTimelinessBonus || 0) > 0 && ` · 当天复盘 +${item.reviewTimelinessBonus}分`}
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
            <div><strong>{item.productName}</strong><span>-{item.price} 分 · 剩余 {item.remainingPoints ?? "未知"} 分{item.type === "entertainment_extension" ? ` · 仅 ${item.date || "当天"} 有效` : ""}</span></div>
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
    </section>
  );
}

function SettingsPage({ profile, onSave }) {
  const [form, setForm] = useState({
    displayName: profile.displayName || "Claire",
    points: profile.points || 0,
    defaultTomorrowGameMinutes: profile.defaultTomorrowGameMinutes || 30,
    beneficialProtectionMinutes: profile.beneficialProtectionMinutes || 60,
    miscTags: profile.miscTags || [],
    dashboardGoalTitle: profile.dashboardGoalTitle || "",
    dashboardGoalMessage: profile.dashboardGoalMessage || "",
    dashboardGoalDate: profile.dashboardGoalDate || "",
    dashboardGoalImage: profile.dashboardGoalImage || "",
  });
  const [tagDraft, setTagDraft] = useState({ name: "", keywords: "" });
  const [goalImageState, setGoalImageState] = useState("");

  function cleanMiscTags(tags) {
    return (tags || [])
      .map((tag, index) => ({
        id: tag.id || `misc-tag-${Date.now()}-${index}`,
        name: String(tag.name || "").trim(),
        keywords: String(tag.keywords || tag.name || "").trim(),
      }))
      .filter((tag) => tag.name && tag.keywords);
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
    setForm((current) => ({
      ...current,
      miscTags: (current.miscTags || []).filter((tag) => tag.id !== id),
    }));
  }

  function submitSettings(event) {
    event.preventDefault();
    onSave({ ...form, miscTags: cleanMiscTags(form.miscTags) });
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
        <div className="settings-block">
          <strong>杂项标签识别</strong>
          <p className="field-help">用于把杂项内容拆进周时间大表。关键词用逗号分隔，识别到对应行后会读取这一行里的分钟数。</p>
          <div className="tag-draft-grid">
            <TextField label="标签名" value={tagDraft.name} onChange={(value) => setTagDraft({ ...tagDraft, name: value })} />
            <TextField label="关键词" value={tagDraft.keywords} onChange={(value) => setTagDraft({ ...tagDraft, keywords: value })} />
            <button className="secondary-button" type="button" onClick={addMiscTag}>添加标签</button>
          </div>
          <div className="settings-tag-list">
            {(form.miscTags || []).map((tag) => (
              <div className="settings-tag-row" key={tag.id}>
                <input value={tag.name || ""} onChange={(event) => updateMiscTag(tag.id, "name", event.target.value)} aria-label="标签名" />
                <input value={tag.keywords || ""} onChange={(event) => updateMiscTag(tag.id, "keywords", event.target.value)} aria-label="关键词" />
                <button className="icon-button danger" type="button" onClick={() => deleteMiscTag(tag.id)} aria-label="删除标签"><Trash2 size={17} /></button>
              </div>
            ))}
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

function ListPanel({ items, render }) {
  return <div className="table-panel">{items.map(render)}</div>;
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} onChange={(event) => onChange(toNumber(event.target.value))} />
    </label>
  );
}

function TextField({ label, value, onChange, required, type = "text" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value || ""} required={required} onChange={(event) => onChange(event.target.value)} />
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
