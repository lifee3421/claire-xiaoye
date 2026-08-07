import { createRewardChallengeEngine } from "./rewardChallengeEngine.js";
import { REWARD_NOTIFICATIONS_COLLECTION } from "./rewardSurpriseCore.js";
import { normalizeText, toIsoLike } from "./rewardShopCore.js";

const SURPRISE_CHALLENGE_SCHEMA_VERSION = 1;

function text(value, max = 300) {
  return normalizeText(typeof value === "string" ? value : "", max);
}

function safeNotificationId(challengeId) {
  return `challenge-${String(challengeId || "").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 140)}`;
}

function buildFallbackText(challenge = {}) {
  const title = text(challenge.title, 120) || "新的挑战";
  const description = text(challenge.description, 240);
  const rewardName = text(challenge.reward?.name, 120) || "一份奖励";
  const pointPrice = Math.max(0, Number(challenge.pointPrice || 0));
  const rewardText = pointPrice > 0
    ? `完成后可解锁「${rewardName}」，领取时再花 ${pointPrice} 分`
    : `完成后可以领取「${rewardName}」`;
  return `🎯 雪尘给你上新了一个惊喜挑战：${title}${description ? `。${description}` : ""}。${rewardText}。`;
}

export function buildSurpriseChallengeNotification(challenge = {}, { createdAt = "" } = {}) {
  const challengeId = text(challenge.id, 160);
  if (!challengeId) throw new Error("Surprise challenge notification requires challenge.id");
  const notificationId = safeNotificationId(challengeId);
  return {
    id: notificationId,
    schemaVersion: SURPRISE_CHALLENGE_SCHEMA_VERSION,
    type: "surprise_challenge",
    status: "pending",
    eventId: `reward-surprise:${notificationId}`,
    challengeId,
    challengeSnapshot: {
      title: text(challenge.title, 120),
      description: text(challenge.description, 300),
      rewardName: text(challenge.reward?.name, 120),
      pointPrice: Math.max(0, Number(challenge.pointPrice || 0)),
      expiresAt: toIsoLike(challenge.expiresAt) || text(challenge.expiresAt, 80),
      mode: text(challenge.rule?.mode, 40),
      metric: text(challenge.rule?.metric, 60),
      targetCount: Math.max(0, Number(challenge.rule?.targetCount || 0)),
      targetTotal: Math.max(0, Number(challenge.rule?.targetTotal || 0)),
    },
    fallbackText: buildFallbackText(challenge),
    leaseOwner: "",
    leaseUntil: "",
    attemptCount: 0,
    createdAt,
    acknowledgedAt: "",
  };
}

/**
 * Internal/system-only composition for an autonomous surprise challenge.
 *
 * Challenge creation and notification use two idempotent server transactions
 * rather than one giant transaction. This deliberately heals the ambiguous
 * middle state: if the challenge commit succeeds but the process/network dies
 * before the outbox write, the next call replays the SAME challenge id and
 * deterministically creates the missing notification. No duplicate challenge
 * or duplicate notification can be produced.
 */
export function createRewardSurpriseChallengeEngine(port, options = {}, dependencies = {}) {
  if (!port) throw new Error("rewardSurpriseChallengeEngine requires a Firestore port");
  const challengeEngine = dependencies.challengeEngine || createRewardChallengeEngine(port, options);

  async function createSurpriseRewardChallenge(input = {}) {
    const created = await challengeEngine.createRewardChallenge(input);
    if (!created?.ok) return created;

    const challenge = created.challenge;
    const notification = buildSurpriseChallengeNotification(challenge, {
      createdAt: port.now().toISOString(),
    });
    const notificationRef = port.ref(REWARD_NOTIFICATIONS_COLLECTION, notification.id);

    const notificationResult = await port.runTransaction(async (tx) => {
      const snap = await port.txGet(tx, notificationRef);
      if (snap.exists) {
        return {
          replay: true,
          notification: { id: snap.id, ...snap.data },
        };
      }
      port.txSet(tx, notificationRef, {
        ...notification,
        createdAt: port.serverTimestamp(),
        updatedAt: port.serverTimestamp(),
      });
      return { replay: false, notification };
    });

    return {
      ok: true,
      // `replay` means the entire composite operation was already present.
      // If challenge creation replayed but we healed a missing notification,
      // report replay:false so the scheduler knows useful work happened.
      replay: created.replay === true && notificationResult.replay === true,
      challenge,
      notification: notificationResult.notification,
    };
  }

  return { createSurpriseRewardChallenge };
}
