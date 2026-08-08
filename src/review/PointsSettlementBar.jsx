export function pointDeltaLabel(pointDelta) {
  const delta = Number(pointDelta || 0);
  if (delta === 0) return "本次积分不变";
  return `本次预计 ${delta > 0 ? "+" : ""}${delta} 分`;
}

export default function PointsSettlementBar({ pointDelta, profile, saving, onSubmit, revision, detailOpen, onToggleDetail }) {
  const delta = Number(pointDelta || 0);
  return <section className="points-settlement-bar">
    <strong>{pointDeltaLabel(delta)}</strong>
    <span>{revision ? "修订后" : "保存后"}余额 {Number(profile?.points || 0) + delta} 分</span>
    <button className="points-detail-toggle" type="button" onClick={onToggleDetail}>{detailOpen ? "收起明细" : "积分明细"}</button>
    <button className="primary-button" disabled={saving} type="button" onClick={onSubmit}>{saving ? "保存中…" : revision ? "修订复盘并校准" : "保存复盘并结算"}</button>
  </section>;
}
