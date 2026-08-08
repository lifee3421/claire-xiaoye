import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { callRewardShop } from "../services/rewardShopApi.js";
import {
  challengeProgressText,
  challengeRewardText,
  challengeRuleText,
  challengeStatus,
  progressPercent,
  surpriseDescription,
  surpriseMetaText,
} from "./rewardShopGameView.js";
import "./rewardShopGamePanels.css";

/**
 * Keeps the new reward-game UI modular instead of adding more code to the
 * already very large App.jsx. The existing Mall exposes `.mall-tool-panel` as
 * a stable page-local anchor; this host only exists while that page is mounted.
 */
export default function RewardShopGamePanelsHost() {
  const [mountNode, setMountNode] = useState(null);
  const nodeRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    function syncMount() {
      if (disposed) return;
      const mallToolbar = document.querySelector(".mall-tool-panel");
      const current = nodeRef.current;

      if (!mallToolbar) {
        if (current?.isConnected) current.remove();
        nodeRef.current = null;
        setMountNode(null);
        return;
      }

      if (current?.isConnected && current.parentElement === mallToolbar.parentElement) return;
      if (current?.isConnected) current.remove();

      const node = document.createElement("div");
      node.className = "reward-game-panels-host";
      node.dataset.rewardGamePanels = "true";
      mallToolbar.insertAdjacentElement("afterend", node);
      nodeRef.current = node;
      setMountNode(node);
    }

    syncMount();
    const observer = new MutationObserver(syncMount);
    observer.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
      if (nodeRef.current?.isConnected) nodeRef.current.remove();
      nodeRef.current = null;
    };
  }, []);

  return mountNode ? createPortal(<RewardShopGamePanels />, mountNode) : null;
}

function RewardShopGamePanels() {
  const [surprises, setSurprises] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [claimingId, setClaimingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [surpriseResult, challengeResult] = await Promise.all([
        callRewardShop("list_surprise_drops", { includeExpired: false }),
        callRewardShop("list_reward_challenges", { includeInactive: false }),
      ]);
      setSurprises(Array.isArray(surpriseResult.items) ? surpriseResult.items : []);
      setChallenges(Array.isArray(challengeResult.challenges) ? challengeResult.challenges : []);
    } catch (err) {
      setError(err?.message || "惊喜商城暂时没有加载成功。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function claimChallenge(challenge) {
    if (!challenge?.id || claimingId) return;
    setClaimingId(challenge.id);
    setError("");
    setNotice("");
    try {
      const result = await callRewardShop("claim_reward_challenge", {
        challengeId: challenge.id,
        // A challenge can only be claimed once, so this is naturally stable
        // across an uncertain browser retry and prevents duplicate rewards.
        idempotencyKey: `web-challenge-claim:${challenge.id}`,
      });
      const rewardName = result.reward?.itemSnapshot?.name || challenge.reward?.name || "挑战奖励";
      setNotice(`🎁 已领取「${rewardName}」，已经放进你的可用奖励里。`);
      await load();
    } catch (err) {
      setError(err?.message || "挑战奖励没有领取成功，请稍后再试。");
    } finally {
      setClaimingId("");
    }
  }

  return (
    <div className="reward-game-panels">
      <div className="reward-game-heading">
        <div>
          <span className="reward-game-kicker">雪尘的小彩蛋</span>
          <strong>商城今天会不会发生一点意外？</strong>
        </div>
        <button type="button" className="reward-game-refresh" onClick={load} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error && <div className="reward-game-message reward-game-error">{error}</div>}
      {notice && <div className="reward-game-message reward-game-success">{notice}</div>}

      <section className="reward-game-panel reward-game-surprises" aria-label="惊喜上新">
        <div className="reward-game-panel-title">
          <div><span>✨</span><strong>惊喜上新</strong></div>
          <small>没有固定时间；出现时雪尘也会在微信告诉你</small>
        </div>
        {loading ? (
          <p className="reward-game-empty">正在看看今天有没有偷偷上新…</p>
        ) : surprises.length === 0 ? (
          <p className="reward-game-empty">今天这里静悄悄的。惊喜不是每天都有，所以才叫惊喜。</p>
        ) : (
          <div className="reward-game-card-grid">
            {surprises.map((item) => (
              <article className="reward-game-card reward-game-surprise-card" key={item.id}>
                <div className="reward-game-card-top">
                  <span className="reward-game-badge">{surpriseKindLabel(item.surprise?.kind)}</span>
                  <strong>{Number(item.price || 0)} 分</strong>
                </div>
                <h3>{item.name || "神秘惊喜"}</h3>
                <p>{surpriseDescription(item)}</p>
                <div className="reward-game-meta">{surpriseMetaText(item)}</div>
                <button type="button" className="reward-game-secondary" onClick={scrollToProductShelf}>
                  去商品货架兑换
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="reward-game-panel reward-game-challenges" aria-label="雪尘的挑战">
        <div className="reward-game-panel-title">
          <div><span>🎯</span><strong>雪尘的挑战</strong></div>
          <small>进度只认小猫管家能验证的数据，不靠聊天里“我做了”</small>
        </div>
        {loading ? (
          <p className="reward-game-empty">正在核对挑战进度…</p>
        ) : challenges.length === 0 ? (
          <p className="reward-game-empty">现在没有进行中的挑战。雪尘以后可能会突然给你一个小目标。</p>
        ) : (
          <div className="reward-game-challenge-list">
            {challenges.map((challenge) => {
              const status = challengeStatus(challenge);
              const percent = progressPercent(challenge);
              return (
                <article className={`reward-game-card reward-game-challenge-card status-${status.key}`} key={challenge.id}>
                  <div className="reward-game-card-top">
                    <span className="reward-game-status">{status.label}</span>
                    <span>{challengeProgressText(challenge)}</span>
                  </div>
                  <h3>{challenge.title || "雪尘的小挑战"}</h3>
                  <p className="reward-game-rule">{challengeRuleText(challenge)}</p>
                  <div className="reward-game-progress" aria-label={`完成度 ${percent}%`}>
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <div className="reward-game-reward">🎁 {challengeRewardText(challenge)}</div>
                  {challenge.expiresAt && <div className="reward-game-meta">截止 {formatBeijing(challenge.expiresAt)}</div>}
                  {status.claimable && (
                    <button
                      type="button"
                      className="reward-game-primary"
                      disabled={claimingId === challenge.id}
                      onClick={() => claimChallenge(challenge)}
                    >
                      {claimingId === challenge.id ? "领取中…" : challenge.pointPrice > 0 ? `用 ${challenge.pointPrice} 分领取` : "领取奖励"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function surpriseKindLabel(kind) {
  return ({
    limited_time: "限时",
    limited_stock: "限量",
    mystery: "神秘",
    discount: "随机折扣",
    event: "特别掉落",
  })[kind] || "惊喜";
}

function formatBeijing(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function scrollToProductShelf() {
  document.querySelector(".product-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
