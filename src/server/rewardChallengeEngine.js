import { roundPoints } from "../utils/calculations.js";
import {
  ERROR_CODES,
  POINT_TRANSACTIONS_COLLECTION,
  PRODUCTS_COLLECTION,
  REWARD_IDEMPOTENCY_COLLECTION,
  REWARD_INSTANCES_COLLECTION,
  REWARD_SHOP_SCHEMA_VERSION,
  buildAccountPatch,
  buildTransactionEntry,
  domainError,
  normalizeIdempotencyKey,
  normalizeShopItemInput,
  normalizeText,
  projectRewardInstance,
  projectShopItem,
  toIsoLike,
} from "./rewardShopCore.js";
import {
  evaluateRewardChallenge,
  normalizeRewardChallengeRule,
  resolveRewardChallengePeriod,
} from "./rewardChallengeCore.js";
import { buildFactsForRewardChallenge } from "./rewardChallengeFacts.js";
import {
  REWARD_CHALLENGE_CLAIMS_COLLECTION,
  REWARD_CHALLENGES_COLLECTION,
  REWARD_NOTIFICATIONS_COLLECTION,
  buildSurpriseNotification,
  normalizeSurpriseMetadata,
  planRewardNotificationAck,
  planRewardNotificationLease,
  surpriseAvailability,
} from "./rewardSurpriseCore.js";

const SETTLEMENTS_COLLECTION = "settlements";
const EXERCISE_RECORDS_COLLECTION = "exerciseRecords";
const COMPLETION_EVENTS_COLLECTION = "completionEvents";
const CHALLENGE_SCHEMA_VERSION = 1;

const CHALLENGE_ERROR = Object.freeze({
  NOT_FOUND: "challenge_not_found",
  NOT_ACTIVE: "challenge_not_active",
  NOT_COMPLETE: "challenge_not_complete",
  ALREADY_CLAIMED: "challenge_already_claimed",
  NOTIFICATION_NOT_FOUND: "reward_notification_not_found",
  NOTIFICATION_LEASE_CONFLICT: "reward_notification_lease_conflict",
});

function text(value, max = 300) {
  return normalizeText(typeof value === "string" ? value : "", max);
}

function nowIso(port) {
  return port.now().toISOString();
}

function beijingDate(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeRewardSnapshot(input = {}) {
  const name = text(input.name, 120);
  if (!name) throw new Error("challenge reward name is required");
  return {
    name,
    description: text(input.description, 500),
    categoryId: text(input.categoryId || input.category, 60) || "challenge",
    icon: text(input.icon, 30),
  };
}

function normalizeChallengeInput(input = {}, { now = new Date() } = {}) {
  const title = text(input.title, 120);
  if (!title) throw new Error("challenge title is required");
  const rule = normalizeRewardChallengeRule(input.rule || {});
  const reward = normalizeRewardSnapshot(input.reward || {});
  const pointPrice = Number(input.pointPrice ?? 0);
  if (!Number.isFinite(pointPrice) || pointPrice < 0 || !Number.isInteger(pointPrice)) {
    throw new Error("challenge pointPrice must be a non-negative integer");
  }
  const redemptionMode = pointPrice > 0 ? "hybrid" : "challenge";
  const startsAt = input.startsAt && !Number.isNaN(Date.parse(input.startsAt))
    ? new Date(input.startsAt).toISOString()
    : now.toISOString();
  const expiresAt = input.expiresAt && !Number.isNaN(Date.parse(input.expiresAt))
    ? new Date(input.expiresAt).toISOString()
    : "";
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) throw new Error("challenge expiresAt must be after startsAt");
  return {
    schemaVersion: CHALLENGE_SCHEMA_VERSION,
    title,
    description: text(input.description, 500),
    rule,
    reward,
    redemptionMode,
    pointPrice,
    status: input.status === "inactive" ? "inactive" : "active",
    startsAt,
    expiresAt,
    createdBy: text(input.createdBy, 40) || "snowdust",
    state: "locked",
    claimedRewardInstanceId: "",
  };
}

function challengeAvailability(challenge, { now = new Date() } = {}) {
  if (!challenge || challenge.status === "inactive") return { active: false, reason: "inactive" };
  const current = now.getTime();
  const starts = Date.parse(challenge.startsAt || "");
  const expires = challenge.expiresAt ? Date.parse(challenge.expiresAt) : null;
  if (Number.isFinite(starts) && current < starts) return { active: false, reason: "not_started" };
  if (Number.isFinite(expires) && current >= expires) return { active: false, reason: "expired" };
  return { active: true, reason: "active" };
}

