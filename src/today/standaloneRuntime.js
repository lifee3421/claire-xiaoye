import {
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, googleProvider, isFirebaseConfigured } from "../services/firebase.js";

const TIMEZONE = "Asia/Shanghai";
let unsubscribeProfile = null;
let cachedContext = null;
let refreshTimer = null;
let currentUser = null;

function localDateIn(timeZone = TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function minuteOfDayIn(timeZone = TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour) % 24;
  const minute = Number(values.minute);
  return hour * 60 + minute;
}

function formatMinutes(total) {
  const value = Math.max(0, Math.round(Number(total) || 0));
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes}min`;
  if (!minutes) return `${hours}h`;
  return `${hours}h${minutes}`;
}

function categoryAlias(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "math" || raw.includes("数学")) return "math";
  if (raw === "english" || raw.includes("ielts") || raw.includes("英语") || raw.includes("雅思")) return "english";
  if (raw === "economics" || raw === "professional" || raw.includes("经济") || raw.includes("专业")) return "pro";
  if (raw === "paper" || raw.includes("论文")) return "paper";
  if (raw === "exercise" || raw.includes("运动")) return "exercise";
  if (raw === "reading" || raw.includes("阅读")) return "reading";
  if (raw === "entertainment" || raw.includes("娱乐") || raw.includes("休息")) return "rest";
  return "life";
}

function workRestForBlock(block) {
  const occupied = Math.max(1, Number(block.end || 0) - Number(block.start || 0));
  const rest = Math.max(0, Number(block.breakMinutes || block.breakAfter || 0));
  const explicitWork = Number(block.workMinutes ?? block.duration);
  const work = Number.isFinite(explicitWork) && explicitWork > 0 ? explicitWork : Math.max(1, occupied - rest);
  return { work, rest, occupied };
}

function timelineBlock(block) {
  const { work, rest } = workRestForBlock(block);
  const taskGroup = block.taskGroup && typeof block.taskGroup === "object" ? block.taskGroup : null;
  return {
    id: String(block.id),
    groupId: taskGroup?.id || block.taskId || block.groupId || block.id,
    title: block.title || "未命名任务",
    categoryId: block.categoryId || block.category || "personal",
    category: block.categoryName || block.category || "",
    cat: categoryAlias(block.categoryId || block.category),
    kind: block.kind || (taskGroup ? "task" : "fixed"),
    start: Number(block.start),
    end: Number(block.end),
    work,
    rest,
    priority: Number(block.priority ?? taskGroup?.priority ?? 2),
    index: Number(block.segmentIndex ?? block.index ?? 1),
    total: Number(taskGroup?.segments?.length ?? block.total ?? 1),
    status: block.status || "pending",
    locked: Boolean(block.locked),
    protected: Boolean(block.protected),
    type: block.type || "",
    rhythm: `${work}${rest ? `+${rest}` : ""}`,
  };
}

function poolSegment(segment, index) {
  const work = Math.max(1, Number(segment.duration ?? segment.workMinutes ?? 50));
  const occupied = Math.max(work, Number(segment.occupiedDuration ?? work));
  const rest = Math.max(0, Number(segment.breakMinutes ?? segment.breakAfter ?? (occupied - work)) || 0);
  return {
    id: String(segment.blockId || segment.segmentId || `${segment.id || "pool"}-${index + 1}`),
    groupId: segment.id || segment.taskId || `pool-group-${index + 1}`,
    title: segment.segmentTitle || segment.title || "待安排任务",
    categoryId: segment.categoryId || "personal",
    category: segment.categoryName || segment.category || "",
    cat: categoryAlias(segment.categoryId || segment.category),
    work,
    rest,
    priority: Number(segment.priority || 2),
    status: segment.status || "pending",
  };
}

function followupView(item, blocks) {
  if (!item) return null;
  const trigger = item.triggerType || "none";
  const bound = blocks.find((block) => String(block.id) === String(item.boundBlockId || ""));
  const triggerText = {
    before_start: "开始前",
    after_start: "开始后",
    before_end: "结束前",
    after_end: "结束后",
  }[trigger] || "";
  let whenLabel = "跟随日程";
  if (trigger === "time" && item.dueAt) {
    const date = new Date(item.dueAt);
    if (!Number.isNaN(date.valueOf())) {
      whenLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    }
  } else if (triggerText && bound) {
    whenLabel = `${bound.title}${triggerText}`;
  } else if (triggerText) {
    whenLabel = `绑定日程 · ${triggerText}`;
  }
  return {
    title: item.followupText || item.title || "雪尘之后会问",
    modeLabel: trigger === "time" ? "定时" : trigger === "none" ? "备忘" : "跟随日程",
    whenLabel,
  };
}

function projectContext(context, now = new Date()) {
  const timeZone = context.timezone || TIMEZONE;
  const nowMinute = minuteOfDayIn(timeZone, now);
  const blocks = (Array.isArray(context.timelineBlocks) ? context.timelineBlocks : [])
    .map(timelineBlock)
    .filter((block) => Number.isFinite(block.start) && Number.isFinite(block.end) && block.end > block.start)
    .sort((a, b) => a.start - b.start);
  const live = blocks.filter((block) => !["rescheduled", "cancelled"].includes(block.status));
  const currentBlock = live.find((block) => block.start <= nowMinute && block.end > nowMinute && block.status !== "completed") || null;
  const nextBlock = live.filter((block) => block.start > nowMinute && block.status !== "completed").sort((a, b) => a.start - b.start)[0] || null;
  const completedMinutes = live
    .filter((block) => block.status === "completed")
    .reduce((sum, block) => sum + Math.max(0, block.end - block.start), 0);
  const remainingCount = live.filter((block) => block.status !== "completed" && block.end > nowMinute).length;
  const ledger = Array.isArray(context.sharedLedger) ? context.sharedLedger : [];
  const inboxItems = ledger.filter((item) => item.kind !== "followup").map((item) => ({
    ...item,
    minutes: item.estimatedMinutes || null,
    done: item.status === "archived",
  }));

  return {
    targetDate: context.date,
    saveLabel: "已同步",
    hasUnsavedChanges: false,
    nowMinute,
    timelineStart: Number(context.timelineStart),
    timelineEnd: Number(context.timelineEnd),
    currentBlock,
    nextBlock,
    completedLabel: formatMinutes(completedMinutes),
    remainingCount,
    timelineBlocks: blocks,
    poolSegments: (Array.isArray(context.taskPool) ? context.taskPool : []).map(poolSegment),
    baseline: Array.isArray(context.baseline) ? context.baseline : [],
    focusSessions: [],
    inboxItems,
    goals: [],
    goalTotal: { targetLabel: "—", subLabel: "目标统计下一阶段接入" },
    followup: followupView(context.followup, blocks),
    baseRevision: context.baseRevision,
  };
}

function dispatchProjected(now = new Date()) {
  if (!cachedContext) return;
  const payload = projectContext(cachedContext, now);
  if (typeof window.__SNOWDUST_TODAY_APPLY_STATE__ === "function") {
    window.__SNOWDUST_TODAY_APPLY_STATE__(payload);
  } else {
    window.dispatchEvent(new CustomEvent("snowdust:today-state", { detail: payload }));
  }
}

function ensureOverlay() {
  let overlay = document.getElementById("snowdust-today-auth-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "snowdust-today-auth-overlay";
  overlay.innerHTML = `<div class="snowdust-today-auth-card"><span class="snowdust-auth-kicker">SNOWDUST TODAY</span><h1>今天</h1><p id="snowdust-today-auth-copy">正在连接你的 Planner…</p><button id="snowdust-today-auth-button" hidden>使用 Google 登录</button></div>`;
  const style = document.createElement("style");
  style.id = "snowdust-today-auth-style";
  style.textContent = `
    #snowdust-today-auth-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:linear-gradient(180deg,#13121a,#100f14);color:#f0ece8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
    .snowdust-today-auth-card{width:min(360px,100%);padding:26px;border:1px solid rgba(255,255,255,.07);border-radius:24px;background:rgba(255,255,255,.035);box-shadow:0 22px 60px rgba(0,0,0,.25)}
    .snowdust-auth-kicker{font-size:11px;letter-spacing:.12em;color:#8d7a99}.snowdust-today-auth-card h1{margin:8px 0 4px;font-size:30px}.snowdust-today-auth-card p{margin:0;color:#8f8888;line-height:1.6;font-size:14px}
    #snowdust-today-auth-button{width:100%;margin-top:18px;padding:12px 16px;border:0;border-radius:14px;background:#eadff0;color:#231f27;font-weight:700}
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  return overlay;
}

