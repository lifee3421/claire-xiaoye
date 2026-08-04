import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  migrateLegacyReviewUiIntoTaxonomy,
  normalizeClassificationTaxonomy,
  resolveClassificationTaxonomy,
} from "../taxonomy/taxonomyContract.js";
import { DEFAULT_LIFE_CATEGORIES } from "../utils/unifiedPlannerCards.js";
import { buildSettingsSavePayload } from "./settingsSaveGuards.js";

// REGRESSION #3 — "分类/复盘配置回去了，而且总在版本更新之后"
//
// Symptom: categories the user deleted come back, and per-leaf review settings
// revert — typically right after a deploy or a version switch.
//
// Mechanism: SettingsPage seeded its form from
// `resolveClassificationTaxonomy(profile)`, which is a READ-TIME resolve that
// injects code-side defaults (`ensureLifeCategories`, and a whole-tree fallback
// to `CANONICAL_TAXONOMY_V3` when the stored tree is empty). A plain
// "保存设置" then persisted that resolved tree, so the defaults *of whichever
// bundle was running* got frozen into the user's data. That is why the symptom
// tracks version changes rather than any particular user action.
//
// Fix: compare the outgoing tree against the mount-time baseline and omit
// `classificationTaxonomy` entirely when the user never edited it.

const APP_SOURCE = readFileSync(fileURLToPath(new URL("../App.jsx", import.meta.url)), "utf8");

// Mirrors SettingsPage.buildTaxonomyForSave.
function buildTaxonomyForSave(rawTaxonomy, profile) {
  return migrateLegacyReviewUiIntoTaxonomy({
    taxonomy: normalizeClassificationTaxonomy(rawTaxonomy),
    archivedWorkGroups: profile.dailyReviewUi?.archivedWorkGroups,
    studyLeafDefaults: profile.dailyReviewUi?.studyLeafDefaults,
  });
}

function collectIds(nodes, acc = new Set()) {
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    if (node?.id) acc.add(node.id);
    collectIds(node?.children, acc);
  });
  return acc;
}

function removeNodeById(nodes, targetId) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter((node) => node?.id !== targetId)
    .map((node) => ({ ...node, children: removeNodeById(node?.children, targetId) }));
}

// Build a profile that represents "用户删掉了一个默认分类". Derived from the
// live default tree rather than hardcoded ids, so this stays meaningful across
// the taxonomy version churn that caused the bug in the first place.
const DELETED_ID = DEFAULT_LIFE_CATEGORIES[3].id;
const STORED_TAXONOMY = removeNodeById(resolveClassificationTaxonomy({}), DELETED_ID);
const PROFILE = { classificationTaxonomy: STORED_TAXONOMY, dailyReviewUi: {} };

test("前提：用户删掉的默认分类会被 read-time resolve 重新注入", () => {
  assert.ok(!collectIds(STORED_TAXONOMY).has(DELETED_ID), "存储值里确实没有这个分类");
  const resolved = resolveClassificationTaxonomy(PROFILE);
  assert.ok(collectIds(resolved).has(DELETED_ID), "resolve 结果把它复活了 —— 这就是被误存回去的内容");
});

test("用户删掉/自定义 taxonomy：普通 Settings 保存不会复活默认分类", () => {
  // Exactly what SettingsPage does: seed from the resolve, user touches nothing.
  const seed = resolveClassificationTaxonomy(PROFILE);
  const pristineTaxonomy = buildTaxonomyForSave(seed, PROFILE);
  const outgoing = buildTaxonomyForSave(seed, PROFILE);

  const payload = buildSettingsSavePayload({
    form: { displayName: "Claire", classificationTaxonomy: seed, plannerCategoryColors: {} },
    taxonomy: outgoing,
    pristineTaxonomy,
    taxonomyColors: { [DELETED_ID]: "#C58A00" },
  });

  assert.ok(
    !("classificationTaxonomy" in payload),
    "未编辑分类树时必须完全不写 classificationTaxonomy，否则会把注入的默认分类固化进库",
  );
  assert.ok(
    !Object.keys(payload.plannerCategoryColors || {}).includes(DELETED_ID),
    "由默认分类派生的颜色同样不能被隐式写入",
  );
});

test("对照：没有 baseline 时（旧行为）确实会把复活的分类写进 payload", () => {
  const seed = resolveClassificationTaxonomy(PROFILE);
  const payload = buildSettingsSavePayload({
    form: { classificationTaxonomy: seed },
    taxonomy: buildTaxonomyForSave(seed, PROFILE),
    pristineTaxonomy: null, // null = 无基线，等价于修复前无条件写入
  });
  assert.ok(collectIds(payload.classificationTaxonomy).has(DELETED_ID), "这条对照固定住了 bug 的形状");
});

test("用户确实编辑了分类树时，仍然正常保存", () => {
  const seed = resolveClassificationTaxonomy(PROFILE);
  const pristineTaxonomy = buildTaxonomyForSave(seed, PROFILE);
  const edited = [...seed, { id: "primary-custom", name: "我的新分类", color: "#334155", children: [] }];

  const payload = buildSettingsSavePayload({
    form: { classificationTaxonomy: edited, plannerCategoryColors: {} },
    taxonomy: buildTaxonomyForSave(edited, PROFILE),
    pristineTaxonomy,
    taxonomyColors: {},
  });

  assert.ok("classificationTaxonomy" in payload, "真实编辑必须照常写入，守卫不能吞掉用户改动");
  assert.ok(collectIds(payload.classificationTaxonomy).has("primary-custom"));
});

test("比较是键序无关的深比较，不会因为对象重建而误判为已修改", () => {
  const seed = resolveClassificationTaxonomy(PROFILE);
  const a = buildTaxonomyForSave(seed, PROFILE);
  const b = buildTaxonomyForSave(JSON.parse(JSON.stringify(seed)), PROFILE);
  const payload = buildSettingsSavePayload({ form: {}, taxonomy: b, pristineTaxonomy: a });
  assert.ok(!("classificationTaxonomy" in payload), "同样内容的两次 resolve 必须判定为未修改");
});

test("App.jsx 的 submitSettings 走 buildSettingsSavePayload 且带上 pristine 基线", () => {
  assert.match(APP_SOURCE, /onSave\(buildSettingsSavePayload\(\{/);
  assert.match(APP_SOURCE, /pristineTaxonomy: pristineTaxonomyRef\.current,/);
  assert.ok(
    !/onSave\(\{ \.\.\.form, classificationTaxonomy: taxonomy,/.test(APP_SOURCE),
    "旧的无条件写入写法不得再出现",
  );
});
