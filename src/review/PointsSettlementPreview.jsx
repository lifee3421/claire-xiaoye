import {
  auditActorLabel,
  formatAuditDateTime,
  normalizeSettlementAudit,
} from "./reviewSettlementAudit.js";
import "./reviewSettlementAudit.css";

// "min" rows (studyCredit/exerciseCredit) are minutes-equivalent CREDIT —
// an intermediate currency that later gets converted into real points via
// bankPointsAdded (calculateBankPointsAdded(generatedMinutes)). "分" rows are
// components of THIS DAY'S final settlement total. They are deliberately not
// prefixed with "+": on an already-saved review these rows describe the saved
// day's composition, not another credit that will be added again. The actual
// balance change for the current save/revision is the pointDelta shown by the
// settlement bar below.
const ROWS = [
  ["学习价值分钟", "studyCredit", "min"],
  ["运动价值分钟", "exerciseCredit", "min"],
  ["时间价值转分", "bankPointsAdded", "分"],
  ["睡眠积分", "sleepAdjustmentPoints", "分"],
  ["运动额外积分", "exerciseBonusPoints", "分"],
  ["工作积分", "workPoints", "分"],
  ["日型额外奖励", "dayTypeBonusPoints", "分"],
  ["自由娱乐积分", "entertainmentScoreDelta", "分"],
  ["复盘归档奖励", "reviewTimelinessBonus", "分"],
];

function signedPoints(value) {
  const amount = Number(value || 0);
  if (amount === 0) return "0 分";
  return `${amount > 0 ? "+" : ""}${amount} 分`;
}

function revisionSourceText(revision) {
  if (revision.sourceSummary) return revision.sourceSummary;
  if (Number(revision.delta || 0) === 0) return "积分构成未变化";
  return "旧记录只保存了总积分变化，当时没有保存细分来源";
}

function SettlementAuditTimeline({ settlement }) {
  const audit = normalizeSettlementAudit(settlement?.settlementAudit, settlement);
  const hasAudit = Boolean(audit.firstSubmittedAt || audit.revisions.length);
  if (!hasAudit) return null;

  return (
    <section className="review-settlement-audit" aria-label="复盘结算历史">
      <div className="review-settlement-audit-head">
        <div>
          <strong>结算历史</strong>
          <span>第一次正式提交，以及后来为什么动过积分</span>
        </div>
      </div>
      <ol className="review-settlement-timeline">
        <li>
          <div className="review-settlement-timeline-title">
            <b>首次提交</b>
            <time>{formatAuditDateTime(audit.firstSubmittedAt)}</time>
          </div>
          <p>{auditActorLabel(audit.firstSubmittedActor)} · 初次结算 {signedPoints(audit.initialPointsAdded)}</p>
        </li>
        {audit.revisions.map((revision, index) => (
          <li key={`${revision.at || "revision"}-${index}`}>
            <div className="review-settlement-timeline-title">
              <b>第 {index + 1} 次修订</b>
              <time>{formatAuditDateTime(revision.at)}</time>
            </div>
            <p>
              {auditActorLabel(revision.actor)} · {Number(revision.delta || 0) === 0 ? "积分不变" : `积分调整 ${signedPoints(revision.delta)}`}
            </p>
            <small>{revisionSourceText(revision)}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function PointsSettlementPreview({ settlement, open }) {
  return (
    <>
      <SettlementAuditTimeline settlement={settlement} />
      {open && (
        <div className="points-settlement-detail">
          <p className="field-help">这是这一天的积分构成，不代表会再次入账；本次真正变动以下方“本次积分”提示为准。</p>
          <ul className="points-detail">
            {ROWS.map(([label, key, unit]) => {
              const amount = Number(settlement[key] || 0);
              return (
                <li key={label}>
                  {label}
                  <b>
                    {amount}
                    {unit}
                  </b>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
