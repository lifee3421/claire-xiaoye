const MAX_TAXONOMY_BYTES = 512 * 1024;
const MAX_TAXONOMY_NODES = 500;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countNodes(items = []) {
  let count = 0;
  const stack = [...items];
  while (stack.length) {
    const item = stack.pop();
    if (!isPlainObject(item)) continue;
    count += 1;
    if (Array.isArray(item.children)) stack.push(...item.children);
  }
  return count;
}

export function validateClassificationTaxonomy(value) {
  if (!Array.isArray(value)) return { ok: false, error: "classificationTaxonomy must be an array" };
  if (countNodes(value) > MAX_TAXONOMY_NODES) return { ok: false, error: `classificationTaxonomy exceeds ${MAX_TAXONOMY_NODES} nodes` };
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw, "utf8") > MAX_TAXONOMY_BYTES) return { ok: false, error: "classificationTaxonomy is too large" };
  const stack = [...value];
  while (stack.length) {
    const item = stack.pop();
    if (!isPlainObject(item)) return { ok: false, error: "taxonomy nodes must be objects" };
    if (typeof item.id !== "string" || !item.id.trim()) return { ok: false, error: "every taxonomy node needs a non-empty id" };
    if (typeof item.name !== "string" || !item.name.trim()) return { ok: false, error: `taxonomy node ${item.id} needs a non-empty name` };
    if (item.children !== undefined && !Array.isArray(item.children)) return { ok: false, error: `taxonomy node ${item.id}.children must be an array` };
    if (Array.isArray(item.children)) stack.push(...item.children);
  }
  return { ok: true, taxonomy: JSON.parse(raw), nodeCount: countNodes(value) };
}

export { MAX_TAXONOMY_BYTES, MAX_TAXONOMY_NODES };
