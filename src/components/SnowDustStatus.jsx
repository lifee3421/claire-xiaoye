import { useState, useRef, useEffect, useMemo } from "react";
import { loadConnectionSettings } from "../agent/catkeeperSnapshotSender.js";
import { isSnowDustConnectionReady, resolveSnowDustStatus } from "./snowDustStatusResolve.js";
import { Check, Clock, RefreshCw, XCircle, WifiOff, Send, ChevronDown } from "lucide-react";

const STATUS_CONFIG = {
  needs_first_send: { label: "今日计划未发送", icon: Send, className: "snowdust-status--needs-send" },
  not_connected: { label: "未连接", icon: WifiOff, className: "snowdust-status--not-connected" },
  sync_failed: { label: "同步失败", icon: XCircle, className: "snowdust-status--failed" },
  pending_retry: { label: "待同步", icon: Clock, className: "snowdust-status--pending" },
  syncing: { label: "同步中", icon: RefreshCw, className: "snowdust-status--syncing" },
  synced: { label: "已同步", icon: Check, className: "snowdust-status--synced" },
};

function formatTime(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Compact inline Snow-dust sync status with a dropdown detail panel.
 *
 * Props (all optional — the component derives as much as possible):
 *   connectionSettings     — resolved connection settings (or read live)
 *   todayDate              — "YYYY-MM-DD" for the current planner date
 *   reminderPlanSyncByDate — draft.reminderPlanSyncByDate
 *   snapshotSyncPending    — boolean
 *   reminderPlanSyncPending— boolean
 *   snapshotSyncIssue      — string
 *   reminderPlanSyncIssue  — string
 *   isSending              — boolean (manual send is active)
 *   onResend               — () => void for manual resend from detail panel
 *   onFirstSend            — () => void for first-time send CTA
 */
export default function SnowDustStatus({
  connectionSettings: connSettingsOverride,
  todayDate,
  reminderPlanSyncByDate = {},
  snapshotSyncPending = false,
  reminderPlanSyncPending = false,
  snapshotSyncIssue = "",
  reminderPlanSyncIssue = "",
  isSending = false,
  onResend,
  onFirstSend,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const connSettings = connSettingsOverride || loadConnectionSettings();
  const todayEntry = todayDate ? (reminderPlanSyncByDate[todayDate] || {}) : {};
  const connectionReady = isSnowDustConnectionReady(connSettings);

  const status = useMemo(() => resolveSnowDustStatus({
    connectionReady,
    todayAcceptedRevision: Number(todayEntry.acceptedRevision) || 0,
    snapshotSyncPending,
    reminderPlanSyncPending,
    snapshotSyncIssue,
    reminderPlanSyncIssue,
    isSending,
  }), [connectionReady, todayEntry.acceptedRevision, snapshotSyncPending, reminderPlanSyncPending, snapshotSyncIssue, reminderPlanSyncIssue, isSending]);

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.synced;
  const StatusIcon = config.icon;

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const snapshotStatusLine = useMemo(() => {
    if (snapshotSyncPending) return { label: "排程快照", status: "待同步", ok: false };
    if (snapshotSyncIssue) return { label: "排程快照", status: "失败", ok: false };
    if (connSettings?.lastSyncStatus === "accepted" || connSettings?.lastSyncStatus === "duplicate" || connSettings?.lastSyncStatus === "ignored_stale") {
      return { label: "排程快照", status: "已同步", ok: true };
    }
    if (connSettings?.lastSyncStatus) return { label: "排程快照", status: connSettings.lastSyncStatus, ok: false };
    return { label: "排程快照", status: "未同步", ok: false };
  }, [snapshotSyncPending, snapshotSyncIssue, connSettings?.lastSyncStatus]);

  const reminderPlanStatusLine = useMemo(() => {
    if (reminderPlanSyncPending) return { label: "提醒计划", status: "待同步", ok: false };
    if (reminderPlanSyncIssue) return { label: "提醒计划", status: "失败", ok: false };
    const rev = Number(todayEntry.acceptedRevision) || 0;
    if (rev >= 1) return { label: "提醒计划", status: "已同步", ok: true };
    return { label: "提醒计划", status: "未发送", ok: false };
  }, [reminderPlanSyncPending, reminderPlanSyncIssue, todayEntry.acceptedRevision]);

  const revisionLine = useMemo(() => {
    const acceptedRev = Number(todayEntry.acceptedRevision) || 0;
    return acceptedRev > 0 ? `rev ${acceptedRev}` : "";
  }, [todayEntry.acceptedRevision]);

  const connectionLine = useMemo(() => {
    if (!connectionReady) return { label: "Cyberboss", status: "未配置", ok: false };
    if (connSettings?.lastTestStatus === "connected" || ["accepted", "duplicate", "ignored_stale"].includes(connSettings?.lastSyncStatus)) {
      return { label: "Cyberboss", status: "已连接", ok: true };
    }
    return { label: "Cyberboss", status: connSettings?.lastTestStatus || "已配置", ok: true };
  }, [connectionReady, connSettings?.lastTestStatus, connSettings?.lastSyncStatus]);

  const isNeedsFirstSend = status === "needs_first_send";
  const isSynced = status === "synced";
  // This timestamp comes from sendSnapshot(), i.e. an actual Snow-dust sync
  // attempt. Do not substitute the planner's local save time here.
  const actualLastSyncedAt = connSettings?.lastSyncedAt;

  return (
    <div className="snowdust-status" ref={ref}>
      {isNeedsFirstSend && onFirstSend ? (
        <button type="button" className="snowdust-status__cta" onClick={onFirstSend}>
          <Send size={13} />
          发送今日计划给雪尘
        </button>
      ) : (
        <button
          type="button"
          className={`snowdust-status__trigger ${config.className}`}
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="true"
        >
          <span className="snowdust-status__label">雪尘</span>
          {isSynced ? <Check size={12} /> : <StatusIcon size={12} />}
          <span>{config.label}</span>
          <ChevronDown size={10} className={`snowdust-status__chevron ${open ? "snowdust-status__chevron--open" : ""}`} />
        </button>
      )}

      {open && (
        <div className="snowdust-status__dropdown" role="menu">
          <div className="snowdust-status__dropdown-head">
            <strong>雪尘同步</strong>
          </div>
          <div className="snowdust-status__dropdown-body">
            <div className="snowdust-status__detail-row">
              <span>今日计划</span>
              <span className={reminderPlanStatusLine.ok ? "snowdust-status__ok" : "snowdust-status__warn"}>
                {reminderPlanStatusLine.ok ? "✓" : "!"} {reminderPlanStatusLine.status}
              </span>
            </div>
            {revisionLine && (
              <div className="snowdust-status__detail-row">
                <span>最新版本</span>
                <span>{revisionLine}</span>
              </div>
            )}
            <div className="snowdust-status__detail-row">
              <span>{snapshotStatusLine.label}</span>
              <span className={snapshotStatusLine.ok ? "snowdust-status__ok" : "snowdust-status__warn"}>
                {snapshotStatusLine.ok ? "✓" : "!"} {snapshotStatusLine.status}
              </span>
            </div>
            <div className="snowdust-status__detail-row">
              <span>{reminderPlanStatusLine.label}</span>
              <span className={reminderPlanStatusLine.ok ? "snowdust-status__ok" : "snowdust-status__warn"}>
                {reminderPlanStatusLine.ok ? "✓" : "!"} {reminderPlanStatusLine.status}
              </span>
            </div>
            <div className="snowdust-status__detail-row">
              <span>最后同步</span>
              <span>{formatTime(actualLastSyncedAt) || "--"}</span>
            </div>
            <div className="snowdust-status__detail-row">
              <span>{connectionLine.label}</span>
              <span className={connectionLine.ok ? "snowdust-status__ok" : "snowdust-status__warn"}>
                {connectionLine.ok ? "✓" : "!"} {connectionLine.status}
              </span>
            </div>
          </div>
          {onResend && (
            <div className="snowdust-status__dropdown-foot">
              <button type="button" className="secondary-button compact" onClick={() => { setOpen(false); onResend(); }}>
                <RefreshCw size={13} />
                重新发送
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
