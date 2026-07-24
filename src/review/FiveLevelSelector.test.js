import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LEVEL_TO_SCORE, scoreToLevel } from "./scoreLevel.js";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "FiveLevelSelector.jsx");
const source = readFileSync(sourcePath, "utf8");

test("FiveLevelSelector's selectedLevel is derived purely from the value prop via scoreToLevel — no independent persisted local state that could revert after an autosave echo", () => {
  assert.match(source, /const selectedLevel = scoreToLevel\(value\)/);
  assert.doesNotMatch(source, /useState/, "must not keep its own local copy of the selection");
});

test("FiveLevelSelector clicking the currently active level clears the field (toggles to \"\"), otherwise sets LEVEL_TO_SCORE[level]", () => {
  assert.match(source, /selectedLevel === level\s*\n?\s*\?\s*""\s*\n?\s*:\s*LEVEL_TO_SCORE\[level\]/);
});

test("FiveLevelSelector uses a stable key={level} for its five option buttons, not index/value/saving-based keys", () => {
  assert.match(source, /key=\{level\}/);
});

test("energy score 6 (three-star equivalent) activates exactly levels 1-3, leaving 4-5 inactive — the button className rule is level <= selectedLevel", () => {
  assert.match(source, /level <= selectedLevel \? "is-active" : ""/);
  const level = scoreToLevel(6);
  assert.equal(level, 3);
  const activeCount = [1, 2, 3, 4, 5].filter((lvl) => lvl <= level).length;
  assert.equal(activeCount, 3);
});

test("an empty/zero value produces selectedLevel 0, so no button is <= selectedLevel and none render as active", () => {
  const level = scoreToLevel("");
  assert.equal(level, 0);
  const activeCount = [1, 2, 3, 4, 5].filter((lvl) => lvl <= level).length;
  assert.equal(activeCount, 0);
});

test("FiveLevelSelector defaults to the SVG StarIcon (not a colored emoji glyph)", () => {
  assert.match(source, /import \{ StarIcon \} from "\.\/ratingIcons\.jsx"/);
  assert.match(source, /icon = <StarIcon \/>/);
});
