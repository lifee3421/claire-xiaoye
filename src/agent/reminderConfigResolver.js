const STUDY_GROUPS = new Set(["study", "reading"]);

const stageForCard = (card = {}) => {
  if (card.stage) return card.stage;
  const [hour, minute] = String(card.start || "").split(":").map(Number);
  const total = hour * 60 + minute;
  if (!Number.isFinite(total)) return null;
  return total < 12 * 60 + 30 ? "morning" : total < 18 * 60 ? "afternoon" : "evening";
};

const kindFor = (statGroup) => STUDY_GROUPS.has(statGroup) ? "study_ready" : statGroup === "exercise" ? "exercise_ready" : "text_ack";
const methodFor = (kind) => kind === "text_ack" ? "text" : "photo";
const explicit = (value) => value && typeof value === "object" && ["on", "off"].includes(value.mode) ? value : null;
const verificationOf = (value) => value?.startVerification || value?.studyStartVerification || value?.deskVerification || null;

function firstStudyCard(card, cardsOfStage) {
  const candidates = (Array.isArray(cardsOfStage) ? cardsOfStage : [])
    .filter((item) => STUDY_GROUPS.has(item?.statGroup))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.id).localeCompare(String(b.id)));
  return candidates[0]?.id === card?.id;
}

function resolveVerification(value, statGroup, source, defaults) {
  if (!value || value.mode === "off") return { mode: "off", method: methodFor(kindFor(statGroup)), kind: kindFor(statGroup), source };
  const rawMethod = value.method;
  const kind = rawMethod === "smart" || !["study_ready", "exercise_ready", "text_ack"].includes(value.kind) ? kindFor(statGroup) : value.kind;
  return {
    mode: "on",
    method: rawMethod === "text" || rawMethod === "photo" ? rawMethod : methodFor(kind),
    kind,
    source,
    firstFollowUpMinutes: Math.max(1, Number(value.firstFollowUpMinutes ?? defaults.firstFollowUpMinutes) || 10),
    reminderIntervalMinutes: Math.max(1, Number(value.reminderIntervalMinutes ?? defaults.reminderIntervalMinutes) || 20),
  };
}

/**
 * The only reminder/start-verification precedence resolver. Consumers must use
 * this result rather than repeating card/task/stage fallback logic.
 */
export function resolveEffectiveReminderConfig({ card = {}, taskGroup = {}, stage, globalSettings = {}, cardsOfStage = [] } = {}) {
  const resolvedStage = stage || stageForCard(card);
  const statGroup = card.statGroup || taskGroup.categoryStatGroup || "other";
  const stageSettings = globalSettings?.[resolvedStage] || globalSettings?.stages?.[resolvedStage] || {};
  const defaults = {
    advanceMinutes: Math.max(0, Number(globalSettings.defaultAdvanceMinutes) || 5),
    firstFollowUpMinutes: Math.max(1, Number(globalSettings.firstFollowUpMinutes) || 10),
    reminderIntervalMinutes: Math.max(1, Number(globalSettings.reminderIntervalMinutes) || 20),
  };
  const cardReminder = explicit(card.snowdustReminder);
  const groupReminder = explicit(taskGroup.snowdustReminder);
  const stageReminder = explicit(stageSettings.snowdustReminder);
  const globalReminder = explicit(globalSettings.snowdustReminder);
  const reminderSetting = cardReminder || groupReminder || stageReminder || globalReminder;
  const reminderSource = cardReminder ? "card" : groupReminder ? "taskGroup" : stageReminder ? "stageDefault" : "globalDefault";
  const defaultReminderEnabled = Boolean(card.defaultReminderEnabled || card.isFirstStudyCardOfStage);
  const reminderMode = reminderSetting?.mode || (defaultReminderEnabled ? "on" : "off");

  // Stage and global defaults are defaults for the first study/reading card
  // of a stage, not an instruction to request verification on every later
  // study card in that stage. Card/task-group overrides remain explicit and
  // may apply to any card.
  const eligibleFirstStudy = STUDY_GROUPS.has(statGroup) && firstStudyCard(card, cardsOfStage);
  const cardVerification = explicit(verificationOf(card));
  const groupVerification = explicit(verificationOf(taskGroup));
  const stageDefaultVerification = explicit(verificationOf(stageSettings)) || (stageSettings.enabled === false ? { mode: "off" } : (stageSettings.enabled === true ? { mode: "on", method: "smart" } : null));
  const stageVerification = eligibleFirstStudy ? stageDefaultVerification : null;
  const globalVerification = eligibleFirstStudy ? explicit(verificationOf(globalSettings)) : null;
  const verificationSetting = cardVerification || groupVerification || stageVerification || globalVerification;
  const verificationSource = cardVerification ? "card" : groupVerification ? "taskGroup" : stageVerification ? "stageDefault" : "globalDefault";
  // Timeline-derived defaults are calculated by buildReminderPlan from the
  // final cards. Keep this resolver responsible only for precedence.
  const defaultReasons = Array.isArray(card.defaultStartVerificationReasons) ? card.defaultStartVerificationReasons : [];
  const reminderExplicitlyOff = cardReminder?.mode === "off";
  const fallbackVerification = defaultReasons.length ? { mode: "on", method: "smart" } : { mode: "off" };
  const startVerification = resolveVerification(
    cardVerification || groupVerification || (reminderExplicitlyOff ? { mode: "off" } : verificationSetting) || fallbackVerification,
    statGroup,
    reminderExplicitlyOff && !cardVerification && !groupVerification ? "card" : verificationSource,
    defaults,
  );

  return {
    stage: resolvedStage,
    reminder: {
      mode: reminderMode,
      advanceMinutes: Math.max(0, Number(reminderSetting?.advanceMinutes ?? defaults.advanceMinutes) || 0),
      source: reminderSource,
    },
    startVerification,
  };
}

export function startVerificationLabel(value) {
  if (!value || value.mode !== "on") return "不验收";
  if (value.method === "text" || value.kind === "text_ack") return "文字确认";
  return value.kind === "exercise_ready" ? "拍照｜运动准备" : "拍照｜学习环境";
}

export function reminderConfigSourceLabel(source) {
  return ({ card: "卡片自定义", taskGroup: "任务组设置", stageDefault: "阶段默认", globalDefault: "全局默认" })[source] || "全局默认";
}
