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

export default function PointsSettlementPreview({ settlement, open }) {
  if (!open) return null;
  return (
    <div className="points-settlement-detail">
      <p className="field-help">这是这一天的积分构成，不代表会再次入账；本次真正变动以下方“预计 ±X 分”为准。</p>
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
  );
}
