const KEY = "yeye_reward_bank_demo_v2";

import { DAILY_FREE_ENTERTAINMENT_LIMIT_MIN } from "../utils/calculations";
import { buildTransactionEntry, planRedemption, planUseReward } from "../server/rewardShopCore.js";

export const starterCategories = [
  {
    id: "games",
    name: "游戏",
    icon: "🎮",
    color: "#8B5CF6",
    description: "剧情游戏、Steam 游戏、沉浸式娱乐。",
  },
  {
    id: "life",
    name: "生活",
    icon: "🍵",
    color: "#45C486",
    description: "奶茶、咖啡、甜品、轻松外出。",
  },
  {
    id: "shopping",
    name: "消费",
    icon: "🛍️",
    color: "#F472B6",
    description: "书、文具、小饰品、生活小物。",
  },
  {
    id: "experience",
    name: "体验",
    icon: "🎟️",
    color: "#60A5FA",
    description: "展览、城市探索、半天自由安排。",
  },
  {
    id: "decoration",
    name: "装修",
    icon: "🛠️",
    color: "#4ECDC4",
    description: "给系统换外观、加小功能、做一点点快乐开发。",
  },
  {
    id: "custom",
    name: "自定义",
    icon: "✨",
    color: "#FACC15",
    description: "Claire 自己添加的愿望。",
  },
];

export const starterProducts = [
  {
    id: "mad-dog-blood",
    name: "咎狗之血",
    categoryId: "games",
    price: 15,
    rarity: "rare",
    priority: "high",
    status: "wishlist",
    repeatable: false,
    limitedUntil: "",
    description: "短剧情奖励，适合作为连续稳定学习几天后的战利品。",
    note: "阶段性战利品，不是偷懒。",
  },
  {
    id: "queen-road",
    name: "盛世天下：女帝篇",
    categoryId: "games",
    price: 15,
    rarity: "rare",
    priority: "high",
    status: "wishlist",
    repeatable: false,
    limitedUntil: "",
    description: "中短程剧情奖励，适合阶段推进后兑换。",
    note: "",
  },
  {
    id: "witcher-three",
    name: "巫师三",
    categoryId: "games",
    price: 40,
    rarity: "legendary",
    priority: "medium",
    status: "wishlist",
    repeatable: false,
    limitedUntil: "",
    description: "高阶阶段奖励。内容较长，适合在阶段成果之后兑换。",
    note: "小椰建议把它当大目标，不因为折扣焦虑硬冲。",
  },
  {
    id: "milk-tea",
    name: "奶茶 / 咖啡 / 甜品",
    categoryId: "life",
    price: 5,
    rarity: "common",
    priority: "low",
    status: "available",
    repeatable: true,
    limitedUntil: "",
    description: "即时小奖励，适合稳定完成主线后兑换。",
    note: "",
  },
  {
    id: "free-meal",
    name: "一顿不考虑学习的饭",
    categoryId: "life",
    price: 15,
    rarity: "rare",
    priority: "medium",
    status: "available",
    repeatable: true,
    limitedUntil: "",
    description: "有仪式感的中度奖励。",
    note: "",
  },
  {
    id: "book-fund",
    name: "喜欢的书 / 文具",
    categoryId: "shopping",
    price: 15,
    rarity: "rare",
    priority: "medium",
    status: "available",
    repeatable: true,
    limitedUntil: "",
    description: "用于买喜欢的书，或学习相关的小工具。",
    note: "",
  },
  {
    id: "half-day",
    name: "半天自由安排",
    categoryId: "experience",
    price: 30,
    rarity: "epic",
    priority: "medium",
    status: "available",
    repeatable: true,
    limitedUntil: "",
    description: "完整半天放松，但仍然由小椰帮你守住边界。",
    note: "",
  },
];

