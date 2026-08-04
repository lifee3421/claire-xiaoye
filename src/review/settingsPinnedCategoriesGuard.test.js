import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildSettingsSavePayload,
  mergePinnedCategoryIdsIntoForm,
  resolvePinnedCategoryIds,
} from "./settingsSaveGuards.js";

// REGRESSION #2 — "复盘里的条目少了 / 置顶分类回去了"
//
// Symptom: entries the user had pinned stop showing up in the daily review
// form. `dailyReviewUi.pinnedCategoryIds` is what decides visibility
// (reviewTaxonomyModel.isDynamicLeafVisible), and it had been silently reset
// to an empty list.
//
// Mechanism (three lines that only misbehave together):
//   1. SettingsPage's form state never seeded `dailyReviewUi`.
//   2. It nevertheless read `form.dailyReviewUi?.pinnedCategoryIds || []`,
//      which therefore always evaluated to `[]`.
//   3. Archiving any category ran `pinnedCategoryIds.filter(...)` on that `[]`
//      and saved the (still empty) result — wiping the real list.
// dataService then wrote it wholesale, because `"dailyReviewUi" in settings`
// tests key presence only.

const APP_SOURCE = readFileSync(fileURLToPath(new URL("../App.jsx", import.meta.url)), "utf8");
const DATA_SERVICE_SOURCE = readFileSync(fileURLToPath(new URL("../services/dataService.js", import.meta.url)), "utf8");

const PROFILE = {
  dailyReviewUi: {
    pinnedCategoryIds: ["study.math", "life.sport", "work.review"],
    archivedWorkGroups: ["legacy-group"],
    studyLeafDefaults: { "study.math": { minutes: 60 } },
  },
};

// The form as SettingsPage seeds it: no `dailyReviewUi` key at all.
const PRISTINE_FORM = { displayName: "Claire", plannerCategoryColors: {} };

test("打开 Settings：置顶列表读到的是 profile 里的真实值，不是空数组", () => {
  const pinned = resolvePinnedCategoryIds(PRISTINE_FORM, PROFILE);
  assert.deepEqual(pinned, ["study.math", "life.sport", "work.review"]);
  assert.notDeepEqual(pinned, [], "读不到 profile 就会退化成 [] —— 正是本次回归的起点");
});

test("已有 pinnedCategoryIds：只打开并保存 Settings，不会写入 dailyReviewUi", () => {
  const payload = buildSettingsSavePayload({
    form: PRISTINE_FORM,
    taxonomy: [],
    pristineTaxonomy: [],
    taxonomyColors: {},
  });
  assert.ok(!("dailyReviewUi" in payload), "未触碰置顶列表时必须整个删键；置 null 会被 dataService 写成 {} 从而清空");
});

test("归档一个分类：只移除该分类，其余置顶项原样保留", () => {
  // Reproduces TaxonomyManager.deleteOrArchive's filter, but fed by the fixed read.
  const current = resolvePinnedCategoryIds(PRISTINE_FORM, PROFILE);
  const next = current.filter((id) => id !== "life.sport");
  const form = mergePinnedCategoryIdsIntoForm(PRISTINE_FORM, PROFILE, next);

  assert.deepEqual(form.dailyReviewUi.pinnedCategoryIds, ["study.math", "work.review"]);
  // Siblings must survive — dataService replaces the whole dailyReviewUi map.
  assert.deepEqual(form.dailyReviewUi.archivedWorkGroups, ["legacy-group"]);
  assert.deepEqual(form.dailyReviewUi.studyLeafDefaults, { "study.math": { minutes: 60 } });

  const payload = buildSettingsSavePayload({ form, taxonomy: [], pristineTaxonomy: [], taxonomyColors: {} });
  assert.deepEqual(payload.dailyReviewUi.pinnedCategoryIds, ["study.math", "work.review"], "用户确实编辑过时，必须正常保存");
});

test("dailyReviewUi 为 null / 非对象时一律删键", () => {
  for (const value of [null, undefined, "", 0]) {
    const payload = buildSettingsSavePayload({
      form: { ...PRISTINE_FORM, dailyReviewUi: value },
      taxonomy: [],
      pristineTaxonomy: [],
    });
    assert.ok(!("dailyReviewUi" in payload), `dailyReviewUi=${JSON.stringify(value)} 时必须删键`);
  }
});

test("App.jsx 不再用 form.dailyReviewUi?.pinnedCategoryIds || [] 读置顶列表", () => {
  assert.ok(
    !/form\.dailyReviewUi\?\.pinnedCategoryIds \|\| \[\]/.test(APP_SOURCE),
    "这个表达式恒为 []（form 从不 seed dailyReviewUi），是清空置顶列表的直接原因",
  );
  assert.match(APP_SOURCE, /pinnedCategoryIds=\{resolvePinnedCategoryIds\(form, profile\)\}/);
  assert.match(APP_SOURCE, /mergePinnedCategoryIdsIntoForm\(current, profile, pinnedCategoryIds\)/);
});

test("dataService 按值判定 dailyReviewUi，而不是按键存在", () => {
  assert.ok(
    !/if \("dailyReviewUi" in settings\)/.test(DATA_SERVICE_SOURCE),
    "按键存在判定会把 null 写成 {}，等于清空用户的复盘显示配置",
  );
  assert.match(
    DATA_SERVICE_SOURCE,
    /if \(settings\.dailyReviewUi && typeof settings\.dailyReviewUi === "object"\) payload\.dailyReviewUi = settings\.dailyReviewUi;/,
  );
});
