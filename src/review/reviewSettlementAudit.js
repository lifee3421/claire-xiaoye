import { roundPoints } from "../utils/calculations.js";

export const REVIEW_POINT_COMPONENTS = Object.freeze([
  { key: "bankPointsAdded", label: "时间价值转分" },
  { key: "sleepAdjustmentPoints", label: "睡眠积分" },
  { key: "exerciseBonusPoints", label: "运动额外积分" },
  { key: "workPoints", label: "工作积分" },
  { key: "dayTypeBonusPoints", label: "日型额外奖励" },
  { key: "entertainmentScoreDelta", label: "自由娱乐积分" },
  { key: "reviewTimelinessBonus", label: "复盘归档奖励" },
]);

function number(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? roundPoints(numeric) : 0;
}

export function diffReviewPointSources(previous = {}, next = {}) {
  return REVIEW_POINT_COMPONENTS
    .map(({ key, label }) => {
      const before = number(previous?.[key]);
      const after = number(next?.[key]);
      return { key, label, before, after, delta: roundPoints(after - before) };
    })
    .filter((item) => item.delta !== 0);
}

export function reviewPointSourceSummary(changes = []) {
  if (!Array.isArray(changes) || changes.length === 0) return "积分构成未变化";
  return changes
    .map((item) => `${item.label} ${item.delta > 0 ? "+" : ""}${roundPoints(item.delta)}分`)
    .join("、");
}

export function auditActorLabel(actor = "") {
  if (actor === "web") return "你在网页亲自提交";
  if (actor === "cyberboss") return "雪尘 / Cyberboss";
  if (actor === "server") return "系统";
  return "提交来源未记录";
}

export function toAuditIso(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") {
    try { return value.toDate().toISOString(); } catch { return ""; }
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  if (typeof value?._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  return "";
}

export function formatAuditDateTime(value) {
  const iso = toAuditIso(value);
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms)).replaceAll("/", "-");
}

export function normalizeSettlementAudit(audit = {}, fallback = {}) {
  const revisions = Array.isArray(audit?.revisions)
    ? audit.revisions
    : Array.isArray(fallback?.reconciliationHistory)
      ? fallback.reconciliationHistory
      : [];
  const initialPointsAdded = audit?.initialPointsAdded ?? revisions[0]?.beforePointsAdded ?? fallback?.pointsAdded ?? 0;
  return {
    firstSubmittedAt: audit?.firstSubmittedAt || fallback?.firstSubmittedAt || fallback?.submittedAt || fallback?.createdAt || "",
    firstSubmittedActor: audit?.firstSubmittedActor || fallback?.firstSubmittedActor || "",
    initialPointsAdded: number(initialPointsAdded),
    revisions: revisions.map((entry) => ({
      ...entry,
      beforePointsAdded: number(entry?.beforePointsAdded),
      afterPointsAdded: number(entry?.afterPointsAdded),
      delta: number(entry?.delta),
      sourceChanges: Array.isArray(entry?.sourceChanges) ? entry.sourceChanges : [],
      sourceSummary: entry?.sourceSummary || reviewPointSourceSummary(entry?.sourceChanges || []),
    })),
  };
}
