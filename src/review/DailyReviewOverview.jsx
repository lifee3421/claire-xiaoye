import ReviewField from "./ReviewField.jsx";

const STUDY_SLICES = [
  { id: "study.math.totalMinutes", label: "数学", color: "#0f766e" },
  { id: "study.professional.totalMinutes", label: "专业课", color: "#14b8a6" },
  { id: "study.english.totalMinutes", label: "英语", color: "#5eead4" },
  { id: "study.japanese.totalMinutes", label: "日语", color: "#94d8cd" },
  { id: "study.reading.totalMinutes", label: "阅读", color: "#c9ece4" },
];

const RADIUS = 54;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function num(draft, id) {
  const raw = draft.fields[id]?.value;
  return Number.isFinite(Number(raw)) ? Number(raw) : 0;
}

function StudyDonut({ draft }) {
  const slices = STUDY_SLICES.map((slice) => ({ ...slice, minutes: num(draft, slice.id) }));
  const total = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  let offset = 0;
  return (
    <div className="review-overview-chart">
      <svg viewBox="0 0 120 120" width="120" height="120">
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="#eef3f2" strokeWidth={STROKE} />
        {total > 0 && slices.filter((slice) => slice.minutes > 0).map((slice) => {
          const length = (slice.minutes / total) * CIRCUMFERENCE;
          const dasharray = `${length} ${CIRCUMFERENCE - length}`;
          const circle = (
            <circle
              key={slice.id}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={slice.color}
              strokeWidth={STROKE}
              strokeDasharray={dasharray}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
              strokeLinecap="butt"
            />
          );
          offset += length;
          return circle;
        })}
        <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="750" fill="#185c56">{total}</text>
        <text x="60" y="74" textAnchor="middle" fontSize="10" fill="#64748b">分钟学习</text>
      </svg>
      <ul className="review-overview-legend">
        {slices.map((slice) => (
          <li key={slice.id}>
            <span className="review-overview-dot" style={{ background: slice.color }} />
            {slice.label}<b>{slice.minutes}</b>
          </li>
        ))}
        {total === 0 && <li className="review-overview-legend-empty">今日暂无学习数据</li>}
      </ul>
    </div>
  );
}

export default function DailyReviewOverview({ draft, settlement, pointDelta, profile, onChange, onRestore, disabled = false }) {
  const balanceAfterSave = Number(profile?.points || 0) + Number(pointDelta || 0);
  const sleepText = draft.fields["sleep.yesterday.durationText"]?.value || "未填写";
  const snowDustField = { id: "snowDust.note", label: "记录内容", kind: "text" };
  const snowDustState = draft.fields["snowDust.note"];
  const hasSnowDustNote = Boolean(snowDustState?.value);

  return (
    <section className="review-overview-panel">
      <div className="review-overview-head">
        <h2>今日总览</h2>
        <span className="review-overview-updated">随填写实时更新</span>
      </div>
      <div className="review-overview-grid">
        <StudyDonut draft={draft} />
        <div className="review-overview-stats">
          <div className="review-stat-chip"><span>学习</span><b>{settlement.studyMinutes}min</b></div>
          <div className="review-stat-chip"><span>睡眠</span><b>{sleepText}</b></div>
          <div className="review-stat-chip"><span>运动</span><b>{settlement.exerciseMinutes}min</b></div>
          <div className="review-stat-chip"><span>娱乐</span><b>{settlement.totalEntertainmentMinutes}/90min</b></div>
          <div className="review-stat-chip review-stat-chip--accent"><span>预计积分</span><b>{pointDelta >= 0 ? "+" : ""}{pointDelta}</b></div>
          <div className="review-stat-chip review-stat-chip--accent"><span>保存后余额</span><b>{balanceAfterSave}</b></div>
        </div>
        <div className={`review-snowdust-card${hasSnowDustNote ? "" : " review-snowdust-card--empty"}`}>
          <div className="review-card-head"><h3>雪尘批注 / 雪尘手记</h3></div>
          {!hasSnowDustNote && <p className="review-snowdust-placeholder">雪尘暂未留下批注（Focus 数据尚未接入，同步后将在这里展示）。</p>}
          <ReviewField field={snowDustField} state={snowDustState} onChange={onChange} onRestore={onRestore} disabled={disabled} />
        </div>
      </div>
    </section>
  );
}