function mergeStarterItems(data) {
  let changed = false;
  const categoryIds = new Set((data.categories || []).map((item) => item.id));
  const productIds = new Set((data.products || []).map((item) => item.id));

  starterCategories.forEach((category) => {
    if (!categoryIds.has(category.id)) {
      data.categories = [...(data.categories || []), category];
      changed = true;
    }
  });

  starterProducts.forEach((product) => {
    if (!productIds.has(product.id)) {
      data.products = [...(data.products || []), product];
      changed = true;
    }
  });

  return changed;
}

export function makeStarterData() {
  return {
    profile: {
      points: 0,
      tomorrowGameMinutes: 0,
      todayBalanceMinutes: 0,
      nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
      nextDayEntertainmentLimitReason: "每日固定自由娱乐额度90min。",
      nextDayEntertainmentSourceDayType: "normal_progress_day",
      defaultTomorrowGameMinutes: 30,
      beneficialProtectionMinutes: 60,
      miscTags: [],
      entertainmentTags: [],
      travelDayBonusPoints: 1,
      eventBookLink: "",
      scheduleAssistantSettings: {},
      scheduleAssistantDraft: {},
      plannerCategoryOrder: [],
      scheduleSegmentGoals: {},
      dashboardTargetProductIds: [],
      dashboardGoalTitle: "",
      dashboardGoalMessage: "",
      dashboardGoalDate: "",
      dashboardGoalImage: "",
      lastMaskDate: "",
      maskCycle: {},
      healthMaintenanceItems: [],
      maintenanceItemOrder: [],
      classificationTaxonomy: [],
      reviewProjects: [],
      reviewTrackers: [],
      reviewTrackerOrder: [],
      periodCycle: { status: "inactive", startedOn: "", endedOn: "" },
      displayName: "Claire",
      updatedAt: new Date().toISOString(),
    },
    categories: starterCategories,
    products: starterProducts,
    settlements: [],
    dailyReviewDrafts: [],
    redemptions: [],
    pointTransactions: [],
    rewardInstances: [],
    mathProgress: [],
    professionalProgress: [],
    developmentPlans: [],
    entertainmentLogs: [],
    entertainmentExtensions: [],
    projectRewardApplications: [],
    diaryEntries: [],
    books: [],
    readingSessions: [],
  };
}

export function loadDemoData() {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const data = makeStarterData();
    localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  }
  const data = JSON.parse(raw);
  data.developmentPlans = data.developmentPlans || [];
  data.professionalProgress = data.professionalProgress || [];
  data.entertainmentLogs = data.entertainmentLogs || [];
  data.entertainmentExtensions = data.entertainmentExtensions || [];
  data.projectRewardApplications = data.projectRewardApplications || [];
  data.diaryEntries = data.diaryEntries || [];
  data.books = data.books || [];
  data.readingSessions = data.readingSessions || [];
  data.pointTransactions = data.pointTransactions || [];
  data.rewardInstances = data.rewardInstances || [];
  data.profile.miscTags = data.profile.miscTags || [];
  data.profile.entertainmentTags = data.profile.entertainmentTags || [];
  data.profile.travelDayBonusPoints = data.profile.travelDayBonusPoints ?? 1;
  data.profile.eventBookLink = data.profile.eventBookLink || "";
  data.profile.scheduleAssistantSettings = data.profile.scheduleAssistantSettings || {};
  data.profile.scheduleAssistantDraft = data.profile.scheduleAssistantDraft || {};
  data.profile.plannerCategoryOrder = Array.isArray(data.profile.plannerCategoryOrder) ? data.profile.plannerCategoryOrder : [];
  data.profile.scheduleSegmentGoals = data.profile.scheduleSegmentGoals || {};
  data.profile.dashboardTargetProductIds = data.profile.dashboardTargetProductIds || [];
  data.profile.dashboardGoalTitle = data.profile.dashboardGoalTitle || "";
  data.profile.dashboardGoalMessage = data.profile.dashboardGoalMessage || "";
  data.profile.dashboardGoalDate = data.profile.dashboardGoalDate || "";
  data.profile.dashboardGoalImage = data.profile.dashboardGoalImage || "";
  data.profile.lastMaskDate = data.profile.lastMaskDate || "";
  data.profile.maskCycle = data.profile.maskCycle || {};
  data.profile.healthMaintenanceItems = Array.isArray(data.profile.healthMaintenanceItems) ? data.profile.healthMaintenanceItems : [];
  data.profile.maintenanceItemOrder = Array.isArray(data.profile.maintenanceItemOrder) ? data.profile.maintenanceItemOrder : [];
  data.profile.classificationTaxonomy = Array.isArray(data.profile.classificationTaxonomy) ? data.profile.classificationTaxonomy : [];
  data.profile.reviewProjects = Array.isArray(data.profile.reviewProjects) ? data.profile.reviewProjects : [];
  data.profile.reviewTrackers = Array.isArray(data.profile.reviewTrackers) ? data.profile.reviewTrackers : [];
  data.profile.reviewTrackerOrder = Array.isArray(data.profile.reviewTrackerOrder) ? data.profile.reviewTrackerOrder : [];
  data.profile.periodCycle = data.profile.periodCycle || { status: "inactive", startedOn: "", endedOn: "" };
  data.profile.nextDayBaseEntertainmentLimit = DAILY_FREE_ENTERTAINMENT_LIMIT_MIN;
  data.profile.nextDayEntertainmentLimitReason = data.profile.nextDayEntertainmentLimitReason || "每日固定自由娱乐额度90min。";
  if (mergeStarterItems(data)) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  return data;
}

