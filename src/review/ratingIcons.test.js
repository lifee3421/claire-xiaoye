import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "ratingIcons.jsx");
const source = readFileSync(sourcePath, "utf8");
// Strip `//` line comments before scanning for emoji — the file's own
// explanatory comment about *why* emoji were removed necessarily mentions
// the emoji character itself, which must not count as a violation.
const codeOnly = source.replace(/\/\/.*$/gm, "");

// A colored emoji (e.g. ⚡) carries its own baked-in color that CSS `color`
// cannot override — that's the literal root cause of the energy selector
// looking permanently yellow. Any emoji character sneaking back into the
// actual icon code would silently reintroduce that bug, so scan broadly for
// emoji presentation ranges rather than just the one character we already
// know about.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️]/u;

test("ratingIcons.jsx's actual icon code (excluding the explanatory comment) contains no emoji characters — BoltIcon/StarIcon must be pure SVG, not emoji", () => {
  assert.equal(EMOJI_PATTERN.test(codeOnly), false, `found an emoji-range character in ratingIcons.jsx code: ${codeOnly.match(EMOJI_PATTERN)}`);
});

test("BoltIcon and StarIcon both render an SVG path with fill=\"currentColor\", so their color is fully controlled by CSS `color`", () => {
  assert.match(source, /function BoltIcon\(\)/);
  assert.match(source, /function StarIcon\(\)/);
  const boltBody = source.slice(source.indexOf("function BoltIcon"), source.indexOf("function StarIcon"));
  const starBody = source.slice(source.indexOf("function StarIcon"));
  assert.match(boltBody, /fill="currentColor"/);
  assert.match(starBody, /fill="currentColor"/);
  assert.match(boltBody, /<svg viewBox="0 0 24 24"/);
  assert.match(starBody, /<svg viewBox="0 0 24 24"/);
});
