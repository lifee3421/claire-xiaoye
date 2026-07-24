import test from "node:test";
import assert from "node:assert/strict";
import { parseTagsText, addTag, removeTagAt } from "./diaryTags.js";

test("parseTagsText splits on commas (both widths) and trims/drops empties", () => {
  assert.deepEqual(parseTagsText("学习记录, 自我成长，, 复盘 "), ["学习记录", "自我成长", "复盘"]);
  assert.deepEqual(parseTagsText(""), []);
  assert.deepEqual(parseTagsText(undefined), []);
});

test("addTag appends a new tag and dedupes, returning the joined string", () => {
  assert.equal(addTag("", "学习记录"), "学习记录");
  assert.equal(addTag("学习记录", "自我成长"), "学习记录, 自我成长");
  assert.equal(addTag("学习记录", "学习记录"), "学习记录");
  assert.equal(addTag("学习记录", "  "), "学习记录");
});

test("removeTagAt drops the tag at the given index and re-joins", () => {
  assert.equal(removeTagAt("学习记录, 自我成长, 复盘", 1), "学习记录, 复盘");
  assert.equal(removeTagAt("学习记录", 0), "");
});
