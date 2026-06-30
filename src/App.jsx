import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BookOpen,
  Boxes,
  CalendarClock,
  Check,
  ChevronRight,
  Coins,
  Edit3,
  Gamepad2,
  Gift,
  History,
  LayoutDashboard,
  LogOut,
  PackagePlus,
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
  deleteCategory,
  deleteDevelopmentPlan,
  deleteProduct,
  deleteLatestRedemption,
  deleteLatestSettlement,
  ensureUserSeed,
  redeemProduct,
  rollbackSettlementsTo,
  saveCategory,
  saveDevelopmentPlan,
  saveMathProgressRecord,
  saveProfessionalProgressRecord,
  saveProduct,
  saveProfileSettings,
  subscribeUserData,
} from "./services/dataService";
import { loadDemoData, saveDemoData } from "./services/demoStore";
import {
  beneficialStatusText,
  calculateBankPointsAdded,
  calculateDaysLeft,
  calculateGeneratedMinutes,
  clampAllocation,
  estimateDaysToCart,
  estimateDaysToProduct,
  formatDateOnly,
  formatDateTime,
  intensityPresets,
  round1,
  toNumber,
} from "./utils/calculations";
import { parseReviewMarkdown } from "./utils/reviewParser";
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
  getProfessionalProgressMap,
  isProfessionalSectionComplete,
  professionalCurriculum,
  professionalStages,
} from "./utils/professionalProgress";

const tabs = [
  { id: "dashboard", label: "首页", icon: LayoutDashboard },
  { id: "settlement", label: "每日结算", icon: CalendarClock },
  { id: "mall", label: "奖励商场", icon: Gift },
  { id: "estimator", label: "目标估算", icon: Target },
  { id: "weekly", label: "周总结", icon: Award },
  { id: "english", label: "英语追踪", icon: Sparkles },
  { id: "mathProgress", label: "数学进度", icon: Check },
  { id: "professionalProgress", label: "专业课进度", icon: BookOpen },
  { id: "products", label: "商品管理", icon: Boxes },
  { id: "categories", label: "分类管理", icon: Palette },
  { id: "records", label: "历史记录", icon: History },
  { id: "settings", label: "设置", icon: Settings },
];

