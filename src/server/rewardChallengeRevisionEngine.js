import {
  ERROR_CODES,
  REWARD_IDEMPOTENCY_COLLECTION,
  domainError,
  normalizeIdempotencyKey,
  normalizeText,
  toIsoLike,
} from "./rewardShopCore.js";
import { normalizeRewardChallengeRule } from "./rewardChallengeCore.js";
import { CHALLENGE_ERROR } from "./rewardChallengeEngine.js";
import { REWARD_CHALLENGES_COLLECTION } from "./rewardSurpriseCore.js";

const CHALLENGE_SCHEMA_VERSION = 1;

function text(value, max = 300) {
  return normalizeText(typeof value === "string" ? value : "", max);
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

function normalizeReplacement(current, patch = {}, { now = new Date() } = {}) {
  const title = text(patch.title !== undefined ? patch.title : current.title, 120);
  if (!title) throw new Error("challenge title is required");
  const rule = normalizeRewardChallengeRule(patch.rule !== undefined ? patch.rule : current.rule || {});
  const reward = normalizeRewardSnapshot(patch.reward !== undefined ? patch.reward : current.reward || {});
  const pointPrice = Number(patch.pointPrice !== undefined ? patch.pointPrice : current.pointPrice || 0);
  if (!Number.isFinite(pointPrice) || pointPrice < 0 || !Number.isInteger(pointPrice)) {
    throw new Error("challenge pointPrice must be a non-negative integer");
  }
  const startsSource = patch.startsAt !== undefined ? patch.startsAt : current.startsAt;
  const expiresSource = patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt;
  const startsAt = startsSource && !Number.isNaN(Date.parse(startsSource))
    ? new Date(startsSource).toISOString()
    : now.toISOString();
  const expiresAt = expiresSource && !Number.isNaN(Date.parse(expiresSource))
    ? new Date(expiresSource).toISOString()
    : "";
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw new Error("challenge expiresAt must be after startsAt");
  }
  return {
    schemaVersion: CHALLENGE_SCHEMA_VERSION,
    title,
    description: text(patch.description !== undefined ? patch.description : current.description, 500),
    rule,
    reward,
    redemptionMode: pointPrice > 0 ? "hybrid" : "challenge",
    pointPrice,
    status: "active",
    startsAt,
    expiresAt,
    createdBy: "snowdust",
    state: "locked",
    claimedRewardInstanceId: "",
  };
}

function isCurrentlyActive(challenge, now) {
  if (!challenge || challenge.status === "inactive" || challenge.state === "superseded") return false;
  const current = now.getTime();
  const starts = Date.parse(challenge.startsAt || "");
  const expires = challenge.expiresAt ? Date.parse(challenge.expiresAt) : null;
  if (Number.isFinite(starts) && current < starts) return false;
  if (Number.isFinite(expires) && current >= expires) return false;
  return true;
}

function projectRevisionChallenge(challenge) {
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
    revisionOfChallengeId: challenge.revisionOfChallengeId || "",
    supersededByChallengeId: challenge.supersededByChallengeId || "",
    revisionReason: challenge.revisionReason || "",
  };
}

export function createRewardChallengeRevisionEngine(port, { actor = "web" } = {}) {
  if (!port) throw new Error("rewardChallengeRevisionEngine requires a Firestore port");

  async function reviseRewardChallenge({
    challengeId = "",
    idempotencyKey = "",
    reason = "",
    ...patch
  } = {}) {
    const id = text(challengeId, 120);
    if (!id) return domainError(ERROR_CODES.INVALID_INPUT, "需要 challengeId。");
    const idem = normalizeIdempotencyKey(idempotencyKey, { operation: "challenge-revise" });
    if (!idem) return domainError(ERROR_CODES.IDEMPOTENCY_REQUIRED, "调整挑战需要稳定的 idempotencyKey。");

    const oldRef = port.ref(REWARD_CHALLENGES_COLLECTION, id);
    const newRef = port.ref(REWARD_CHALLENGES_COLLECTION);
    const idemRef = port.ref(REWARD_IDEMPOTENCY_COLLECTION, idem.docId);

    return await port.runTransaction(async (tx) => {
      const [idemSnap, oldSnap] = await Promise.all([
        port.txGet(tx, idemRef),
        port.txGet(tx, oldRef),
      ]);
      if (idemSnap.exists) return { ok: true, replay: true, ...(idemSnap.data.result || {}) };
      if (!oldSnap.exists) return domainError(CHALLENGE_ERROR.NOT_FOUND, "找不到这个挑战。", { challengeId: id });

      const current = { id, ...oldSnap.data };
      if (current.state === "claimed" || current.claimedRewardInstanceId) {
        return domainError(CHALLENGE_ERROR.ALREADY_CLAIMED, "已经领取过的挑战不能再调整。", {
          challengeId: id,
          rewardInstanceId: current.claimedRewardInstanceId || "",
        });
      }
      if (!isCurrentlyActive(current, port.now())) {
        return domainError(CHALLENGE_ERROR.NOT_ACTIVE, "只有当前生效中的挑战才能调整。", {
          challengeId: id,
          reason: current.state === "superseded" ? "superseded" : "inactive_or_outside_window",
        });
      }

      let replacement;
      try {
        replacement = normalizeReplacement(current, patch, { now: port.now() });
      } catch (error) {
        return domainError(ERROR_CODES.INVALID_INPUT, error.message);
      }

      const revisionReason = text(reason, 300) || "user_requested_revision";
      const successor = {
        ...replacement,
        revisionOfChallengeId: id,
        revisionReason,
        revisionActor: actor,
        createdAt: port.serverTimestamp(),
        updatedAt: port.serverTimestamp(),
      };
      const previousPatch = {
        status: "inactive",
        state: "superseded",
        supersededByChallengeId: newRef.id,
        supersededReason: revisionReason,
        supersededByActor: actor,
        supersededAt: port.serverTimestamp(),
        updatedAt: port.serverTimestamp(),
      };
      const result = {
        previousChallenge: projectRevisionChallenge({ ...current, ...previousPatch }),
        challenge: projectRevisionChallenge({ id: newRef.id, ...successor }),
      };

      port.txSet(tx, newRef, successor);
      port.txSet(tx, oldRef, previousPatch, { merge: true });
      port.txSet(tx, idemRef, {
        operation: "challenge-revise",
        key: idem.key,
        result,
        createdAt: port.serverTimestamp(),
      });
      return { ok: true, replay: false, ...result };
    });
  }

  return { reviseRewardChallenge };
}