function projectChallenge(challenge, progress = null) {
  return {
    id: challenge.id,
    title: challenge.title || "",
    description: challenge.description || "",
    redemptionMode: challenge.redemptionMode || (Number(challenge.pointPrice || 0) > 0 ? "hybrid" : "challenge"),
    pointPrice: Number(challenge.pointPrice || 0),
    reward: challenge.reward || null,
    rule: challenge.rule || null,
    status: challenge.status || "active",
    state: challenge.state || "locked",
    startsAt: toIsoLike(challenge.startsAt) || challenge.startsAt || "",
    expiresAt: toIsoLike(challenge.expiresAt) || challenge.expiresAt || "",
    claimedRewardInstanceId: challenge.claimedRewardInstanceId || "",
    progress,
  };
}

function projectNotification(notification) {
  if (!notification) return null;
  return {
    id: notification.id,
    type: notification.type || "surprise_drop",
    status: notification.status || "pending",
    eventId: notification.eventId || `reward-surprise:${notification.id}`,
    itemId: notification.itemId || "",
    itemSnapshot: notification.itemSnapshot || null,
    fallbackText: notification.fallbackText || "",
    leaseOwner: notification.leaseOwner || "",
    leaseUntil: notification.leaseUntil || "",
    attemptCount: Number(notification.attemptCount || 0),
    createdAt: toIsoLike(notification.createdAt) || notification.createdAt || "",
    acknowledgedAt: toIsoLike(notification.acknowledgedAt) || notification.acknowledgedAt || "",
  };
}