const sleepAdjustmentOptions = [
  { value: 15, label: "22:30 前入睡：+15min" },
  { value: 10, label: "22:30-23:00 入睡：+10min" },
  { value: 5, label: "23:00-23:20 入睡：+5min" },
  { value: 0, label: "23:20-23:40 入睡：0min" },
  { value: -10, label: "23:40-00:10 入睡：-10min" },
  { value: -20, label: "00:10-00:40 入睡：-20min" },
  { value: -30, label: "00:40 后入睡：-30min" },
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
        createSettlement: (settlement) => createSettlement(user.uid, settlement),
        deleteLatestSettlement: (settlement, fallbackProfile) => deleteLatestSettlement(user.uid, settlement, fallbackProfile),
        rollbackSettlementsTo: (settlementsToDelete, targetSettlement) => rollbackSettlementsTo(user.uid, settlementsToDelete, targetSettlement),
        deleteLatestRedemption: (redemption, product) => deleteLatestRedemption(user.uid, redemption, product),
        saveMathProgress: (record) => saveMathProgressRecord(user.uid, record),
        saveProfessionalProgress: (record) => saveProfessionalProgressRecord(user.uid, record),
        saveProfileSettings: (settings) => saveProfileSettings(user.uid, settings),
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
          const cost = developmentPlanCost(plan);
          if ((current.profile.points || 0) < cost) throw new Error(`还差 ${cost - (current.profile.points || 0)} 分。这个开发愿望先放在清单里。`);
          current.profile.points = Math.max(0, (current.profile.points || 0) - cost);
          current.profile.updatedAt = new Date().toISOString();
          const donePlan = { ...plan, status: "done", pointsSpent: cost, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
      createSettlement: async (settlement) =>
        updateDemo((current) => {
          current.profile.points += Number(settlement.pointsAdded);
          current.profile.tomorrowGameMinutes = Number(settlement.tomorrowGameMinutes);
          current.profile.todayBalanceMinutes = Number(settlement.generatedMinutes);
          current.profile.updatedAt = new Date().toISOString();
          current.settlements.unshift({ ...settlement, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
          return current;
        }),
      deleteLatestSettlement: async (settlement, fallbackProfile) =>
        updateDemo((current) => {
          current.settlements = current.settlements.filter((item) => item.id !== settlement.id);
          current.profile.points = Math.max(0, (current.profile.points || 0) - Number(settlement.pointsAdded || 0));
          current.profile.tomorrowGameMinutes = Number(fallbackProfile.tomorrowGameMinutes || 0);
          current.profile.todayBalanceMinutes = Number(fallbackProfile.todayBalanceMinutes || 0);
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      rollbackSettlementsTo: async (settlementsToDelete, targetSettlement) =>
        updateDemo((current) => {
          const deleteIds = new Set(settlementsToDelete.map((item) => item.id));
          const pointsToRemove = settlementsToDelete.reduce((sum, item) => sum + Number(item.pointsAdded || 0), 0);
          current.settlements = current.settlements.filter((item) => !deleteIds.has(item.id));
          current.profile.points = Math.max(0, (current.profile.points || 0) - pointsToRemove);
          current.profile.tomorrowGameMinutes = Number(targetSettlement.tomorrowGameMinutes || 0);
          current.profile.todayBalanceMinutes = Number(targetSettlement.generatedMinutes || 0);
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      deleteLatestRedemption: async (redemption, product) =>
        updateDemo((current) => {
          current.redemptions = current.redemptions.filter((item) => item.id !== redemption.id);
          current.profile.points = (current.profile.points || 0) + Number(redemption.price || 0);
          if (product?.status === "redeemed") {
            current.products = current.products.map((item) => (item.id === product.id ? { ...item, status: "wishlist" } : item));
          }
          current.profile.updatedAt = new Date().toISOString();
          return current;
        }),
      saveProfileSettings: async (settings) =>
        updateDemo((current) => {
          current.profile = { ...current.profile, ...settings, points: Number(settings.points) || 0 };
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
  }, [data?.profile?.points, user]);

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
        {activeTab === "dashboard" && <Dashboard data={data} setActiveTab={setActiveTab} />}
        {activeTab === "settlement" && (
          <Settlement
            profile={data.profile}
            settlements={data.settlements}
            onSaveMathProgress={(records) =>
              runAction(() => Promise.all(records.map((record) => actions.saveMathProgress(record))), `已同步 ${records.length} 个数学进度打卡。`)
            }
            onSubmit={(settlement) => runAction(() => actions.createSettlement(settlement), settlementResultText(settlement, data.profile.points || 0))}
          />
        )}
        {activeTab === "mall" && (
          <Mall
            data={data}
            onRedeem={(product) => runAction(() => actions.redeemProduct(product), `兑换成功。你用 ${product.price} 分兑换了「${product.name}」，这是阶段性战利品。`)}
            onSaveDevelopmentPlan={(plan) => runAction(() => actions.saveDevelopmentPlan(plan), "开发愿望已记入装修计划。")}
            onDeleteDevelopmentPlan={(planId) => runAction(() => actions.deleteDevelopmentPlan(planId), "开发愿望已删除。")}
            onCompleteDevelopmentPlan={(plan) => runAction(() => actions.completeDevelopmentPlan(plan), `开发完成，已扣除 ${developmentPlanCost(plan)} 分并写入开发日志。`)}
          />
        )}
        {activeTab === "estimator" && <Estimator data={data} />}
        {activeTab === "weekly" && <WeeklySummary data={data} />}
        {activeTab === "english" && <EnglishTrackingPage settlements={data.settlements} />}
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
        {activeTab === "products" && (
          <ProductManager
            data={data}
            onSave={(product) => runAction(() => actions.saveProduct(product), "商品已保存，奖励货架更新好了。")}
            onDelete={(productId) => runAction(() => actions.deleteProduct(productId), "商品已删除。")}
          />
        )}
        {activeTab === "categories" && (
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
  const bonusText = settlement.reviewTimelinessBonus ? `，当天复盘奖励 ${settlement.reviewTimelinessBonus} 分` : "";
  return `结算完成：今日生成 ${settlement.generatedMinutes}min，明日游戏 ${settlement.tomorrowGameMinutes}min，转入 ${settlement.pointsAdded} 分${bonusText}。当前银行 ${total} 分。`;
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

function Dashboard({ data, setActiveTab }) {
  const profile = data.profile;
  const wishlist = data.products.filter((item) => item.status === "wishlist" || item.status === "available");
  const nearest = wishlist
    .map((product) => ({ product, need: Math.max(0, (product.price || 0) - (profile.points || 0)) }))
    .sort((a, b) => a.need - b.need || a.product.price - b.product.price)[0];
  const recentSettlement = data.settlements[0];

  return (
    <section className="page-grid">
      <StatCard icon={Coins} title="奖励银行" value={`${profile.points || 0} 分`} text="用来兑换商场里的阶段性战利品。" tone="coin" />
      <StatCard icon={Gamepad2} title="今日游戏额度" value={`${profile.tomorrowGameMinutes || 0} min`} text="来自前一晚复盘分配给今天的可控快乐。" tone="game" />
      <StatCard icon={Award} title="今日生成余额" value={`${profile.todayBalanceMinutes || 0} min`} text="学习、运动、睡眠与娱乐边界结算后的结果。" tone="time" />

      <div className="panel wide">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Study Quest</p>
            <h2>小椰今日看板</h2>
          </div>
          <Wand2 size={22} />
        </div>
        <div className="quest-row">
          <div>
            <strong>晚上复盘后再决定明日娱乐</strong>
            <span>先把今天的学习成果结算出来，再从时间余额里分配明日游戏额度。</span>
          </div>
          <button className="primary-button" onClick={() => setActiveTab("settlement")}>
            去结算 <ChevronRight size={18} />
          </button>
        </div>
        <div className="quest-row">
          <div>
            <strong>{nearest ? `最近目标：${nearest.product.name}` : "还没有目标商品"}</strong>
            <span>{nearest ? (nearest.need === 0 ? "现在可以解锁啦，小椰尾巴翘起来了。" : `还差 ${nearest.need} 分，目标已经在货架上等你。`) : "去商场添加一个阶段性战利品。"}</span>
          </div>
          <button className="secondary-button" onClick={() => setActiveTab("estimator")}>
            估算天数 <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <h2>最近结算</h2>
          <History size={20} />
        </div>
        {recentSettlement ? (
          <div className="record-mini">
            <strong>+{recentSettlement.pointsAdded} 分</strong>
            <span>生成 {recentSettlement.generatedMinutes}min · 明日游戏 {recentSettlement.tomorrowGameMinutes}min</span>
            <small>{formatDateTime(recentSettlement.createdAt)}</small>
          </div>
        ) : (
          <p className="empty-text">还没有结算记录。第一次复盘后，奖励银行就会亮起来。</p>
        )}
      </div>
    </section>
  );
}

function StatCard({ icon: Icon, title, value, text, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={24} /></div>
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{text}</p>
    </div>
  );
}

function resolveTodayGameQuota(profile, settlements = [], reviewDate = "") {
  const fallback = Number(profile?.tomorrowGameMinutes || 0);
  if (reviewDate) {
    const previousDate = shiftIsoDate(reviewDate, -1);
    const previousSettlement = settlements.find((item) => item.reviewDate === previousDate);
    if (previousSettlement) {
      return {
        minutes: Number(previousSettlement.tomorrowGameMinutes || 0),
        source: `自动读取 ${previousDate} 结算里分配的明日游戏额度。`,
      };
    }
  }

  const latestSettlement = settlements[0];
  if (latestSettlement?.tomorrowGameMinutes !== undefined) {
    return {
      minutes: Number(latestSettlement.tomorrowGameMinutes || 0),
      source: "自动读取上一条结算里分配的明日游戏额度。",
    };
  }

  return {
    minutes: fallback,
    source: fallback > 0 ? "自动读取当前账本保留的明日游戏额度。" : "还没有上一日结算记录，暂按 0min。",
  };
}

function shiftIsoDate(isoDate, offsetDays) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function hasCompletedDevelopmentToday(plans = [], ignorePlanId = "") {
  const today = todayIsoDate();
  return (plans || []).some((plan) =>
    plan.id !== ignorePlanId &&
    plan.kind !== "bug" &&
    plan.status === "done" &&
    localIsoDateFromValue(plan.completedAt || plan.updatedAt) === today
  );
}

function Settlement({ profile, settlements, onSubmit, onSaveMathProgress }) {
  const initialQuota = resolveTodayGameQuota(profile, settlements);
  const [reviewMarkdown, setReviewMarkdown] = useState("");
  const [parseSummary, setParseSummary] = useState("");
  const [progressDate, setProgressDate] = useState(new Date().toISOString().slice(0, 10));
  const [detectedMathProgress, setDetectedMathProgress] = useState([]);
  const [detectedProgressMode, setDetectedProgressMode] = useState({ course: true, exercise: false, useDate: true });
  const [form, setForm] = useState({
    studyMinutes: 450,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 5,
    allocatedGameMinutesForToday: initialQuota.minutes,
    allocatedGameQuotaSource: initialQuota.source,
    actualGameMinutesToday: 30,
    beneficialMinutes: 30,
    tomorrowGameMinutes: profile.defaultTomorrowGameMinutes || 30,
    note: "",
  });
  const detail = calculateGeneratedMinutes(form);
  const allocation = clampAllocation(form.tomorrowGameMinutes, detail.availableMinutes);
  const bankPointsAdded = calculateBankPointsAdded(detail.availableMinutes, allocation);
  const reviewTimelinessBonus = isTodayReview(form.reviewDate) ? 1 : 0;
  const pointsAdded = bankPointsAdded + reviewTimelinessBonus;
  const remainingMinutes = round1(Math.max(0, detail.availableMinutes - allocation));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function importReviewMarkdown() {
    const parsed = parseReviewMarkdown(reviewMarkdown, { miscTags: profile.miscTags || [] });
    const detected = extractMathProgressFromReview(parsed);
    const quota = resolveTodayGameQuota(profile, settlements, parsed.reviewDate);
    setForm((current) => ({
      ...current,
      studyMinutes: parsed.studyMinutes || current.studyMinutes,
      exerciseMinutes: parsed.exerciseMinutes,
      exerciseIntensity: parsed.exerciseIntensity,
      sleepAdjustment: parsed.sleepAdjustment,
      allocatedGameMinutesForToday: quota.minutes,
      allocatedGameQuotaSource: quota.source,
      actualGameMinutesToday: parsed.actualGameMinutesToday,
      beneficialMinutes: parsed.beneficialMinutes,
      note: parsed.note || current.note,
      rawReview: parsed.rawReview,
      subjects: parsed.subjects,
      state: parsed.state,
      wakeTime: parsed.wakeTime,
      sleepDuration: parsed.sleepDuration,
      reviewDate: parsed.reviewDate,
      parsedBedtime: parsed.bedtime,
      parsedSleepAdjustmentLabel: parsed.sleepAdjustmentLabel,
    }));
    setProgressDate(parsed.reviewDate || new Date().toISOString().slice(0, 10));
    setParseSummary(
      `已识别：日期 ${parsed.reviewDate}，学习 ${parsed.studyMinutes || 0}min，运动 ${parsed.exerciseMinutes || 0}min，${parsed.sleepAdjustmentLabel}，有益娱乐 ${parsed.beneficialMinutes || 0}min，游戏娱乐 ${parsed.actualGameMinutesToday || 0}min。`
    );
    setDetectedMathProgress(detected);
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
      tomorrowGameMinutes: preset.plannedTomorrowGameMinutes,
    }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit({
      ...form,
      ...detail,
      tomorrowGameMinutes: allocation,
      bankPointsAdded,
      reviewTimelinessBonus,
      pointsAdded,
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
          <button className="secondary-button" type="button" onClick={() => { setReviewMarkdown(""); setParseSummary(""); }}>清空粘贴区</button>
        </div>
        {parseSummary && <div className="parse-summary">{parseSummary}</div>}
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
          <span>睡眠调整</span>
          <select value={form.sleepAdjustment} onChange={(event) => update("sleepAdjustment", toNumber(event.target.value))}>
            {sleepAdjustmentOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {form.parsedBedtime && (
          <p className="field-help">从复盘识别到入睡时间：{form.parsedBedtime}，{form.parsedSleepAdjustmentLabel}</p>
        )}
        <div className="auto-quota-box">
          <span>昨天分配给今天的游戏额度</span>
          <strong>{form.allocatedGameMinutesForToday || 0} min</strong>
          <small>{form.allocatedGameQuotaSource}</small>
        </div>
        <NumberField label="今天实际游戏类娱乐分钟" value={form.actualGameMinutesToday} onChange={(value) => update("actualGameMinutesToday", value)} />
        <NumberField label="正式有益娱乐分钟" value={form.beneficialMinutes} onChange={(value) => update("beneficialMinutes", value)} />
        <NumberField label="分配明日游戏类娱乐额度" value={form.tomorrowGameMinutes} onChange={(value) => update("tomorrowGameMinutes", value)} />
        <label className="field">
          <span>备注</span>
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="今天的状态、复盘或小椰要记住的边界" />
        </label>
        <button className="primary-button full" type="submit">
          <Check size={18} />
          保存结算并更新银行积分
        </button>
      </form>

      <aside className="settlement-summary">
        <div className="summary-card big">
          <span>当日生成时间余额</span>
          <strong>{detail.generatedMinutes} min</strong>
          <p>可用余额 {detail.availableMinutes}min，先分配明日娱乐，再转奖励银行。</p>
        </div>
        <FormulaLine label="学习入账" value={`${detail.studyCredit} min`} />
        <FormulaLine label="运动入账" value={`${detail.exerciseCredit} min`} />
        <FormulaLine label={`游戏超额 ${detail.gameOverrun}min × 1.2`} value={`-${detail.gameOverrunAdjustment} min`} />
        <FormulaLine label={`有益娱乐：${beneficialStatusText(detail.beneficialStatus)}`} value={`-${detail.beneficialAdjustment} min`} />
        <FormulaLine label="当天复盘奖励" value={`+${reviewTimelinessBonus} 分`} />
        <div className="summary-card">
          <span>明日游戏额度</span>
          <strong>{allocation} min</strong>
          <p>剩余 {remainingMinutes}min，时间余额转入 {bankPointsAdded} 分，总入账 {pointsAdded} 分。</p>
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

function Mall({ data, onRedeem, onSaveDevelopmentPlan, onDeleteDevelopmentPlan, onCompleteDevelopmentPlan }) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [filter, setFilter] = useState("all");
  const categories = data.categories;
  const decorationCategory = categories.find((category) => category.id === "decoration" || category.name === "装修");
  const isDecorationShelf = decorationCategory && selectedCategory === decorationCategory.id;
  const products = data.products.filter((product) => {
    if (decorationCategory && product.categoryId === decorationCategory.id) return false;
    const inCategory = selectedCategory === "all" || product.categoryId === selectedCategory;
    const statusOk = filter === "all" || (filter === "affordable" ? (data.profile.points || 0) >= product.price : product.status === filter);
    return inCategory && statusOk && product.status !== "paused";
  });

  return (
    <section className="content-stack">
      <div className="filter-bar">
        <button className={selectedCategory === "all" ? "chip active" : "chip"} onClick={() => setSelectedCategory("all")}>全部货架</button>
        {categories.map((category) => (
          <button className={selectedCategory === category.id ? "chip active" : "chip"} key={category.id} onClick={() => setSelectedCategory(category.id)}>
            <span className="swatch" style={{ background: category.color }} /> {category.icon} {category.name}
          </button>
        ))}
      </div>
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
          <div className="product-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} category={categories.find((item) => item.id === product.categoryId)} points={data.profile.points || 0} onRedeem={onRedeem} />
            ))}
          </div>
          {products.length === 0 && <p className="empty-text">这个货架暂时空着。可以去商品管理添加新的阶段性战利品。</p>}
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
        把想做的功能先放进清单。完成时自动扣积分，并沉淀成开发日志。每天最多完成 1 条开发愿望。
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
        <span>当前银行 {points} 分</span>
      </div>
      <div className="development-list">
        {activePlans.map((plan) => {
          const cost = developmentPlanCost(plan);
          const affordable = points >= cost;
          const canComplete = affordable && !todayDevelopmentDone;
          return (
          <article className="development-card" key={plan.id}>
            <div>
              <strong>{plan.title}</strong>
              <span>{developmentTypeText(plan.type)} · 约 {legacyDevelopmentMinutes(plan)}min · {cost} 分 · {priorityText(plan.priority)}</span>
              {plan.note && <p>{plan.note}</p>}
            </div>
            <div className="row-actions">
              <button className="icon-button" type="button" onClick={() => edit(plan)} aria-label="编辑开发计划"><Edit3 size={17} /></button>
              <button className={canComplete ? "secondary-button compact" : "disabled-button compact"} type="button" disabled={!canComplete} onClick={() => onComplete(plan)}>
                {todayDevelopmentDone ? "今日已开发" : affordable ? `完成 -${cost}分` : "积分不足"}
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
        <span>固定 1 分 / 次</span>
      </div>
      <div className="development-list">
        {activeBugs.map((bug) => {
          const affordable = points >= 1;
          return (
            <article className="development-card bug" key={bug.id}>
              <div>
                <strong>{bug.title}</strong>
                <span>修 bug · 1 分</span>
                {bug.note && <p>{bug.note}</p>}
              </div>
              <div className="row-actions">
                <button className={affordable ? "secondary-button compact" : "disabled-button compact"} type="button" disabled={!affordable} onClick={() => onComplete(bug)}>
                  修好 -1分
                </button>
                <button className="icon-button danger" type="button" onClick={() => onDelete(bug.id)} aria-label="删除待修 bug"><Trash2 size={17} /></button>
              </div>
            </article>
          );
        })}
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
                  <span>{formatDateTime(plan.completedAt || plan.updatedAt)} · {developmentTypeText(plan.type)} · 约 {legacyDevelopmentMinutes(plan)}min · 花费 {plan.pointsSpent || developmentPlanCost(plan)} 分</span>
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
                  <span>{formatDateTime(bug.completedAt || bug.updatedAt)} · 修 bug · 花费 {bug.pointsSpent || 1} 分</span>
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
        <span>先进入待修清单，修好时扣 1 分并进入 Bug 日志。</span>
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

function ProductCard({ product, category, points, onRedeem }) {
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

function Estimator({ data }) {
  const activeProducts = data.products.filter((product) => product.status !== "paused" && product.status !== "redeemed");
  const [selectedIds, setSelectedIds] = useState(activeProducts.slice(0, 1).map((item) => item.id));
  const [customPlan, setCustomPlan] = useState({
    name: "我的自定义方案",
    studyMinutes: 450,
    sleepAdjustment: 5,
    plannedTomorrowGameMinutes: 30,
    beneficialMinutes: 30,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
  });
  const [form, setForm] = useState({
    studyMinutes: 450,
    exerciseMinutes: 0,
    exerciseIntensity: "none",
    sleepAdjustment: 5,
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
        <NumberField label="每日学习分钟" value={form.studyMinutes} onChange={(value) => setForm({ ...form, studyMinutes: value })} />
        <NumberField label="计划明日游戏额度" value={form.plannedTomorrowGameMinutes} onChange={(value) => setForm({ ...form, plannedTomorrowGameMinutes: value })} />
        <NumberField label="预计游戏超额" value={form.expectedGameOverrun} onChange={(value) => setForm({ ...form, expectedGameOverrun: value })} />
        <NumberField label="预计有益娱乐分钟" value={form.beneficialMinutes} onChange={(value) => setForm({ ...form, beneficialMinutes: value })} />
        <label className="field">
          <span>睡眠调整</span>
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
                <span>{row.studyMinutes / 60}h 学习 · 明日游戏 {row.plannedTomorrowGameMinutes}min · {sleepLabel(row.sleepAdjustment)}</span>
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
                  <span>明日游戏 min</span>
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
                  <span>有益娱乐 min</span>
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

function ProductManager({ data, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...blankProduct, categoryId: data.categories[0]?.id || "" });

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
    onSave({ ...form, id: editing });
    reset();
  }

  return (
    <section className="manager-layout">
      <form className="panel form-panel" onSubmit={submit}>
        <div className="panel-title"><h2>{editing ? "编辑商品" : "新增商品"}</h2><PackagePlus size={21} /></div>
        <TextField label="商品名称" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
        <label className="field">
          <span>分类</span>
          <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
            <option value="">未分类</option>
            {data.categories.map((category) => <option value={category.id} key={category.id}>{category.icon} {category.name}</option>)}
          </select>
        </label>
        <NumberField label="积分价格" value={form.price} onChange={(value) => setForm({ ...form, price: value })} />
        <SelectField label="稀有度" value={form.rarity} onChange={(value) => setForm({ ...form, rarity: value })} options={[["common", "普通"], ["rare", "稀有"], ["epic", "史诗"], ["legendary", "传说"]]} />
        <SelectField label="优先级" value={form.priority} onChange={(value) => setForm({ ...form, priority: value })} options={[["low", "低"], ["medium", "中"], ["high", "高"]]} />
        <SelectField label="状态" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={[["available", "可用"], ["wishlist", "愿望单"], ["paused", "暂缓"], ["redeemed", "已兑换"]]} />
        <TextField label="图标" value={form.icon} onChange={(value) => setForm({ ...form, icon: value })} />
        <TextField label="描述" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
        <label className="field"><span>限时截止日期</span><input type="date" value={form.limitedUntil || ""} onChange={(event) => setForm({ ...form, limitedUntil: event.target.value })} /></label>
        <label className="check-row inline"><input type="checkbox" checked={form.repeatable !== false} onChange={(event) => setForm({ ...form, repeatable: event.target.checked })} />可重复兑换</label>
        <TextField label="备注" value={form.note} onChange={(value) => setForm({ ...form, note: value })} />
        <div className="button-row">
          <button className="primary-button" type="submit"><Save size={18} />保存</button>
          <button className="secondary-button" type="button" onClick={reset}>清空</button>
        </div>
      </form>

      <ListPanel items={data.products} render={(product) => (
        <div className="list-row" key={product.id}>
          <div><strong>{product.name}</strong><span>{product.price} 分 · {rarityText(product.rarity)} · {statusText(product.status)}</span></div>
          <div className="row-actions">
            <button className="icon-button" onClick={() => edit(product)} aria-label="编辑商品"><Edit3 size={17} /></button>
            <button className="icon-button danger" onClick={() => onDelete(product.id)} aria-label="删除商品"><Trash2 size={17} /></button>
          </div>
        </div>
      )} />
    </section>
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
  const exerciseMax = Math.max(1, ...summary.dailyRows.map((row) => Number(row.raw.exerciseMinutes || 0)));
  const visibleActivities = summary.activityTotals.filter((item) => item.minutes > 0 || ["studyMinutes", "exerciseMinutes", "beneficialMinutes"].includes(item.key));

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
    <section className="content-stack">
      <div className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Weekly Review</p>
            <h2>最近 7 条复盘总结</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => exportWeeklySummaryCsv(summary, tableActivityKeys)}>导出 CSV</button>
        </div>
        <p className="record-hint">
          这里会读取你每日粘贴识别后保存的结算记录。记录越完整，周总结越像你平时的复盘语言。
        </p>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>本周活动总览</h2><Award size={20} /></div>
        <div className="activity-total-grid">
          {visibleActivities.map((activity) => (
            <div className="activity-total" key={activity.key}>
              <span>{activity.label}</span>
              <strong>{minutesLabel(activity.minutes)}</strong>
            </div>
          ))}
        </div>
      </div>

      <section className="chart-grid">
        <WeeklyBarChart title="总学习趋势" rows={summary.dailyRows} valueKey="studyMinutes" max={studyMax} />
        <WeeklyBarChart title="运动趋势" rows={summary.dailyRows} valueKey="exerciseMinutes" max={exerciseMax} />
      </section>

      <div className="panel state-panel">
        <div className="panel-title"><h2>状态雷达小结</h2><Sparkles size={20} /></div>
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

      <div className="panel weekly-table-panel">
        <div className="panel-title"><h2>周时间大表</h2><CalendarClock size={20} /></div>
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
                {tableActivityTotals.map((activity) => <th key={activity.key}>{activity.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {summary.dailyRows.map((row) => (
                <tr key={row.id || row.date}>
                  <th>{row.date}</th>
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

      <div className="panel">
        <div className="panel-title"><h2>分科推进</h2><CalendarClock size={20} /></div>
        <div className="subject-grid">
          {summary.subjects.map((subject) => (
            <article className="subject-card" key={subject.key}>
              <strong>{subject.label}</strong>
              <span>{subject.minutes} min</span>
              {subject.progress.length > 0 ? (
                <ul>
                  {subject.progress.map((item, index) => <li key={`${subject.key}-p-${index}`}>{item}</li>)}
                </ul>
              ) : (
                <p>本周还没有识别到推进内容。</p>
              )}
              {subject.blockers.length > 0 && <p className="blocker-text">卡点：{subject.blockers.join("；")}</p>}
            </article>
          ))}
        </div>
      </div>

      <section className="records-layout">
        <div className="panel">
          <div className="panel-title"><h2>状态与收尾</h2><History size={20} /></div>
          <div className="weekly-list">
            {summary.highlights.map((item, index) => <p key={`h-${index}`}>⭐ {item}</p>)}
            {summary.avgStudyQuality !== null && <p>学习质量平均：{summary.avgStudyQuality}/10</p>}
            {summary.avgStability !== null && <p>执行稳定度平均：{summary.avgStability}/10</p>}
            {summary.highlights.length === 0 && <p className="empty-text">还没有识别到一句话总结。</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title"><h2>下周调整线索</h2><Wand2 size={20} /></div>
          <div className="weekly-list">
            {summary.blockers.map((item, index) => <p key={`b-${index}`}>卡点：{item}</p>)}
            {summary.adjustments.map((item, index) => <p key={`a-${index}`}>调整：{item}</p>)}
            {summary.blockers.length === 0 && summary.adjustments.length === 0 && <p className="empty-text">还没有识别到卡点或明日调整。</p>}
          </div>
        </div>
      </section>
    </section>
  );
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

function Records({ data, onDeleteSettlement, onRollbackSettlements, onDeleteRedemption }) {
  const latestSettlement = data.settlements[0];
  const previousSettlement = data.settlements[1];
  const latestRedemption = data.redemptions[0];
  const fallbackProfile = previousSettlement
    ? {
        tomorrowGameMinutes: previousSettlement.tomorrowGameMinutes,
        todayBalanceMinutes: previousSettlement.generatedMinutes,
      }
    : { tomorrowGameMinutes: 0, todayBalanceMinutes: 0 };

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
                学习 {item.studyMinutes}min / 入账 {item.studyCredit}min · 游戏超额 {item.gameOverrun}min，修正扣 {item.gameOverrunAdjustment ?? item.gameOverrun}min · 有益娱乐 {beneficialStatusText(item.beneficialStatus)}
                {Number(item.reviewTimelinessBonus || 0) > 0 && ` · 当天复盘 +${item.reviewTimelinessBonus}分`}
              </span>
              {item.note && <small>{item.note}</small>}
            </div>
            <div className="record-actions">
              <time>{item.reviewDate || formatDateOnly(item.createdAt)}</time>
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
            <div><strong>{item.productName}</strong><span>-{item.price} 分 · 剩余 {item.remainingPoints ?? "未知"} 分</span></div>
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
  });
  const [tagDraft, setTagDraft] = useState({ name: "", keywords: "" });

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

  return (
    <section className="manager-layout">
      <form className="panel form-panel" onSubmit={submitSettings}>
        <div className="panel-title"><h2>设置</h2><Settings size={21} /></div>
        <TextField label="昵称" value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} />
        <NumberField label="当前银行积分校准" value={form.points} onChange={(value) => setForm({ ...form, points: value })} />
        <NumberField label="默认明日游戏额度" value={form.defaultTomorrowGameMinutes} onChange={(value) => setForm({ ...form, defaultTomorrowGameMinutes: value })} />
        <NumberField label="有益娱乐保护额度" value={form.beneficialProtectionMinutes} onChange={(value) => setForm({ ...form, beneficialProtectionMinutes: value })} />
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

function TextField({ label, value, onChange, required }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value || ""} required={required} onChange={(event) => onChange(event.target.value)} />
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
  return sleepAdjustmentOptions.find((option) => option.value === Number(value))?.label || "睡眠调整未设置";
}
