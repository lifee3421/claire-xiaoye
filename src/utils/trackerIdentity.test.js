import test from "node:test";
import assert from "node:assert/strict";
import { buildCompletionEventId, normalizeRevision } from "./trackerIdentity.js";

test("normalizeRevision: numeric comparison, not lexicographic — revision 2 < revision 10", () => {
  assert.ok(normalizeRevision(2) < normalizeRevision(10));
  assert.ok(!("2" < "10")); // the exact string-comparison bug this guards against: lexicographically "2" > "10"
});

test("normalizeRevision: legacy string revisions are normalized to numbers", () => {
  assert.equal(normalizeRevision("2"), 2);
  assert.equal(typeof normalizeRevision("2"), "number");
});

test("normalizeRevision: absent revision falls back (does not throw), invalid revision throws", () => {
  assert.equal(normalizeRevision(undefined), 0);
  assert.equal(normalizeRevision(null), 0);
  assert.equal(normalizeRevision(undefined, 5), 5);
  assert.throws(() => normalizeRevision("abc"), /invalid settlementRevision/);
  assert.throws(() => normalizeRevision(NaN), /invalid settlementRevision/);
  assert.throws(() => normalizeRevision(-1), /invalid settlementRevision/);
  assert.throws(() => normalizeRevision(1.5), /invalid settlementRevision/);
});

test("buildCompletionEventId: deterministic, collision-resistant across distinct identity tuples, never contains raw separators", () => {
  const a = buildCompletionEventId("t1", "s1", "a/b.c", "categoryEntry");
  const b = buildCompletionEventId("t1", "s1", "a/b.c", "categoryEntry");
  assert.equal(a, b);
  assert.doesNotMatch(a, /[/.]/);
  const distinctTrackers = new Set([
    buildCompletionEventId("t1", "s1", "f", "categoryEntry"),
    buildCompletionEventId("t2", "s1", "f", "categoryEntry"),
    buildCompletionEventId("t1", "s2", "f", "categoryEntry"),
    buildCompletionEventId("t1", "s1", "g", "categoryEntry"),
    buildCompletionEventId("t1", "s1", "f", "manualReviewField"),
  ]);
  assert.equal(distinctTrackers.size, 5);
});
