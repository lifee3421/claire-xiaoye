import { projectTrackerDailyOverview } from "../utils/trackerDailyOverview.js";

export default function TrackerDailySummary({ trackers = [], facts = [], today, hasSavedHistory = false, migrationState, status = "loading", error = "", onRetry, onOpenOverview }) {
  const factsById = new Map((Array.isArray(facts) ? facts : []).map((item) => [item.trackerId, item]));
  return <div className="tracker-daily-summary">
    {status === "loading" && <p className="field-help">正在读取已确认的习惯完成事实…</p>}
    {status === "error" && <p className="field-help" role="alert">习惯状态读取失败：{error}{typeof onRetry === "function" && <button className="text-button" type="button" onClick={onRetry}>重试</button>}</p>}
    {(Array.isArray(trackers) ? trackers : []).map((tracker) => {
      const summary = projectTrackerDailyOverview({ tracker, facts: factsById.get(tracker.id) || {}, today, hasSavedHistory, migrationState });
      return <button className={`tracker-daily-row ${summary.kind}`} type="button" key={tracker.id} onClick={() => onOpenOverview?.(tracker.id)}>
        <span className="tracker-daily-emoji" aria-hidden="true">{tracker.emoji || "✨"}</span>
        <span className="tracker-daily-copy"><strong>{tracker.title || "未命名习惯"}</strong>{summary.lines.map((line) => <small key={line}>{line}</small>)}{summary.noCurrentPeriodRecords && <small>本月暂无记录</small>}</span>
        <span className={`tracker-daily-status ${summary.kind}`}>{summary.status}</span>
      </button>;
    })}
  </div>;
}
