import { useEffect, useMemo, useState } from "react";
import { projectTrackerMonthlyOverview, shiftMonth } from "../utils/trackerMonthlyOverview.js";

function beijingIsoDate() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function currentMonth() { return beijingIsoDate().slice(0, 7); }
function todayIso() { return beijingIsoDate(); }
function monthLabel(monthKey) { const [year, month] = monthKey.split("-"); return `${year} 年 ${Number(month)} 月`; }
function calendarCells(bounds) { const startWeekday = (new Date(`${bounds.start}T00:00:00Z`).getUTCDay() + 6) % 7; return [...Array(startWeekday).fill(null), ...Array.from({ length: bounds.days }, (_, index) => index + 1)]; }

function metricText(overview) {
  if (overview.aggregation === "sum") return `本月累计 ${overview.monthlyValue} ${overview.facts?.progress?.unit || ""}`;
  if (overview.aggregation === "active_days") return `本月完成 ${overview.monthlyCount} 天`;
  return `本月完成 ${overview.monthlyCount} 次`;
}

export default function TrackerMonthlyOverview({ tracker, initialMonth, hasSavedHistory = false, migrationState, refreshKey, onLoadEvents, onBack }) {
  const [monthKey, setMonthKey] = useState(initialMonth || currentMonth());
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading"); setError("");
    Promise.resolve(onLoadEvents?.(tracker.id) || [])
      .then((rows) => { if (!cancelled) { setEvents(rows); setStatus("ready"); } })
      .catch((loadError) => { if (!cancelled) { setError(loadError instanceof Error ? loadError.message : String(loadError)); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [tracker.id, onLoadEvents, refreshKey]);
  const overview = useMemo(() => projectTrackerMonthlyOverview({ tracker, events, monthKey, today: todayIso(), hasSavedHistory, migrationState }), [tracker, events, monthKey, hasSavedHistory, migrationState]);
  const selectedEvidence = selectedDate ? overview.evidenceByDate?.get(selectedDate) || [] : [];
  const cells = overview.bounds ? calendarCells(overview.bounds) : [];
  return <div className="tracker-monthly-overview"><div className="manager-fixed-head"><div><h3>{tracker.emoji || "✨"} {tracker.title} · 月度习惯总览</h3><p>仅消费 active CompletionEvents；日期使用 occurredOn。</p></div><button className="secondary-button compact" type="button" onClick={() => onBack(monthKey)}>返回追踪项</button></div><div className="tracker-month-nav"><button className="secondary-button compact" type="button" onClick={() => setMonthKey((month) => shiftMonth(month, -1))}>上个月</button><strong>{monthLabel(monthKey)}</strong><button className="secondary-button compact" type="button" onClick={() => setMonthKey((month) => shiftMonth(month, 1))}>下个月</button></div>
    {status === "loading" && <p className="field-help">正在读取已确认的完成事件…</p>}{status === "error" && <p className="field-help" role="alert">无法读取完成事件：{error}</p>}
    {status === "ready" && overview.state === "requires_setup" && <p className="field-help" role="status">待设置：完成周期、目标与证据绑定后才会显示统计，不会伪造逾期或完成次数。</p>}
    {status === "ready" && overview.state === "empty" && <p className="field-help" role="status">本月暂无记录。</p>}
    {status === "ready" && overview.state === "history_not_migrated" && <p className="field-help" role="status">历史尚未迁移：已保存结算尚未生成可用 CompletionEvent；本月暂无记录。</p>}
    {status === "ready" && overview.state !== "requires_setup" && <>{overview.state === "ready" && <div className="tracker-overview-metrics"><span>{metricText(overview)}</span><span>最近一次：{overview.lastCompletedDate || "暂无"}</span><span>下次到期：{overview.nextDueDate || "暂无"}</span>{overview.progress && <span>当前周期：{overview.progress.current} / {overview.progress.target} {overview.progress.unit || ""}</span>}</div>}<p className="field-help">完成日期：{overview.completionDates.length ? overview.completionDates.join("、") : "本月暂无记录"}</p>{overview.state !== "ready" && <div className="tracker-overview-metrics"><span>最近一次：{overview.lastCompletedDate || "暂无"}</span><span>下次到期：{overview.nextDueDate || "暂无"}</span>{overview.progress && <span>当前周期：{overview.progress.current} / {overview.progress.target} {overview.progress.unit || ""}</span>}</div>}<div className="tracker-month-calendar" role="grid" aria-label={`${monthLabel(monthKey)}完成日历`}>{["一", "二", "三", "四", "五", "六", "日"].map((label) => <strong key={label}>{label}</strong>)}{cells.map((day, index) => { if (!day) return <span className="calendar-blank" key={`blank-${index}`} />; const date = `${monthKey}-${String(day).padStart(2, "0")}`; const completed = overview.evidenceByDate.has(date); return <button type="button" className={completed ? "calendar-day completed" : "calendar-day"} aria-pressed={selectedDate === date} key={date} onClick={() => setSelectedDate((current) => current === date ? "" : date)}>{day}</button>; })}</div>{selectedDate && <section className="tracker-day-evidence"><h4>{selectedDate} 的已确认依据</h4>{selectedEvidence.length ? selectedEvidence.map((event) => <p key={event.id}><strong>{event.sourceType || "来源"}</strong>{event.evidenceSummary ? ` · ${event.evidenceSummary}` : ""}{event.value ? ` · ${event.value} ${event.unit}` : ""}</p>) : <p>当天没有 active CompletionEvent。</p>}</section>}</>}
  </div>;
}
