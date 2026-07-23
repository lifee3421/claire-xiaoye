import { useEffect, useRef, useState } from "react";
import {
  CANONICAL_TAXONOMY_V3,
  LEGACY_CODE_DEFAULT_TAXONOMY_SNAPSHOT,
  buildThreeWayTaxonomyDiff,
  mergeLiveTaxonomyWithCanonical,
  validateTaxonomyIntegrity,
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
  const [verifyErrors, setVerifyErrors] = useState([]);
  const appliedExpectationsRef = useRef(null);
  const verifyTimeoutRef = useRef(null);

  useEffect(() => () => { if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current); }, []);

  // Once we're waiting for the write to propagate back through the app's live
  // subscription, re-validate the incoming liveTaxonomy prop against every
  // expectation captured from the preview that was actually applied — never just
  // "does it contain the ids we sent", so a partial/corrupted write can't pass as
  // verified. Only flips to "verified" when every single check passes; otherwise
  // keeps waiting until the timeout, then shows the specific failures.
  useEffect(() => {
    if (applyState !== "verifying" || !appliedExpectationsRef.current) return;
    const check = validateTaxonomyIntegrity(liveTaxonomy, appliedExpectationsRef.current);
    if (check.ok) {
      setApplyState("verified");
      setVerifyErrors([]);
      if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current);
    } else {
      // Keep the latest failure detail around so a timeout can show something
      // concrete instead of a generic message — but do NOT flip to verify_failed
      // early, since the subscription may simply not have caught up yet.
      setVerifyErrors(check.errors);
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
    setVerifyErrors([]);
    try {
      // Capture every expectation from THIS preview at the moment we apply it —
      // legacy ids that should disappear, custom nodes that must survive, and the
      // exact total node count — so verification checks the real outcome, not
      // just "does the tree contain the ids we happened to send".
      appliedExpectationsRef.current = {
        expectedLegacyIdsAbsent: [...new Set(previewResult.mergeDiff.normalizedIds.map((row) => row.from))],
        expectedCustomIdsPresent: previewResult.mergeDiff.unknownLiveNodes.map((row) => row.normalizedId),
        expectedTotalNodeCount: countNodes(previewResult.mergedTaxonomy),
      };
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
      {applyState === "verifying" && <p className="field-help">写入已提交，正在重新读取并验证（parentId 可解析、无重复 ID、legacy ID 已消失、自定义节点仍在、总数一致）…</p>}
      {applyState === "verified" && <p className="field-help">已写入并验证：parentId 全部可解析、无重复 categoryId、legacy ID 已全部消失、自定义节点全部保留、节点总数与预期一致。</p>}
      {applyState === "verify_failed" && (
        <div className="field-help">
          <p><strong>写入已提交，但重新读取后验证未通过</strong>（不代表数据一定有问题，也可能是页面订阅还没刷新——请手动刷新页面后再核对一次分类设置）：</p>
          <ul>{verifyErrors.length ? verifyErrors.map((message, index) => <li key={index}>{message}</li>) : <li>未能在预期时间内读取到任何更新。</li>}</ul>
        </div>
      )}
      {applyState === "error" && <p className="field-help">写入失败：{applyError}</p>}
    </div>
  );
}
