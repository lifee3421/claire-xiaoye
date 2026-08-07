import crypto from "node:crypto";

export const REWARD_CHALLENGES_COLLECTION = "rewardChallenges";
export const REWARD_CHALLENGE_CLAIMS_COLLECTION = "rewardChallengeClaims";
export const REWARD_NOTIFICATIONS_COLLECTION = "rewardNotifications";
export const REWARD_SURPRISE_SCHEMA_VERSION = 1;

export const SURPRISE_KINDS = Object.freeze([
  "limited_time",
  "limited_stock",
  "mystery",
  "discount",
  "event",
]);

const SURPRISE_KIND_SET = new Set(SURPRISE_KINDS);
const REVEAL_MODES = new Set(["immediate", "after_claim"]);
const PUBLISHERS = new Set(["snowdust", "user", "system"]);

function text(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validIso(value) {
  const normalized = text(value, 80);
  if (!normalized) return "";
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

function resolveItemListingStatus(item) {
  if (item?.listingStatus === "active" || item?.listingStatus === "inactive") return item.listingStatus;
  if (item?.status === "paused") return "inactive";
  if (item?.status === "redeemed" && item?.repeatable === false) return "inactive";
  return "active";
}

export function normalizeSurpriseMetadata(input = {}, { now = new Date() } = {}) {
  const enabled = input.enabled === true;
  if (!enabled) return { enabled: false };

  const kind = text(input.kind, 40);
  const revealMode = text(input.revealMode, 40) || (kind === "mystery" ? "after_claim" : "immediate");
  const publishedBy = text(input.publishedBy, 40) || "system";
  const availableFrom = validIso(input.availableFrom) || now.toISOString();
  const expiresAt = validIso(input.expiresAt);

  if (!SURPRISE_KIND_SET.has(kind)) throw new Error(`Unsupported surprise kind: ${kind || "(empty)"}`);
  if (!REVEAL_MODES.has(revealMode)) throw new Error(`Unsupported surprise revealMode: ${revealMode}`);
  if (!PUBLISHERS.has(publishedBy)) throw new Error(`Unsupported surprise publisher: ${publishedBy}`);
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(availableFrom)) {
    throw new Error("Surprise expiresAt must be after availableFrom");
  }

  return {
    schemaVersion: REWARD_SURPRISE_SCHEMA_VERSION,
    enabled: true,
    kind,
    revealMode,
    availableFrom,
    expiresAt,
    notifyOnPublish: input.notifyOnPublish !== false,
    publishedBy,
  };
}

export function surpriseAvailability(item, { now = new Date() } = {}) {
  const surprise = item?.surprise;
  if (!surprise?.enabled) return { surprise: false, available: true, reason: "normal_item" };
  const current = now.getTime();
  const starts = Date.parse(surprise.availableFrom || "");
  const ends = surprise.expiresAt ? Date.parse(surprise.expiresAt) : null;
  if (Number.isFinite(starts) && current < starts) return { surprise: true, available: false, reason: "not_started" };
  if (Number.isFinite(ends) && current >= ends) return { surprise: true, available: false, reason: "expired" };
  if (resolveItemListingStatus(item) !== "active") return { surprise: true, available: false, reason: "inactive" };
  if (item.stock !== null && item.stock !== undefined && Number(item.stock) <= 0) return { surprise: true, available: false, reason: "out_of_stock" };
  return { surprise: true, available: true, reason: "available" };
}

export function buildSurpriseNotification({ itemId, item = {}, surprise = {}, notificationId = "", createdAt = "" } = {}) {
  const id = text(notificationId, 160) || `surprise-${crypto.randomUUID()}`;
  const name = text(item.name, 120);
  if (!itemId || !name) throw new Error("Surprise notification requires itemId and item.name");

  const mystery = surprise.revealMode === "after_claim";
  const safeDescription = mystery ? "完成兑换后揭晓。" : text(item.description, 300);
  const price = Number.isFinite(Number(item.price)) ? Number(item.price) : 0;
  const fallbackText = mystery
    ? `✨ 商城有一件新的神秘惊喜上架了：${name}，${price}分。内容要兑换后才揭晓。`
    : `✨ 商城惊喜上新：${name}，${price}分${safeDescription ? `。${safeDescription}` : ""}`;

  return {
    id,
    schemaVersion: REWARD_SURPRISE_SCHEMA_VERSION,
    type: "surprise_drop",
    status: "pending",
    eventId: `reward-surprise:${id}`,
    itemId,
    itemSnapshot: {
      name,
      price,
      category: text(item.category, 80),
      description: safeDescription,
      mystery,
      expiresAt: text(surprise.expiresAt, 80),
      stock: item.stock ?? null,
    },
    fallbackText,
    leaseOwner: "",
    leaseUntil: "",
    attemptCount: 0,
    createdAt,
    acknowledgedAt: "",
  };
}

export function canLeaseRewardNotification(notification, { now = new Date() } = {}) {
  if (!notification || notification.status === "acknowledged") return false;
  if (notification.status === "pending") return true;
  if (notification.status !== "leased") return false;
  const leaseUntil = Date.parse(notification.leaseUntil || "");
  return !Number.isFinite(leaseUntil) || leaseUntil <= now.getTime();
}

export function planRewardNotificationLease(notification, { owner, now = new Date(), leaseMs = 120_000 } = {}) {
  const leaseOwner = text(owner, 120);
  if (!leaseOwner) throw new Error("Reward notification lease requires owner");

  // A transport failure can happen after Catkeeper committed the lease but
  // before Cyberboss received the response. Retrying from the SAME worker must
  // replay that live lease rather than returning an empty queue and waiting
  // for expiry. A different worker still cannot steal it before leaseUntil.
  if (notification?.status === "leased" && notification?.leaseOwner === leaseOwner) {
    const leaseUntil = Date.parse(notification.leaseUntil || "");
    if (Number.isFinite(leaseUntil) && leaseUntil > now.getTime()) {
      return { ok: true, replay: true, patch: {} };
    }
  }

  if (!canLeaseRewardNotification(notification, { now })) return { ok: false, reason: "not_leaseable" };
  const duration = Math.max(5_000, Math.min(10 * 60_000, Number(leaseMs) || 120_000));
  return {
    ok: true,
    replay: false,
    patch: {
      status: "leased",
      leaseOwner,
      leaseUntil: new Date(now.getTime() + duration).toISOString(),
      attemptCount: Math.max(0, Number(notification?.attemptCount || 0)) + 1,
    },
  };
}

export function planRewardNotificationAck(notification, { owner, now = new Date() } = {}) {
  if (!notification) return { ok: false, reason: "missing" };
  if (notification.status === "acknowledged") return { ok: true, replay: true, patch: {} };
  const leaseOwner = text(owner, 120);
  if (!leaseOwner || notification.leaseOwner !== leaseOwner || notification.status !== "leased") {
    return { ok: false, reason: "lease_mismatch" };
  }
  return {
    ok: true,
    replay: false,
    patch: {
      status: "acknowledged",
      acknowledgedAt: now.toISOString(),
      leaseUntil: "",
    },
  };
}
