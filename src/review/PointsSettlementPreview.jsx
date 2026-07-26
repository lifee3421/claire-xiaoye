// "min" rows (studyCredit/exerciseCredit) are minutes-equivalent CREDIT —
// an intermediate currency that later gets converted into real points via
// bankPointsAdded (calculateBankPointsAdded(generatedMinutes)) — they were
// previously labeled "学习入账"/"运动入账" with no unit at all, reading as
// if they were already points, which is exactly the unit confusion that
// made "+0" on this row look like a points bug rather than what it
// actually was (a 0-minute studyMinutes input). "分" rows are genuine,
// already-final point deltas that sum directly into settlement.pointsAdded.
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
      <ul className="points-detail">
        {ROWS.map(([label, key, unit]) => {
          const amount = settlement[key];
          return (
            <li key={label}>
              {label}
              <b>
                {amount >= 0 ? "+" : ""}
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
