import { projectTrackerDailyOverview } from "../utils/trackerDailyOverview.js";

export default function TrackerDailySummary({ trackers = [], facts = [], today, hasSavedHistory = false, migrationState, status = "loading", error = "", onOpenOverview }) {
  const factsById = new Map((Array.isArray(facts) ? facts : []).map((item) => [item.trackerId, item]));
  return <div className="tracker-daily-summary">
    {status === "loading" && <p className="field-help">正在读取已确认的习惯完成事实…</p>}
    {status === "error" && <p className="field-help" role="alert">无法读取习惯状态：{error}</p>}
    {status !== "loading" && (Array.isArray(trackers) ? trackers : []).map((tracker) => {
      const summary = projectTrackerDailyOverview({ tracker, facts: factsById.get(tracker.id) || {}, today, hasSavedHistory, migrationState });
      return <button className={`tracker-daily-row ${summary.kind}`} type="button" key={tracker.id} onClick={() => onOpenOverview?.(tracker.id)}>
        <span className="tracker-daily-emoji" aria-hidden="true">{tracker.emoji || "✨"}</span>
        <span className="tracker-daily-copy"><strong>{tracker.title || "未命名习惯"}</strong>{summary.lines.map((line) => <small key={line}>{line}</small>)}</span>
        <span className={`tracker-daily-status ${summary.kind}`}>{summary.status}</span>
      </button>;
    })}
  </div>;
}
