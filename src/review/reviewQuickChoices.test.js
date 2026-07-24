import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MOOD_TAGS,
  parseMultiSelectText,
  toggleMultiSelectValue,
  getQuickChoiceOptions,
  withHistoryOptions,
  validateQuickChoiceOptions,
} from "./reviewQuickChoices.js";

test("parseMultiSelectText splits on both comma widths and trims/drops empties", () => {
  assert.deepEqual(parseMultiSelectText("平静, 期待，"), ["平静", "期待"]);
  assert.deepEqual(parseMultiSelectText(""), []);
});

test("toggleMultiSelectValue adds and removes, enforcing the max selection by dropping the oldest", () => {
  assert.equal(toggleMultiSelectValue("", "平静", 3), "平静");
  assert.equal(toggleMultiSelectValue("平静", "期待", 3), "平静, 期待");
  assert.equal(toggleMultiSelectValue("平静, 期待", "平静", 3), "期待");
  assert.equal(toggleMultiSelectValue("平静, 期待, 焦虑", "烦躁", 3), "期待, 焦虑, 烦躁");
});

test("getQuickChoiceOptions falls back to defaults when unconfigured or empty", () => {
  assert.deepEqual(getQuickChoiceOptions("moodTags", undefined), DEFAULT_MOOD_TAGS);
  assert.deepEqual(getQuickChoiceOptions("moodTags", { moodTags: [] }), DEFAULT_MOOD_TAGS);
  assert.deepEqual(getQuickChoiceOptions("moodTags", { moodTags: ["自定义1", "自定义1", "自定义2"] }), ["自定义1", "自定义2"]);
});

test("withHistoryOptions surfaces a selected value even after it's removed from the configured list", () => {
  const result = withHistoryOptions(["平静", "期待"], "平静, 已删除的标签");
  assert.deepEqual(result.options, ["平静", "期待"]);
  assert.deepEqual(result.historyOptions, ["已删除的标签"]);
});

test("validateQuickChoiceOptions trims, drops empties, and dedupes", () => {
  assert.deepEqual(validateQuickChoiceOptions([" 开心 ", "", "开心", "平静", null]), ["开心", "平静"]);
  assert.deepEqual(validateQuickChoiceOptions(undefined), []);
});
