import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_QUICK_DURATION_FIELDS,
  getQuickDurationFieldIds,
  validateQuickDurationConfig,
} from "./reviewQuickFieldConfig.js";

const ENTERTAINMENT_FIELDS = [
  { id: "entertainment.today.wenyou.duration", label: "文游" },
  { id: "entertainment.today.game.duration", label: "游戏" },
  { id: "entertainment.today.video.duration", label: "视频" },
  { id: "entertainment.today.shortVideo.duration", label: "短视频" },
  { id: "entertainment.today.novel.duration", label: "小说" },
  { id: "entertainment.today.other.duration", label: "其他" },
];

test("getQuickDurationFieldIds returns the built-in default list when there is no saved config", () => {
  const ids = getQuickDurationFieldIds("entertainment", ENTERTAINMENT_FIELDS, undefined);
  assert.deepEqual(ids, DEFAULT_QUICK_DURATION_FIELDS.entertainment);
});

test("getQuickDurationFieldIds uses the user's saved config when present", () => {
  const ids = getQuickDurationFieldIds("entertainment", ENTERTAINMENT_FIELDS, {
    entertainment: [
      "entertainment.today.video.duration",
      "entertainment.today.novel.duration",
    ],
  });
  assert.deepEqual(ids, [
    "entertainment.today.video.duration",
    "entertainment.today.novel.duration",
  ]);
});

test("validateQuickDurationConfig drops unknown ids and dedupes while preserving order", () => {
  const cleaned = validateQuickDurationConfig(
    [
      "entertainment.today.video.duration",
      "entertainment.today.made.up",
      "entertainment.today.video.duration",
      "entertainment.today.game.duration",
    ],
    ENTERTAINMENT_FIELDS.map((f) => f.id)
  );
  assert.deepEqual(cleaned, [
    "entertainment.today.video.duration",
    "entertainment.today.game.duration",
  ]);
});

test("getQuickDurationFieldIds falls back to defaults when the saved config is entirely invalid", () => {
  const ids = getQuickDurationFieldIds("entertainment", ENTERTAINMENT_FIELDS, {
    entertainment: ["not.a.real.field"],
  });
  assert.deepEqual(ids, DEFAULT_QUICK_DURATION_FIELDS.entertainment);
});

test("getQuickDurationFieldIds falls back to all available fields for a section with no built-in default", () => {
  const fields = [
    { id: "work.redCross.duration.made.up", label: "示例" },
  ];
  const ids = getQuickDurationFieldIds("unknownSection", fields, undefined);
  assert.deepEqual(ids, fields.map((f) => f.id));
});

test("an explicit empty array (the user hid every quick field) is preserved exactly — never resurrected into the default list", () => {
  const ids = getQuickDurationFieldIds("entertainment", ENTERTAINMENT_FIELDS, { entertainment: [] });
  assert.deepEqual(ids, []);
});

test("a missing key (section never configured at all) still falls back to defaults, unlike an explicit empty array", () => {
  const ids = getQuickDurationFieldIds("entertainment", ENTERTAINMENT_FIELDS, {});
  assert.deepEqual(ids, DEFAULT_QUICK_DURATION_FIELDS.entertainment);
});

test("migrationFallbackIds (from the removed taxonomy pin) are folded into the computed default only when the section has never been configured", () => {
  const dynamicField = { id: "category:hobby.chess.custom-001", label: "象棋" };
  const withMigration = getQuickDurationFieldIds("hobby", [...ENTERTAINMENT_FIELDS, dynamicField].slice(0), undefined, ["category:hobby.chess.custom-001"]);
  assert.ok(withMigration.includes("category:hobby.chess.custom-001"));

  // An explicitly saved config (even one that doesn't mention the migrated id) must win — migration never overrides a real preference.
  const withSavedConfig = getQuickDurationFieldIds("hobby", [dynamicField], { hobby: [] }, ["category:hobby.chess.custom-001"]);
  assert.deepEqual(withSavedConfig, []);
});
