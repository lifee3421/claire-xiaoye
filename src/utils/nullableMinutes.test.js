import assert from "node:assert/strict";
import test from "node:test";
import { hasExplicitFiniteMinute } from "./nullableMinutes.js";

test("null / undefined / empty string are NOT explicit minutes", () => {
  assert.equal(hasExplicitFiniteMinute(null), false);
  assert.equal(hasExplicitFiniteMinute(undefined), false);
  assert.equal(hasExplicitFiniteMinute(""), false);
});

test("NaN / non-numeric strings are NOT explicit minutes", () => {
  assert.equal(hasExplicitFiniteMinute(NaN), false);
  assert.equal(hasExplicitFiniteMinute("abc"), false);
});

test("0 and real numbers (incl. numeric strings) ARE explicit minutes", () => {
  assert.equal(hasExplicitFiniteMinute(0), true); // genuine 00:00
  assert.equal(hasExplicitFiniteMinute(800), true);
  assert.equal(hasExplicitFiniteMinute("800"), true);
});
