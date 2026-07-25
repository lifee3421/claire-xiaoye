// Pure guard functions for taxonomy editing (App.jsx's TaxonomyManager):
// duplicate-name prevention on create/rename, and delete-vs-archive
// eligibility. Kept separate from App.jsx (which has no test harness of its
// own) so this logic gets real unit tests instead of only regex-based
// source assertions.

// Same normalization strictness as Focus title matching (trim + NFKC +
// whitespace-collapse + lowercase) — two names that only differ by casing,
// full/half-width, or incidental whitespace are the "same" name for
// duplicate-prevention purposes.
export function normalizeTaxonomyNameForDuplicateCheck(value) {
  return String(value || "").trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

// `siblings` is the list of nodes sharing the SAME parent as the
// candidate (never cross-parent — "线性代数" under 数学 and a
// hypothetical "线性代数" under a totally different group are not a
// conflict). `excludeId` lets a rename check against its OTHER siblings
// without flagging itself.
export function findDuplicateSiblingName(siblings, name, excludeId) {
  const key = normalizeTaxonomyNameForDuplicateCheck(name);
  if (!key) return null;
  return (Array.isArray(siblings) ? siblings : []).find((node) => node.id !== excludeId && normalizeTaxonomyNameForDuplicateCheck(node.name) === key) || null;
}

export function hasChildren(node) {
  return Array.isArray(node?.children) && node.children.length > 0;
}

/**
 * Decides what the "删除" button may actually do for this node:
 * - "blocked_canonical": a system/canonical category — archive only, never delete.
 * - "blocked_children": has child categories — must delete/move them first.
 * - "blocked_referenced": referencedTokens shows real usage — archive only.
 * - "delete": safe to permanently remove.
 * Never returns "archive" as an ALLOWED delete outcome silently — the
 * caller is expected to show the reason and let archive be a distinct,
 * explicit action, not something delete quietly downgrades into.
 */
export function evaluateDeleteEligibility({ node, isCanonicalId, referencedTokens } = {}) {
  if (!node) return { mode: "blocked", reason: "分类不存在" };
  if (isCanonicalId) return { mode: "blocked_canonical", reason: "系统预置分类不能被彻底删除，只能归档。" };
  if (hasChildren(node)) return { mode: "blocked_children", reason: "这个分类下还有子分类，请先删除或移动子分类。" };
  const tokens = referencedTokens instanceof Set ? referencedTokens : new Set(referencedTokens || []);
  if (tokens.has(node.id) || tokens.has(node.name)) {
    return { mode: "blocked_referenced", reason: "这个分类在当前未结算的复盘草稿或排程中被引用，无法彻底删除，只能归档。" };
  }
  return { mode: "delete", reason: "" };
}
