import { useEffect, useMemo, useRef, useState } from "react";
import {
  CANONICAL_TAXONOMY_V3,
  LEGACY_CODE_DEFAULT_TAXONOMY_SNAPSHOT,
  buildThreeWayTaxonomyDiff,
  mergeLiveTaxonomyWithCanonical,
} from "./taxonomyContract";

function countNodes(taxonomy) {
  let count = 0;
  const visit = (node) => {
    count += 1;
    (Array.isArray(node?.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach(visit);
  return count;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Runtime migration preview + apply tool for the unified taxonomy v3 contract.
 * Reads profile.classificationTaxonomy as already provided by the app's existing
 * authenticated Firestore subscription (via the `liveTaxonomy` prop) — this
 * component never opens its own Firestore/auth connection.
 */
export default function TaxonomyMigrationPanel({ liveTaxonomy = [], ready = false, onApply }) {
  const [previewResult, setPreviewResult] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyState, setApplyState] = useState("idle"); // idle | applying | verifying | verified | verify_failed | error
  const [applyError, setApplyError] = useState("");
  const appliedTaxonomyRef = useRef(null);
  const verifyTimeoutRef = useRef(null);

  useEffect(() => () => { if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current); }, []);

  // Once we're waiting for the write to propagate back through the app's live
  // subscription, watch the incoming liveTaxonomy prop for the expected result.
  useEffect(() => {
    if (applyState !== "verifying" || !appliedTaxonomyRef.current) return;
    const expectedIds = new Set(countNodesIds(appliedTaxonomyRef.current));
    const actualIds = new Set(countNodesIds(liveTaxonomy));
    const matches = expectedIds.size > 0 && expectedIds.size === actualIds.size && [...expectedIds].every((id) => actualIds.has(id));
    if (matches) {
      setApplyState("verified");
      if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTaxonomy, applyState]);

  function runPreview() {
    const diff = buildThreeWayTaxonomyDiff({
      liveTaxonomy,
      defaultTaxonomy: LEGACY_CODE_DEFAULT_TAXONOMY_SNAPSHOT,
      canonicalTaxonomy: CANONICAL_TAXONOMY_V3,
    });
    const { taxonomy: mergedTaxonomy, diff: mergeDiff } = mergeLiveTaxonomyWithCanonical({
      liveTaxonomy,
      canonicalTaxonomy: CANONICAL_TAXONOMY_V3,
    });
    setPreviewResult({ diff, mergedTaxonomy, mergeDiff, computedAt: new Date().toISOString() });
    setApplyState("idle");
    setApplyError("");
  }

  function exportSnapshotAndDiff() {
    if (!previewResult) return;
    downloadJson(`taxonomy-snapshot-and-diff-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      note: "classificationTaxonomy snapshot + migration diff only — no other profile fields included.",
      classificationTaxonomy: liveTaxonomy,
      diff: previewResult.diff,
      mergeDiff: previewResult.mergeDiff,
    });
  }

  async function confirmApply() {
    if (!previewResult || !onApply) return;
    setConfirmOpen(false);
    setApplyState("applying");
    setApplyError("");
    try {
      appliedTaxonomyRef.current = previewResult.mergedTaxonomy;
      await onApply(previewResult.mergedTaxonomy);
      setApplyState("verifying");
      verifyTimeoutRef.current = setTimeout(() => {
        setApplyState((current) => (current === "verifying" ? "verify_failed" : current));
      }, 15000);
    } catch (error) {
      setApplyState("error");
      setApplyError(error?.message || "写入失败，未确认迁移是否生效，请重新预览后再试。");
    }
  }

  const summary = previewResult ? {
    addedNodes: previewResult.mergeDiff.addedNodes.length,
    normalizedIds: previewResult.mergeDiff.normalizedIds.length,
    unknownLiveNodes: previewResult.mergeDiff.unknownLiveNodes.length,
    liveNodeCount: previewResult.diff.liveNodeCount,
    mergedNodeCount: countNodes(previewResult.mergedTaxonomy),
  } : null;

  return (
    <div className="settings-block taxonomy-migration-panel">
      <strong>统一分类迁移（unified taxonomy v3）</strong>
      <p className="field-help">
        预览会读取你当前账号真实保存的分类树，和 v3 目标分类逐项比较，不会写入任何数据。
        确认无误后再点“应用”，只会更新分类树本身，不会碰复盘、结算等其他数据。
      </p>
      <div className="button-row">
        <button className="secondary-button compact" type="button" disabled={!ready} onClick={runPreview}>
          预览统一分类迁移
        </button>
        <button className="secondary-button compact" type="button" disabled={!previewResult} onClick={exportSnapshotAndDiff}>
          导出快照与 diff JSON
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={!previewResult || applyState === "applying" || applyState === "verifying"}
          onClick={() => setConfirmOpen(true)}
        >
          应用统一分类迁移
        </button>
      </div>
      {!ready && <p className="field-help">尚未登录或资料未加载完成，预览功能暂不可用。</p>}

      {summary && (
        <div className="taxonomy-migration-summary">
          <p className="field-help">
            线上现有节点 {summary.liveNodeCount} 个；将新增 {summary.addedNodes} 个 v3 节点；
            {summary.normalizedIds} 个节点的 ID 会从旧写法迁移为 canonical 写法；
            {summary.unknownLiveNodes} 个无法识别的线上自定义节点会原样保留，不会被删除；
            合并后共 {summary.mergedNodeCount} 个节点。
          </p>
          <details className="advanced-info">
            <summary>查看完整 diff</summary>
            <div className="taxonomy-diff-block">
              <p><strong>ID 从旧写法迁移为 canonical 写法：</strong></p>
              <ul>{previewResult.mergeDiff.normalizedIds.map((row, index) => <li key={index}>{row.from} → {row.to}（第 {row.level} 级）</li>)}</ul>
              <p><strong>将新增的 v3 节点：</strong></p>
              <ul>{previewResult.mergeDiff.addedNodes.map((row, index) => <li key={index}>{row.name}（{row.id}，第 {row.level} 级）</li>)}</ul>
              <p><strong>线上独有、无法识别的自定义节点（会保留）：</strong></p>
              <ul>{previewResult.mergeDiff.unknownLiveNodes.length ? previewResult.mergeDiff.unknownLiveNodes.map((row, index) => <li key={index}>{row.name}（{row.id}，第 {row.level} 级）</li>) : <li>无</li>}</ul>
              <p><strong>已匹配节点中，v3 建议值与你当前自定义值不同的字段（不会自动覆盖）：</strong></p>
              <ul>{previewResult.diff.fieldLevelDifferences.length ? previewResult.diff.fieldLevelDifferences.map((row, index) => <li key={index}>{row.id}：{Object.keys(row.changed).join("、")}</li>) : <li>无</li>}</ul>
            </div>
          </details>
        </div>
      )}

      {confirmOpen && summary && (
        <div className="taxonomy-migration-confirm">
          <p>
            即将把 {summary.normalizedIds} 个节点的 ID 迁移为 canonical 写法，新增 {summary.addedNodes} 个 v3 节点。
            <strong>不会删除任何无法识别的自定义分类</strong>（{summary.unknownLiveNodes} 个会原样保留），
            也不会修改分类树以外的任何 profile 字段。确认应用吗？
          </p>
          <div className="button-row">
            <button className="secondary-button compact" type="button" onClick={confirmApply}>确认应用</button>
            <button className="secondary-button compact" type="button" onClick={() => setConfirmOpen(false)}>取消</button>
          </div>
        </div>
      )}

      {applyState === "applying" && <p className="field-help">正在写入…</p>}
      {applyState === "verifying" && <p className="field-help">写入已提交，正在重新读取并验证…</p>}
      {applyState === "verified" && <p className="field-help">已写入并验证：重新读取到的分类树已包含全部预期节点。</p>}
      {applyState === "verify_failed" && <p className="field-help">写入已提交，但重新读取后未能在预期时间内确认结果一致，请刷新页面手动核对分类设置。</p>}
      {applyState === "error" && <p className="field-help">写入失败：{applyError}</p>}
    </div>
  );
}

function countNodesIds(taxonomy) {
  const ids = [];
  const visit = (node) => {
    if (node?.id) ids.push(node.id);
    (Array.isArray(node?.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach(visit);
  return ids;
}
