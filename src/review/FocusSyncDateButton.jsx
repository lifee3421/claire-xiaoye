import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { requestFocusReviewSync, describeFocusReviewSyncStatus, loadConnectionSettings } from "../agent/catkeeperSnapshotSender.js";

const LABELS = {
  idle: "同步当前日期",
  syncing: "同步中…",
  synced: "已同步",
  unchanged: "数据无变化",
  offline: "Cyberboss未连接",
  failed: "同步失败",
};

function uiPhaseFor(status) {
  if (status === "synced") return "synced";
  if (status === "unchanged") return "unchanged";
  const label = describeFocusReviewSyncStatus(status);
  return label === "Cyberboss未连接" ? "offline" : "failed";
}

/**
 * Triggers a real Cyberboss->Daily Review sync for exactly the date the
 * user is currently viewing (today, yesterday, or any historical date) —
 * works from the SAME connection settings the Settings page's Cyberboss
 * panel uses, never a second config. Never reloads the page: a successful
 * sync's actual field/summary changes arrive through the existing
 * dailyReviewDrafts Firestore subscription, exactly like a Focus autoValue
 * write from any other source.
 */
export default function FocusSyncDateButton({ date, requestImpl = requestFocusReviewSync }) {
  const [phase, setPhase] = useState("idle");

  const onClick = async () => {
    if (phase === "syncing") return; // prevents double-submission from a fast repeat click
    setPhase("syncing");
    const settings = loadConnectionSettings();
    const result = await requestImpl(date, settings, {});
    setPhase(uiPhaseFor(result.status));
  };

  return (
    <button
      type="button"
      className="review-focus-sync-date-button"
      disabled={phase === "syncing"}
      onClick={onClick}
      title={`同步 ${date} 的 Focus 数据`}
    >
      <RefreshCw size={14} className={phase === "syncing" ? "is-spinning" : ""} />
      {LABELS[phase]}
    </button>
  );
}