export function saveDemoData(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

// --- demo-mode reward/shop ---------------------------------------------------
//
// Demo mode has no Firestore, but it must not have its own idea of what a
// redemption means. These two helpers run the SAME planRedemption /
// planUseReward decisions the real engine runs, then just apply the result
// to the localStorage object instead of to a transaction.

export function applyDemoRedemption(current, product) {
  const item = (current.products || []).find((entry) => entry.id === product.id) || product;
  const plan = planRedemption({ item, profile: current.profile, source: "web-demo", idempotencyKey: `demo:${item.id}:${Date.now()}` });
  if (!plan.ok) throw new Error(plan.message);

  const nowIso = new Date().toISOString();
  const instanceId = crypto.randomUUID();

  current.profile.points = plan.accountPatch.points;
  current.profile.rewardTotalSpent = plan.accountPatch.rewardTotalSpent;
  if (Object.keys(plan.itemPatch).length > 0) {
    current.products = (current.products || []).map((entry) => (entry.id === item.id ? { ...entry, ...plan.itemPatch, updatedAt: nowIso } : entry));
  }
  current.rewardInstances = [{ id: instanceId, ...plan.rewardInstance, redeemedAt: nowIso, createdAt: nowIso }, ...(current.rewardInstances || [])];
  current.pointTransactions = [
    { id: crypto.randomUUID(), ...buildTransactionEntry({ ...plan.transactionSeed, rewardInstanceId: instanceId }), createdAt: nowIso },
    ...(current.pointTransactions || []),
  ];
  current.redemptions = [{ id: crypto.randomUUID(), ...plan.legacyRedemption, rewardInstanceId: instanceId, createdAt: nowIso }, ...(current.redemptions || [])];
  return current;
}

export function applyDemoUseReward(current, { rewardInstanceId = "", itemId = "", query = "" } = {}) {
  const picked = planUseReward({ instances: current.rewardInstances || [], rewardInstanceId, shopItemId: itemId, query });
  if (!picked.ok) throw new Error(picked.message);
  const nowIso = new Date().toISOString();
  current.rewardInstances = (current.rewardInstances || []).map((entry) =>
    entry.id === picked.instance.id ? { ...entry, status: "used", usedAt: nowIso, updatedAt: nowIso } : entry
  );
  return current;
}