function setOverlay(message, { login = false, hidden = false } = {}) {
  const overlay = ensureOverlay();
  overlay.hidden = hidden;
  const copy = document.getElementById("snowdust-today-auth-copy");
  const button = document.getElementById("snowdust-today-auth-button");
  if (copy) copy.textContent = message;
  if (button) button.hidden = !login;
}

async function fetchContext(user, { quiet = false } = {}) {
  if (!user) return;
  if (!quiet) setOverlay("正在读取同一份 Planner…");
  const date = localDateIn(TIMEZONE);
  const token = await user.getIdToken();
  const response = await fetch("/api/planner-ui-context", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ date }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.outcome !== "ok" || !payload?.context) {
    throw new Error(payload?.error || `Planner context → ${response.status}`);
  }
  cachedContext = payload.context;
  dispatchProjected();
  setOverlay("已连接", { hidden: true });
}

function scheduleRefresh(user) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    fetchContext(user, { quiet: true }).catch((error) => {
      console.error("Today context refresh failed", error);
    });
  }, 120);
}

function subscribeProfile(user) {
  unsubscribeProfile?.();
  unsubscribeProfile = onSnapshot(
    doc(db, "users", user.uid),
    () => scheduleRefresh(user),
    (error) => console.error("Today profile subscription failed", error),
  );
}

async function start() {
  document.title = "今日排程";
  if (!isFirebaseConfigured || !auth || !db) {
    setOverlay("Firebase 尚未配置，无法读取真实 Planner。");
    return;
  }
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("Today auth persistence setup failed", error);
  }

  const loginButton = ensureOverlay().querySelector("#snowdust-today-auth-button");
  loginButton?.addEventListener("click", async () => {
    try {
      setOverlay("正在登录…");
      const provider = googleProvider || new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      setOverlay(error?.message || "登录失败", { login: true });
    }
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    unsubscribeProfile?.();
    unsubscribeProfile = null;
    if (!user) {
      cachedContext = null;
      setOverlay("登录后会直接读取和电脑版、雪尘共用的 Planner。", { login: true });
      return;
    }
    try {
      setOverlay("正在读取同一份 Planner…");
      await fetchContext(user);
      subscribeProfile(user);
    } catch (error) {
      console.error("Today standalone boot failed", error);
      setOverlay(`读取排程失败：${error?.message || error}`);
    }
  });

  setInterval(() => {
    if (cachedContext) dispatchProjected(new Date());
  }, 60_000);
}

start();
