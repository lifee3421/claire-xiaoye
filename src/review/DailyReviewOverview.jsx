import { useMemo, useState } from "react";

const STUDY_ITEMS = [
  {
    id: "study.math.totalMinutes",
    label: "数学",
    color: "#8b7cf6",
  },
  {
    id: "study.professional.totalMinutes",
    label: "专业课",
    color: "#4fb6e9",
  },
  {
    id: "study.english.totalMinutes",
    label: "英语",
    color: "#55c49a",
  },
  {
    id: "study.japanese.totalMinutes",
    label: "日语",
    color: "#f3a561",
  },
  {
    id: "study.reading.totalMinutes",
    label: "阅读",
    color: "#e6c45c",
  },
];

const ACTIVITY_COLORS = {
  study: "#58c6a4",
  work: "#6f8ee8",
  hobby: "#a77be7",
  entertainment: "#f08b8b",
  exercise: "#f2ba4f",
  life: "#7db8d8",
};

function fieldValue(draft, id) {
  const field = draft?.fields?.[id];

  if (!field) return "";

  if (
    field.value !== undefined &&
    field.value !== null &&
    field.value !== ""
  ) {
    return field.value;
  }

  return field.autoValue ?? "";
}

function numberValue(draft, id) {
  const value = Number(fieldValue(draft, id));
  return Number.isFinite(value) ? value : 0;
}

