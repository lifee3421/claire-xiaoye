import fs from "node:fs";

function patchBetween(path, startMarker, endMarker, replacement, alreadyMarker) {
  const source = fs.readFileSync(path, "utf8");
  if (alreadyMarker && source.includes(alreadyMarker)) return false;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${path}: start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${path}: end marker not found: ${endMarker}`);
  fs.writeFileSync(path, source.slice(0, start) + replacement + source.slice(end), "utf8");
  return true;
}

function replaceOnce(path, before, after, alreadyMarker) {
  const source = fs.readFileSync(path, "utf8");
  if (alreadyMarker && source.includes(alreadyMarker)) return false;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`${path}: expected block not found`);
  if (source.indexOf(before, index + 1) >= 0) throw new Error(`${path}: expected block is not unique`);
  fs.writeFileSync(path, source.slice(0, index) + after + source.slice(index + before.length), "utf8");
  return true;
}

const appPath = "src/App.jsx";
const reminderPath = "src/agent/buildReminderPlan.js";

replaceOnce(
  appPath,
`  useEffect(() => {
    const refreshClock = () => {
      setBeijingDay((current) => {
        const next = beijingIsoDate();
        return current === next ? current : next;
      });
      setCurrentBeijingMinute(beijingDayMinutes());
    };
    const timer = window.setInterval(refreshClock, 15 * 1000);
    return () => window.clearInterval(timer);
  }, []);`,
`  useEffect(() => {
    const refreshClock = () => {
      setBeijingDay((current) => {
        const next = beijingIsoDate();
        return current === next ? current : next;
      });
      setCurrentBeijingMinute(beijingDayMinutes());
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshClock();
    };
    // A planner tab may sleep overnight while the browser is suspended. Do
    // not leave yesterday's completed life cards visible until the next
    // 15-second interval: refresh immediately on mount, focus and visibility.
    refreshClock();
    const timer = window.setInterval(refreshClock, 15 * 1000);
    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);`,
  "window.addEventListener(\"focus\", refreshClock);",
);

replaceOnce(
  appPath,
`  const lunchStart = clockToDayMinutes(draft.lunchStartTime) ?? 12 * 60 + 30;
  add("lunch", "午餐", lunchStart, lunchStart + Math.min(40, Number(draft.lunchBlockMinutes || 40)), "午餐", "午餐安排", { categoryId: LIFE_CATEGORY_IDS.lunch, type: "meal" });
  const lunchEnd = lunchStart + Number(draft.lunchBlockMinutes || 0);
  add("startup", "午休与启动缓冲", lunchStart + 40, lunchEnd + Number(draft.startupBufferMinutes || 0), "午休", "进入下午前缓冲", { categoryId: LIFE_CATEGORY_IDS.nap });
  add("dinner", "晚餐", 18 * 60, 18 * 60 + Number(draft.dinnerMinutes ?? 40), "晚餐", "晚餐安排", { categoryId: LIFE_CATEGORY_IDS.dinner, type: "meal" });`,
`  const lunchStart = clockToDayMinutes(draft.lunchStartTime) ?? 12 * 60 + 30;
  const lunchBlockMinutes = Math.max(0, Number(draft.lunchBlockMinutes || 0));
  const lunchMealMinutes = Math.min(40, lunchBlockMinutes || 40);
  add("lunch", "午餐", lunchStart, lunchStart + lunchMealMinutes, "午餐", "午餐安排", { categoryId: LIFE_CATEGORY_IDS.lunch, type: "meal" });
  const lunchEnd = lunchStart + lunchBlockMinutes;
  const napMinutes = Math.max(0, Math.min(30, lunchEnd - (lunchStart + lunchMealMinutes)));
  const napEnd = lunchEnd;
  const napStart = napEnd - napMinutes;
  const middayRestStart = lunchStart + lunchMealMinutes;
  if (napStart > middayRestStart) {
    add("midday-rest", "午间休息", middayRestStart, napStart, "午间休息", "午餐后留白与恢复", { categoryId: LIFE_CATEGORY_IDS.other, type: "rest", systemRole: "midday_rest" });
  }
  if (napMinutes > 0) {
    add("nap", "午睡", napStart, napEnd, "午休", "30 分钟午睡；雪尘按开始/结束时间提醒", { categoryId: LIFE_CATEGORY_IDS.nap, type: "nap", systemRole: "nap" });
  }
  const startupStart = lunchEnd;
  add("startup", "午间启动缓冲", startupStart, startupStart + Number(draft.startupBufferMinutes || 0), "午间启动", "进入下午前缓冲", { categoryId: LIFE_CATEGORY_IDS.other, type: "preparation", systemRole: "midday_startup" });
  add("dinner", "晚餐", 18 * 60, 18 * 60 + Number(draft.dinnerMinutes ?? 40), "晚餐", "晚餐安排", { categoryId: LIFE_CATEGORY_IDS.dinner, type: "meal" });`,
  'add("nap", "午睡", napStart, napEnd',
);

patchBetween(
  reminderPath,
  "function buildCardReminder(card, localDate) {",
  "function semanticRole(card = {}) {",
`function buildCardReminder(card, localDate) {
  const setting = { ...(card.snowdustReminder || {}), ...(card.effectiveReminder?.reminder || {}) };
  const role = semanticRole(card);
  const explicitlyEnabled = setting.mode === "on" || setting.enabled === true;
  const explicitlyDisabled = setting.mode === "off" || setting.enabled === false;
  const verification = card.startVerification;
  const verificationRequired = Boolean(verification?.required);
  const defaultEnabled = DEFAULT_ROLES.has(role) || card.isFirstStudyCardOfStage === true || card.startVerificationReasons.length > 0;
  if ((!explicitlyEnabled && !defaultEnabled && !verificationRequired) || (explicitlyDisabled && !verificationRequired)) return [];

  const requiresResponse = setting.requiresResponse !== false;
  const followUpPolicy = { enabled: setting.followUp?.enabled !== false && requiresResponse, delayMinutes: Math.max(1, Number(setting.followUp?.delayMinutes) || 10), maxCount: 1 };
  const common = {
    sourceCardId: String(card.id),
    kind: "schedule_reminder",
    deliveryMode: "must_send",
    requiresResponse,
    followUpPolicy,
    cardType: card.cardType,
    stage: card.stage || null,
    stageEndsAt: card.stageEndsAt || null,
    isFirstStudyCardOfStage: card.isFirstStudyCardOfStage === true,
    plannedFocusMinutes: card.plannedFocusMinutes,
    reminderSource: card.effectiveReminder?.reminder?.source || "globalDefault",
    startVerificationSource: card.effectiveReminder?.startVerification?.source || "globalDefault",
    startVerification: verification,
    requiresStartVerification: Boolean(verification),
    studyStartVerification: verification,
    startVerificationReasons: card.startVerificationReasons,
  };

  if (role === "nap") {
    if (!card.id || minute(card.start) === null || minute(card.end) === null) return [];
    const advanceMinutes = Math.max(0, Number(setting.advanceMinutes ?? setting.offsetMinutes ?? 5) || 0);
    return [
      {
        ...common,
        purpose: "rest",
        scheduledAt: isoAt(localDate, card.start, -advanceMinutes),
        offsetMinutes: -advanceMinutes,
        advanceMinutes,
        anchor: "start",
        text: setting.note || defaultText(card, "rest"),
      },
      {
        ...common,
        purpose: "wake_up",
        scheduledAt: isoAt(localDate, card.end, 0),
        offsetMinutes: 0,
        advanceMinutes: 0,
        anchor: "end",
        text: `午睡结束啦，该起来了：${card.title || "午睡"}`,
        // Waking is a delivery action, not a start-verification surface.
        startVerification: null,
        requiresStartVerification: false,
        studyStartVerification: null,
        startVerificationReasons: [],
      },
    ];
  }

  const anchor = setting.anchor === "end" ? "end" : "start";
  const base = anchor === "end" ? card.end : card.start;
  if (!card.id || minute(base) === null) return [];
  const advanceMinutes = Math.max(0, Number(setting.advanceMinutes ?? setting.offsetMinutes ?? 5) || 0);
  const offsetMinutes = -advanceMinutes;
  const purpose = setting.purpose || defaultPurpose(role, anchor);
  return [{
    ...common,
    purpose,
    scheduledAt: isoAt(localDate, base, offsetMinutes),
    offsetMinutes,
    advanceMinutes,
    anchor,
    text: setting.note || defaultText(card, purpose),
  }];
}

`,
  'purpose: "wake_up"',
);

console.log("planner daily-state / nap patch applied");