export function createRewardChallengeEngine(port, { actor = "web" } = {}) {
  if (!port) throw new Error("rewardChallengeEngine requires a Firestore port");

  async function loadChallengeSources() {
    const [settlements, exerciseRecords, completionEvents] = await Promise.all([
      port.listDocs(SETTLEMENTS_COLLECTION, {}),
      port.listDocs(EXERCISE_RECORDS_COLLECTION, {}),
      port.listDocs(COMPLETION_EVENTS_COLLECTION, {}),
    ]);
    return { settlements, exerciseRecords, completionEvents };
  }

  async function progressFor(challenge, sources = null) {
    const availability = challengeAvailability(challenge, { now: port.now() });
    if (!availability.active) {
      return {
        status: availability.reason === "expired" ? "expired" : "locked",
        completed: false,
        current: 0,
        target: challenge?.rule?.targetCount || challenge?.rule?.targetTotal || 0,
        availability,
      };
    }
    const period = resolveRewardChallengePeriod(challenge.rule, { today: beijingDate(port.now()) });
    const loaded = sources || await loadChallengeSources();
    const facts = buildFactsForRewardChallenge(challenge.rule, loaded, period);
    const progress = evaluateRewardChallenge(challenge.rule, facts, { today: beijingDate(port.now()) });
    if (challenge.state === "claimed") return { ...progress, status: "claimed", completed: true };
    return { ...progress, availability };
  }

  async function listRewardChallenges({ includeInactive = false } = {}) {
    const rows = await port.listDocs(REWARD_CHALLENGES_COLLECTION, {});
    const pool = includeInactive ? rows : rows.filter((row) => row.status !== "inactive");
    const sources = await loadChallengeSources();
    const challenges = await Promise.all(pool.map(async (row) => projectChallenge(row, await progressFor(row, sources))));
    challenges.sort((a, b) => String(a.expiresAt || "9999").localeCompare(String(b.expiresAt || "9999")));
    return { ok: true, challenges };
  }

  async function getRewardChallengeProgress({ challengeId = "" } = {}) {
    const id = text(challengeId, 120);
    if (!id) return domainError(ERROR_CODES.INVALID_INPUT, "需要 challengeId。");
    const snap = await port.getDoc(REWARD_CHALLENGES_COLLECTION, id);
    if (!snap.exists) return domainError(CHALLENGE_ERROR.NOT_FOUND, "找不到这个挑战。", { challengeId: id });
    const challenge = { id: snap.id, ...snap.data };
    return { ok: true, challenge: projectChallenge(challenge, await progressFor(challenge)) };
  }

  async function createRewardChallenge({ idempotencyKey = "", ...input } = {}) {
    let normalized;
    try {
      normalized = normalizeChallengeInput(input, { now: port.now() });
    } catch (error) {
      return domainError(ERROR_CODES.INVALID_INPUT, error.message);
    }
    const idem = normalizeIdempotencyKey(idempotencyKey, { operation: "challenge-create" });
    if (!idem) return domainError(ERROR_CODES.IDEMPOTENCY_REQUIRED, "创建挑战需要稳定的 idempotencyKey。");
    const idemRef = port.ref(REWARD_IDEMPOTENCY_COLLECTION, idem.docId);
    const challengeRef = port.ref(REWARD_CHALLENGES_COLLECTION);
    return await port.runTransaction(async (tx) => {
      const idemSnap = await port.txGet(tx, idemRef);
      if (idemSnap.exists) return { ok: true, replay: true, ...(idemSnap.data.result || {}) };
      const challenge = {
        ...normalized,
        createdAt: port.serverTimestamp(),
        updatedAt: port.serverTimestamp(),
      };
      const result = { challenge: projectChallenge({ id: challengeRef.id, ...normalized }) };
      port.txSet(tx, challengeRef, challenge);
      port.txSet(tx, idemRef, {
        operation: "challenge-create",
        key: idem.key,
        result,
        createdAt: port.serverTimestamp(),
      });
      return { ok: true, replay: false, ...result };
    });
  }

  async function claimRewardChallenge({ challengeId = "", idempotencyKey = "" } = {}) {
    const id = text(challengeId, 120);
    if (!id) return domainError(ERROR_CODES.INVALID_INPUT, "需要 challengeId。");
    const idem = normalizeIdempotencyKey(idempotencyKey, { operation: "challenge-claim" });
    if (!idem) return domainError(ERROR_CODES.IDEMPOTENCY_REQUIRED, "领取挑战奖励需要稳定的 idempotencyKey。");

    // Recompute from authoritative source documents immediately before the
    // atomic claim. The claim transaction protects all side effects and
    // duplicate claims; source edits later naturally change future reads.
    const challengeSnap = await port.getDoc(REWARD_CHALLENGES_COLLECTION, id);
    if (!challengeSnap.exists) return domainError(CHALLENGE_ERROR.NOT_FOUND, "找不到这个挑战。", { challengeId: id });
    const observed = { id: challengeSnap.id, ...challengeSnap.data };
    const progress = await progressFor(observed);
    if (!progress.completed) {
      return domainError(CHALLENGE_ERROR.NOT_COMPLETE, "这个挑战还没有完成。", { challengeId: id, progress });
    }

    const challengeRef = port.ref(REWARD_CHALLENGES_COLLECTION, id);
    const idemRef = port.ref(REWARD_IDEMPOTENCY_COLLECTION, idem.docId);
    const profileRef = port.profileRef();
    const rewardRef = port.ref(REWARD_INSTANCES_COLLECTION);
    const claimRef = port.ref(REWARD_CHALLENGE_CLAIMS_COLLECTION, id);
    const transactionRef = port.ref(POINT_TRANSACTIONS_COLLECTION);

    return await port.runTransaction(async (tx) => {
      // Firestore requires every read before every write.
      const [idemSnap, liveChallengeSnap, profileSnap] = await Promise.all([
        port.txGet(tx, idemRef),
        port.txGet(tx, challengeRef),
        port.txGet(tx, profileRef),
      ]);
      if (idemSnap.exists) return { ok: true, replay: true, ...(idemSnap.data.result || {}) };
      if (!liveChallengeSnap.exists) return domainError(CHALLENGE_ERROR.NOT_FOUND, "找不到这个挑战。", { challengeId: id });
      const challenge = { id, ...liveChallengeSnap.data };
      if (challenge.state === "claimed" || challenge.claimedRewardInstanceId) {
        return domainError(CHALLENGE_ERROR.ALREADY_CLAIMED, "这个挑战奖励已经领取过了。", {
          challengeId: id,
          rewardInstanceId: challenge.claimedRewardInstanceId || "",
        });
      }
      const availability = challengeAvailability(challenge, { now: port.now() });
      if (!availability.active) return domainError(CHALLENGE_ERROR.NOT_ACTIVE, "这个挑战当前不可领取。", { reason: availability.reason });

      const profile = profileSnap.exists ? profileSnap.data : {};
      const price = Math.max(0, Number(challenge.pointPrice || 0));
      const balanceBefore = roundPoints(Number(profile.points || 0));
      if (balanceBefore < price) {
        return domainError(ERROR_CODES.INSUFFICIENT_POINTS, `积分不够，还差 ${roundPoints(price - balanceBefore)} 分。`, {
          balance: balanceBefore,
          price,
          shortBy: roundPoints(price - balanceBefore),
        });
      }
      const balanceAfter = roundPoints(balanceBefore - price);
      const reward = challenge.reward || {};
      const itemSnapshot = {
        name: text(reward.name, 120),
        price,
        categoryId: text(reward.categoryId, 60) || "challenge",
        description: text(reward.description, 500),
        icon: text(reward.icon, 30),
        challengeId: id,
        challengeTitle: challenge.title || "",
      };
      const rewardInstance = {
        schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
        shopItemId: "",
        itemSnapshot,
        pricePaid: price,
        status: "available",
        usedAt: null,
        expiresAt: null,
        idempotencyKey: idem.key,
        source: "reward_challenge",
        challengeId: id,
        redeemedAt: port.serverTimestamp(),
        createdAt: port.serverTimestamp(),
        updatedAt: port.serverTimestamp(),
      };
      const result = {
        challengeId: id,
        reward: projectRewardInstance({ id: rewardRef.id, ...rewardInstance }),
        pointsSpent: price,
        balanceBefore,
        balanceAfter,
      };

      if (price > 0) {
        port.txSet(tx, profileRef, {
          ...buildAccountPatch(profile, { balanceAfter, spentDelta: price }),
          updatedAt: port.serverTimestamp(),
        }, { merge: true });
        port.txSet(tx, transactionRef, {
          ...buildTransactionEntry({
            type: "redeem",
            amount: price,
            balanceBefore,
            balanceAfter,
            source: "reward_challenge_claim",
            rewardInstanceId: rewardRef.id,
            description: `挑战奖励 ${itemSnapshot.name}`,
            idempotencyKey: idem.key,
            actor,
          }),
          createdAt: port.serverTimestamp(),
        });
      }
      port.txSet(tx, rewardRef, rewardInstance);
      port.txSet(tx, challengeRef, {
        state: "claimed",
        claimedRewardInstanceId: rewardRef.id,
        claimedAt: port.serverTimestamp(),
        updatedAt: port.serverTimestamp(),
      }, { merge: true });
      port.txSet(tx, claimRef, {
        schemaVersion: CHALLENGE_SCHEMA_VERSION,
        challengeId: id,
        rewardInstanceId: rewardRef.id,
        pointsSpent: price,
        progressSnapshot: progress,
        actor,
        createdAt: port.serverTimestamp(),
      }, { merge: false });
      port.txSet(tx, idemRef, {
        operation: "challenge-claim",
        key: idem.key,
        result,
        createdAt: port.serverTimestamp(),
      });
      return { ok: true, replay: false, ...result };
    });
  }

  async function publishSurpriseDrop({ idempotencyKey = "", surprise = {}, ...itemInput } = {}) {
    const idem = normalizeIdempotencyKey(idempotencyKey, { operation: "surprise-publish" });
    if (!idem) return domainError(ERROR_CODES.IDEMPOTENCY_REQUIRED, "惊喜上新需要稳定的 idempotencyKey。");
    const normalizedItem = normalizeShopItemInput(itemInput, { existing: null });
    if (!normalizedItem.valid) return domainError(ERROR_CODES.INVALID_INPUT, normalizedItem.errors.join("；"), { errors: normalizedItem.errors });
    let normalizedSurprise;
    try {
      normalizedSurprise = normalizeSurpriseMetadata({ ...surprise, enabled: true }, { now: port.now() });
    } catch (error) {
      return domainError(ERROR_CODES.INVALID_INPUT, error.message);
    }

    const idemRef = port.ref(REWARD_IDEMPOTENCY_COLLECTION, idem.docId);
    const itemRef = port.ref(PRODUCTS_COLLECTION);
    const notificationRef = port.ref(REWARD_NOTIFICATIONS_COLLECTION);
    const createdAt = nowIso(port);
    const publicPatch = { ...normalizedItem.patch };
    if (normalizedSurprise.revealMode === "after_claim") {
      // Never put the hidden reveal in a field the ordinary shop projection
      // exposes. The private reveal can be added to the reward instance by a
      // dedicated mystery-reveal follow-up; v1 publication itself cannot leak.
      publicPatch.description = text(itemInput.publicDescription, 500) || "完成兑换后揭晓。";
    }
    const payload = {
      ...publicPatch,
      schemaVersion: REWARD_SHOP_SCHEMA_VERSION,
      surprise: {
        ...normalizedSurprise,
        // Stored in a nested private field ignored by current list projection.
        // Do not include it in notification snapshots/logs.
        revealDescription: normalizedSurprise.revealMode === "after_claim" ? text(itemInput.revealDescription, 500) : "",
      },
      createdAt: port.serverTimestamp(),
      updatedAt: port.serverTimestamp(),
    };
    const notification = normalizedSurprise.notifyOnPublish
      ? buildSurpriseNotification({
          notificationId: notificationRef.id,
          itemId: itemRef.id,
          item: { id: itemRef.id, ...publicPatch },
          surprise: normalizedSurprise,
          createdAt,
        })
      : null;

    return await port.runTransaction(async (tx) => {
      const idemSnap = await port.txGet(tx, idemRef);
      if (idemSnap.exists) return { ok: true, replay: true, ...(idemSnap.data.result || {}) };
      const result = {
        item: projectShopItem({ id: itemRef.id, ...publicPatch }),
        notification: notification ? projectNotification(notification) : null,
      };
      port.txSet(tx, itemRef, payload);
      if (notification) {
        port.txSet(tx, notificationRef, {
          ...notification,
          createdAt: port.serverTimestamp(),
          updatedAt: port.serverTimestamp(),
        });
      }
      port.txSet(tx, idemRef, {
        operation: "surprise-publish",
        key: idem.key,
        result,
        createdAt: port.serverTimestamp(),
      });
      return { ok: true, replay: false, ...result };
    });
  }

  async function listSurpriseDrops({ includeExpired = false } = {}) {
    const rows = await port.listDocs(PRODUCTS_COLLECTION, {});
    const surprises = rows
      .filter((row) => row?.surprise?.enabled)
      .map((row) => ({
        ...projectShopItem(row),
        surprise: {
          enabled: true,
          kind: row.surprise.kind || "event",
          revealMode: row.surprise.revealMode || "immediate",
          availableFrom: row.surprise.availableFrom || "",
          expiresAt: row.surprise.expiresAt || "",
          availability: surpriseAvailability(row, { now: port.now() }),
        },
      }))
      .filter((row) => includeExpired || row.surprise.availability.available);
    return { ok: true, items: surprises };
  }

  async function leaseRewardNotification({ workerId = "", leaseMs = 120_000 } = {}) {
    const owner = text(workerId, 120);
    if (!owner) return domainError(ERROR_CODES.INVALID_INPUT, "需要 workerId。");
    const candidates = await port.listDocs(REWARD_NOTIFICATIONS_COLLECTION, {});
    const sorted = candidates
      .filter((row) => row.status !== "acknowledged")
      .sort((a, b) => String(toIsoLike(a.createdAt) || a.createdAt || "").localeCompare(String(toIsoLike(b.createdAt) || b.createdAt || "")));

    for (const candidate of sorted) {
      const ref = port.ref(REWARD_NOTIFICATIONS_COLLECTION, candidate.id);
      const result = await port.runTransaction(async (tx) => {
        const snap = await port.txGet(tx, ref);
        if (!snap.exists) return null;
        const current = { id: snap.id, ...snap.data };
        const plan = planRewardNotificationLease(current, { owner, now: port.now(), leaseMs });
        if (!plan.ok) return null;
        port.txSet(tx, ref, { ...plan.patch, updatedAt: port.serverTimestamp() }, { merge: true });
        return { ...current, ...plan.patch };
      });
      if (result) return { ok: true, notification: projectNotification(result) };
    }
    return { ok: true, notification: null };
  }

  async function ackRewardNotification({ notificationId = "", workerId = "" } = {}) {
    const id = text(notificationId, 160);
    const owner = text(workerId, 120);
    if (!id || !owner) return domainError(ERROR_CODES.INVALID_INPUT, "需要 notificationId 和 workerId。");
    const ref = port.ref(REWARD_NOTIFICATIONS_COLLECTION, id);
    return await port.runTransaction(async (tx) => {
      const snap = await port.txGet(tx, ref);
      if (!snap.exists) return domainError(CHALLENGE_ERROR.NOTIFICATION_NOT_FOUND, "找不到这条奖励通知。", { notificationId: id });
      const current = { id: snap.id, ...snap.data };
      const plan = planRewardNotificationAck(current, { owner, now: port.now() });
      if (!plan.ok) {
        return domainError(CHALLENGE_ERROR.NOTIFICATION_LEASE_CONFLICT, "通知租约不匹配，未确认送达。", { reason: plan.reason });
      }
      if (!plan.replay) port.txSet(tx, ref, { ...plan.patch, updatedAt: port.serverTimestamp() }, { merge: true });
      return { ok: true, replay: plan.replay, notification: projectNotification({ ...current, ...plan.patch }) };
    });
  }

  return {
    listRewardChallenges,
    getRewardChallengeProgress,
    createRewardChallenge,
    claimRewardChallenge,
    publishSurpriseDrop,
    listSurpriseDrops,
    leaseRewardNotification,
    ackRewardNotification,
  };
}

export { CHALLENGE_ERROR };