function formatMinutes(rawMinutes) {
  const minutes = Math.max(0, Math.round(Number(rawMinutes) || 0));

  if (minutes < 60) {
    return `${minutes}min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function sumIds(draft, ids) {
  return ids.reduce((sum, id) => sum + numberValue(draft, id), 0);
}

function sumTotalFieldsByPrefix(draft, prefixes) {
  const fields = draft?.fields || {};

  return Object.entries(fields).reduce((sum, [id, state]) => {
    const matchesPrefix = prefixes.some((prefix) => id.startsWith(prefix));

    if (!matchesPrefix || !id.endsWith(".totalMinutes")) {
      return sum;
    }

    const value = Number(
      state?.value !== "" && state?.value !== undefined
        ? state.value
        : state?.autoValue
    );

    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function buildConicGradient(items) {
  const available = items.filter((item) => item.value > 0);
  const total = available.reduce((sum, item) => sum + item.value, 0);

  if (!total) {
    return "#edf4f2";
  }

  let cursor = 0;
  const segments = [];

  available.forEach((item) => {
    const start = (cursor / total) * 360;
    cursor += item.value;
    const end = (cursor / total) * 360;

    segments.push(`${item.color} ${start}deg ${end}deg`);
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function StudyBars({ items }) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="review-study-bars">
      {items.map((item) => {
        const height = item.value ? Math.max(10, (item.value / max) * 100) : 4;

        return (
          <div className="review-study-bar-item" key={item.id}>
            <strong>{item.value ? formatMinutes(item.value) : "0"}</strong>

            <div className="review-study-bar-track" aria-hidden="true">
              <span
                style={{
                  height: `${height}%`,
                  background: item.color,
                }}
              />
            </div>

            <small>{item.label}</small>
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({ label, value, accent = false }) {
  return (
    <article
      className={`review-overview-metric ${
        accent ? "review-overview-metric--accent" : ""
      }`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

const POINTS_BREAKDOWN_ROWS = [
  ["学习入账", "studyCredit"],
  ["运动入账", "exerciseCredit"],
  ["睡眠积分", "sleepAdjustmentPoints"],
  ["日型奖励", "dayTypeBonusPoints"],
];

function PointsCard({ settlement, pointDelta, balance }) {
  const rows = POINTS_BREAKDOWN_ROWS.map(([label, key]) => [
    label,
    Number(settlement?.[key] || 0),
  ]).filter(([, amount]) => amount !== 0);

  return (
    <article className="review-points-card">
      <div className="review-points-card__head">
        <span>积分变化</span>
        <strong className={pointDelta < 0 ? "is-negative" : ""}>
          {pointDelta >= 0 ? "+" : ""}
          {pointDelta} 分
        </strong>
      </div>

      {rows.length > 0 && (
        <ul className="review-points-card__rows">
          {rows.map(([label, amount]) => (
            <li key={label}>
              <span>{label}</span>
              <b>
                {amount >= 0 ? "+" : ""}
                {amount}
              </b>
            </li>
          ))}
        </ul>
      )}

      <footer>
        <span>结算后余额</span>
        <strong>{balance} 分</strong>
      </footer>
    </article>
  );
}

export default function DailyReviewOverview({
  draft,
  profile,
  settlement,
  pointDelta,
  onChange,
  disabled = false,
}) {
  const [editingSnowNote, setEditingSnowNote] = useState(false);

  const studyItems = useMemo(
    () =>
      STUDY_ITEMS.map((item) => ({
        ...item,
        value: numberValue(draft, item.id),
      })),
    [draft]
  );

  const studyTotal = useMemo(
    () => studyItems.reduce((sum, item) => sum + item.value, 0),
    [studyItems]
  );

  const projectWorkTotal = useMemo(
    () => sumTotalFieldsByPrefix(draft, ["project.", "work."]),
    [draft]
  );

  const hobbyTotal = numberValue(draft, "hobby.totalMinutes");
  const entertainmentTotal = numberValue(
    draft,
    "entertainment.today.totalMinutes"
  );
  const exerciseTotal = numberValue(draft, "exercise.today.totalMinutes");
  const familyMiscTotal =
    numberValue(draft, "family.contact.totalMinutes") +
    numberValue(draft, "misc.today.totalMinutes");

  const activityItems = useMemo(
    () => [
      {
        key: "study",
        label: "学习",
        value: studyTotal,
        color: ACTIVITY_COLORS.study,
      },
      {
        key: "work",
        label: "项目 / 工作",
        value: projectWorkTotal,
        color: ACTIVITY_COLORS.work,
      },
      {
        key: "hobby",
        label: "兴趣",
        value: hobbyTotal,
        color: ACTIVITY_COLORS.hobby,
      },
      {
        key: "entertainment",
        label: "娱乐",
        value: entertainmentTotal,
        color: ACTIVITY_COLORS.entertainment,
      },
      {
        key: "exercise",
        label: "运动",
        value: exerciseTotal,
        color: ACTIVITY_COLORS.exercise,
      },
      {
        key: "life",
        label: "家庭 / 杂项",
        value: familyMiscTotal,
        color: ACTIVITY_COLORS.life,
      },
    ],
    [
      studyTotal,
      projectWorkTotal,
      hobbyTotal,
      entertainmentTotal,
      exerciseTotal,
      familyMiscTotal,
    ]
  );

  const activityTotal = activityItems.reduce(
    (sum, item) => sum + item.value,
    0
  );

  const activityGradient = buildConicGradient(activityItems);
  const sleepText =
    String(fieldValue(draft, "sleep.yesterday.durationText") || "").trim() ||
    "未填写";

  const snowState = draft?.fields?.["snowDust.note"] || {};
  const snowNote = String(
    snowState.value || snowState.autoValue || ""
  ).trim();

  const snowUpdatedAt = snowState.updatedAt || snowState.editedAt || "";
  const balance = Number(profile?.points || 0) + Number(pointDelta || 0);

  return (
    <section className="daily-review-overview">
      <header className="daily-review-overview__header">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h2>今日总览</h2>
        </div>

        <span>基于当前草稿实时更新</span>
      </header>

      <div className="daily-review-overview__grid">
        <article className="review-chart-card review-chart-card--activity">
          <div className="review-chart-card__title">
            <div>
              <strong>今日时间分布</strong>
              <small>不含睡眠</small>
            </div>
          </div>

          <div className="review-donut-layout">
            <div
              className="review-donut"
              style={{ background: activityGradient }}
              role="img"
              aria-label={`今日已记录 ${formatMinutes(activityTotal)}`}
            >
              <div className="review-donut__center">
                <strong>{formatMinutes(activityTotal)}</strong>
                <span>已记录</span>
              </div>
            </div>

            <div className="review-chart-legend">
              {activityItems.map((item) => (
                <div key={item.key}>
                  <i style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <strong>{formatMinutes(item.value)}</strong>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="review-chart-card review-chart-card--study">
          <div className="review-chart-card__title">
            <div>
              <strong>学习内部构成</strong>
              <small>修改时长后立即变化</small>
            </div>
          </div>

          <StudyBars items={studyItems} />
        </article>

        <section className="review-overview-metrics">
          <MetricCard label="学习总时长" value={formatMinutes(studyTotal)} />
          <MetricCard label="睡眠时长" value={sleepText} />
          <MetricCard label="运动时长" value={formatMinutes(exerciseTotal)} />
          <MetricCard
            label="娱乐时长"
            value={`${formatMinutes(entertainmentTotal)} / 90min`}
          />
        </section>

        <article className="review-snow-note">
          <div className="review-snow-note__header">
            <div>
              <strong>雪尘批注 / 雪尘手记</strong>

              <small>
                {snowUpdatedAt
                  ? `最近更新 ${new Date(snowUpdatedAt).toLocaleString("zh-CN")}`
                  : "等待雪尘留下观察"}
              </small>
            </div>

            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditingSnowNote((current) => !current)}
            >
              {editingSnowNote ? "完成" : "编辑"}
            </button>
          </div>

          {editingSnowNote ? (
            <textarea
              rows={4}
              value={snowState.value ?? ""}
              disabled={disabled}
              placeholder="这里只用于人工修订雪尘批注；未来由 Cyberboss 自动填入。"
              onChange={(event) =>
                onChange("snowDust.note", event.target.value)
              }
            />
          ) : snowNote ? (
            <p>{snowNote}</p>
          ) : (
            <div className="review-snow-note__empty">
              <strong>雪尘还没有留下批注。</strong>
              <span>
                Focus 数据接入后，他会结合当天的学习、状态和生活记录在这里观察。
              </span>
            </div>
          )}

          <footer>
            <span>
              {snowState.source === "manual"
                ? "人工修订"
                : snowState.source && snowState.source !== "default"
                  ? "自动来源"
                  : "尚无来源"}
            </span>
          </footer>
        </article>

        <PointsCard settlement={settlement} pointDelta={pointDelta} balance={balance} />
      </div>
    </section>
  );
}
