import { useMemo, useState } from "react";
import { sumDynamicDurationByPrimary, buildStudyGroupTotals, sumAllStudyMinutes } from "./reviewTaxonomyModel.js";
import { resolveEffectiveReviewValue } from "./effectiveReviewValue.js";
import { resolveSchemaGroupTotalMinutes } from "./reviewSectionConfig.js";
import { buildSnowDustCommentaryPayload } from "./buildSnowDustCommentaryPayload.js";
import { isLegacyManualSnowDustNote, snowDustNoteText, isSnowDustCommentaryStale } from "./snowDustCommentary.js";
import { requestSnowDustCommentary, describeSnowDustCommentaryStatus, loadConnectionSettings } from "../agent/catkeeperSnapshotSender.js";

// groupId matches classificationTaxonomy's study.* node ids — buildStudyGroupTotals
// is keyed by these, the SAME computation source StudyLeafGroupBlock's own
// header total uses, so this bar chart, the "学习总时长" metric, and each
// group's displayed total never diverge (see reviewTaxonomyModel.js).
const STUDY_ITEMS = [
  {
    groupId: "study.math",
    label: "数学",
    color: "#8b7cf6",
  },
  {
    groupId: "study.professional",
    label: "专业课",
    color: "#4fb6e9",
  },
  {
    groupId: "study.english",
    label: "英语",
    color: "#55c49a",
  },
  {
    groupId: "study.japanese",
    label: "日语",
    color: "#f3a561",
  },
  {
    groupId: "study.reading",
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
  // "家庭 / 杂项" (family + misc combined bucket) — distinct from the real
  // taxonomy "life" (生活) anchor below; the key name predates 生活 having
  // its own dynamic leaves and is kept only for internal continuity.
  familyMisc: "#7db8d8",
  life: "#c58a00",
};

function fieldValue(draft, id) {
  const field = draft?.fields?.[id];

  if (!field) return "";

  return resolveEffectiveReviewValue(field);
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

    const value = Number(resolveEffectiveReviewValue(state));

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
          <div className="review-study-bar-item" key={item.groupId}>
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

// "min" rows are minutes-equivalent CREDIT (an intermediate currency that
// later converts into real points via bankPointsAdded), never final points
// themselves — labeling them with no unit at all reads as if a 0-minute
// studyMinutes input were a points bug, not a minutes one.
const POINTS_BREAKDOWN_ROWS = [
  ["学习价值分钟", "studyCredit", "min"],
  ["运动价值分钟", "exerciseCredit", "min"],
  ["睡眠积分", "sleepAdjustmentPoints", "分"],
  ["日型奖励", "dayTypeBonusPoints", "分"],
];

function PointsCard({ settlement, pointDelta, balance }) {
  const rows = POINTS_BREAKDOWN_ROWS.map(([label, key, unit]) => [
    label,
    Number(settlement?.[key] || 0),
    unit,
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
          {rows.map(([label, amount, unit]) => (
            <li key={label}>
              <span>{label}</span>
              <b>
                {amount >= 0 ? "+" : ""}
                {amount}
                {unit}
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

function formatSnowDustTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "发给雪尘" — sends the current date's review facts to the real Cyberboss/
 * 雪尘 runtime and saves the returned commentary. Deliberately NOT a plain
 * onChange field: applySnowDustCommentaryToDraft (via onApplyCommentary)
 * stamps source:"snowdust"/manuallyEdited:false, never the manual-edit
 * shape a normal text input would produce.
 */
function SnowDustCard({ date, draft, taxonomy, settlement, onApplyCommentary, disabled }) {
  const [phase, setPhase] = useState("idle"); // idle | sending | error
  const [errorMessage, setErrorMessage] = useState("");

  const state = draft?.fields?.["snowDust.note"] || {};
  const noteText = snowDustNoteText(state);
  const isLegacy = isLegacyManualSnowDustNote(state);
  const { inputRevision: currentRevision } = useMemo(
    () => buildSnowDustCommentaryPayload({ date, draft, taxonomy, settlement }),
    [date, draft, taxonomy, settlement]
  );
  const stale = noteText && !isLegacy && isSnowDustCommentaryStale(state, currentRevision);

  const send = async () => {
    if (phase === "sending" || disabled) return; // prevents double-submit / concurrent requests
    if (noteText) {
      const proceed = window.confirm("这会替换当前的雪尘批注，继续吗？");
      if (!proceed) return;
    }
    setPhase("sending");
    setErrorMessage("");
    const { review, inputRevision } = buildSnowDustCommentaryPayload({ date, draft, taxonomy, settlement });
    const result = await requestSnowDustCommentary(date, inputRevision, review, loadConnectionSettings());
    if (result.status === "generated") {
      onApplyCommentary({ commentary: result.commentary, generatedAt: result.generatedAt || new Date().toISOString(), inputRevision: result.inputRevision || inputRevision });
      setPhase("idle");
      return;
    }
    // A failed request must never delete or overwrite the existing
    // commentary — only the error state changes.
    setErrorMessage(describeSnowDustCommentaryStatus(result.status));
    setPhase("error");
  };

  return (
    <article className="review-snow-note">
      <div className="review-snow-note__header">
        <div>
          <strong>雪尘批注 / 雪尘手记</strong>
          <small>
            {noteText
              ? isLegacy
                ? "历史内容"
                : `雪尘批注于 ${formatSnowDustTime(state.generatedAt)}`
              : "等待雪尘留下观察"}
          </small>
        </div>

        <button type="button" disabled={disabled || phase === "sending"} onClick={send}>
          {phase === "sending" ? "雪尘正在看…" : "发给雪尘"}
        </button>
      </div>

      {noteText ? (
        <p>{noteText}</p>
      ) : (
        <div className="review-snow-note__empty">
          <strong>把今天的复盘发给雪尘，他会在这里留下批注。</strong>
        </div>
      )}

      {stale && <p className="review-snow-note__stale">复盘数据有更新，可以再次发给雪尘。</p>}
      {phase === "error" && errorMessage && <p className="review-snow-note__error" role="alert">{errorMessage}</p>}

      <footer>
        <span>{noteText ? (isLegacy ? "历史内容" : "来自雪尘") : "尚无来源"}</span>
      </footer>
    </article>
  );
}

export default function DailyReviewOverview({
  date,
  draft,
  profile,
  taxonomy = [],
  settlement,
  pointDelta,
  onApplySnowDustCommentary,
  disabled = false,
}) {
  // Dynamic (taxonomy-only, no static schema field) leaves' duration —
  // see reviewTaxonomyModel.js. Grouped by the same anchor ids the category
  // cards use, so a leaf added purely through TaxonomyManager (e.g.
  // misc.water-plants) shows up in this overview too, not just its own card.
  const dynamicTotalsByAnchor = useMemo(
    () => sumDynamicDurationByPrimary(taxonomy, draft),
    [taxonomy, draft]
  );

  const studyGroupTotals = useMemo(
    () => buildStudyGroupTotals({ taxonomy, draft }),
    [taxonomy, draft]
  );

  const studyItems = useMemo(
    () =>
      STUDY_ITEMS.map((item) => ({
        ...item,
        value: studyGroupTotals[item.groupId] || 0,
      })),
    [studyGroupTotals]
  );

  // Same source as studyItems/StudyLeafGroupBlock — never independently
  // re-summed, so this never drifts from the bar chart or the per-group
  // totals shown in the study leaf list below.
  const studyTotal = useMemo(
    () => sumAllStudyMinutes({ taxonomy, draft }),
    [taxonomy, draft]
  );

  const projectWorkTotal = useMemo(
    () => sumTotalFieldsByPrefix(draft, ["project.", "work."]) + (dynamicTotalsByAnchor.project || 0) + (dynamicTotalsByAnchor.work || 0),
    [draft, dynamicTotalsByAnchor]
  );

  const hobbyTotal = resolveSchemaGroupTotalMinutes(draft, "hobby.totalMinutes") + (dynamicTotalsByAnchor.hobby || 0);
  // Reads through the shared parts-aware total (reviewSectionConfig.js),
  // the SAME function the entertainment card's own header badge uses — a
  // Focus autoValue written only into a child (entertainment.today.
  // game.duration) never also updates the parent .totalMinutes field, so
  // reading the parent field alone silently undercounted this bucket.
  const entertainmentTotal = resolveSchemaGroupTotalMinutes(
    draft,
    "entertainment.today.totalMinutes"
  ) + (dynamicTotalsByAnchor.entertainment || 0);
  const exerciseTotal = numberValue(draft, "exercise.today.totalMinutes");
  const familyMiscTotal =
    resolveSchemaGroupTotalMinutes(draft, "family.contact.totalMinutes") +
    resolveSchemaGroupTotalMinutes(draft, "misc.today.totalMinutes") +
    (dynamicTotalsByAnchor.family || 0) +
    (dynamicTotalsByAnchor.misc || 0);
  // "生活" (life) is entirely dynamic (no static/bound field of its own,
  // e.g. 做饭) — kept as its own bucket, never folded into family/misc.
  const lifeTotal = dynamicTotalsByAnchor.life || 0;

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
        key: "familyMisc",
        label: "家庭 / 杂项",
        value: familyMiscTotal,
        color: ACTIVITY_COLORS.familyMisc,
      },
      {
        key: "life",
        label: "生活",
        value: lifeTotal,
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
      lifeTotal,
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

        <SnowDustCard
          date={date}
          draft={draft}
          taxonomy={taxonomy}
          settlement={settlement}
          onApplyCommentary={onApplySnowDustCommentary}
          disabled={disabled}
        />

        <PointsCard settlement={settlement} pointDelta={pointDelta} balance={balance} />
      </div>
    </section>
  );
}
