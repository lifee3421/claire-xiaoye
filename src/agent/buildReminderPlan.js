export const REMINDER_PLAN_SCHEMA_VERSION = 1;

const DEFAULT_ROLES = new Set(["wake_routine", "morning_study", "lunch", "afternoon_study", "evening_study", "daily_review", "wash"]);

/** Pure, semantic reminder-plan builder. Titles are display-only fallbacks. */
export function buildReminderPlan({ accountId = "claire", localDate, revision = 1, cards = [], timezone = "Asia/Shanghai", generatedAt = new Date().toISOString(), deskVerification = {} } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate || "")) throw new Error("localDate must be YYYY-MM-DD");
  const enriched = enrichCards(cards, deskVerification);
  const reminders = enriched.flatMap((card) => buildCardReminders(card, localDate));
  return { schemaVersion: REMINDER_PLAN_SCHEMA_VERSION, source: "catkeeper", accountId, localDate, timezone, revision: Math.max(1, Number(revision) || 1), generatedAt, cards: enriched.map(publicCard), reminders };
}

function buildCardReminders(card, localDate) {
  const setting = card?.snowdustReminder;
  const role = semanticRole(card);
  const defaultEnabled = DEFAULT_ROLES.has(role);
  if (setting?.enabled === false || (!setting?.enabled && !defaultEnabled)) return [];
  const anchor = setting?.anchor === "end" ? "end" : "start";
  const base = anchor === "end" ? card?.end : card?.start;
  if (!card?.id || !/^\d{2}:\d{2}$/.test(base || "")) return [];
  const offsetMinutes = Number(setting?.offsetMinutes) || 0;
  const scheduledAt = isoAt(localDate, base, offsetMinutes);
  const purpose = setting?.purpose || defaultPurpose(role, anchor);
  const text = setting?.note || defaultText(card, purpose);
  const requiresResponse = setting?.requiresResponse !== false;
  const followUpPolicy = { enabled: setting?.followUp?.enabled !== false && requiresResponse, delayMinutes: Math.max(1, Number(setting?.followUp?.delayMinutes) || 10), maxCount: 1 };
  return [{ sourceCardId: String(card.id), kind: "schedule_reminder", purpose, scheduledAt, deliveryMode: "must_send", requiresResponse, followUpPolicy, offsetMinutes, anchor, text, cardType: card.cardType, stage: card.stage || null, stageEndsAt: card.stageEndsAt || null, isFirstStudyCardOfStage: card.isFirstStudyCardOfStage === true, plannedFocusMinutes: card.plannedFocusMinutes, studyStartVerification: card.studyStartVerification || null }];
}

function semanticRole(card = {}) {
  const value = String(card.systemRole || card.cardType || card.categoryId || card.statGroup || "").trim().toLowerCase();
  if (/morning.*routine|wake/.test(value)) return "wake_routine";
  if (/lunch/.test(value)) return "lunch";
  if (/wash|hygiene/.test(value)) return "wash";
  if (/review/.test(value)) return "daily_review";
  if (value === "study") return "evening_study";
  return value;
}
function defaultPurpose(role, anchor) { if (role === "lunch") return "eat"; if (role === "wash") return "confirm_completion"; return anchor === "end" ? "finish_task" : "start_task"; }
function defaultText(card, purpose) { return purpose === "eat" ? `该吃饭了：${card.title || "午饭"}` : purpose === "confirm_completion" ? `该洗漱了：${card.title || "洗漱"}` : `开始${card.title || "计划事项"}`; }
function isoAt(date, clock, offsetMinutes) { const ms = Date.parse(`${date}T${clock}:00+08:00`) + offsetMinutes * 60_000; const shifted = new Date(ms + 8 * 60 * 60_000).toISOString().slice(0, 19); return `${shifted}+08:00`; }
function enrichCards(cards, settings) { const ordered=(Array.isArray(cards)?cards:[]).map((card)=>({...card,cardType:deriveCardType(card),stage:deriveStage(card),plannedFocusMinutes:Number(card.plannedMinutes||card.plannedFocusMinutes)||0})).sort((a,b)=>String(a.start).localeCompare(String(b.start))); const seen=new Set(); return ordered.map((card)=>{if(card.cardType!=="study"||!card.stage||seen.has(card.stage))return card;seen.add(card.stage);const required=card.stage==="afternoon"||settings[card.stage]?.enabled!==false;return {...card,stageEndsAt:stageEnd(card.stage),isFirstStudyCardOfStage:true,studyStartVerification:required?{required:true,type:"desk_photo",firstFollowUpMinutes:Number(settings.firstFollowUpMinutes)||10,reminderIntervalMinutes:Number(settings.reminderIntervalMinutes)||20}:null};}); }
function stageEnd(stage){return stage==="morning"?"12:30":stage==="afternoon"?"18:00":"23:59";}
function deriveCardType(card={}) { if(card.statGroup==="study"||card.statGroup==="reading")return "study";if(String(card.categoryId||"").includes("lunch")||String(card.categoryId||"").includes("dinner"))return "meal";if(String(card.categoryId||"").includes("shower")||String(card.categoryId||"").includes("hygiene"))return "hygiene";return "other"; }
function deriveStage(card={}) { if(deriveCardType(card)!=="study")return null;const [h,m]=String(card.start||"").split(":").map(Number),minute=h*60+m;if(!Number.isFinite(minute))return null;return minute<750?"morning":minute<1080?"afternoon":"evening"; }
function publicCard(card = {}) { return { id: String(card.id || ""), title: String(card.title || ""), start: card.start || "", end: card.end || "", categoryId: card.categoryId || null, statGroup: card.statGroup || null, systemRole: card.systemRole || null, cardType:card.cardType||"other",stage:card.stage||null,isFirstStudyCardOfStage:card.isFirstStudyCardOfStage===true,studyStartVerification:card.studyStartVerification||null, plannedFocusMinutes: Number(card.plannedFocusMinutes) || 0 }; }
