import test from "node:test";
import assert from "node:assert/strict";
import { assertNoCompletionEventIdCollision, buildCompletionEventId, normalizeRevision } from "./trackerIdentity.js";

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

test("buildCompletionEventId: SHA-256 (64 hex chars), deterministic, collision-resistant across distinct identity tuples, never contains raw separators", async () => {
  const a = await buildCompletionEventId("t1", "s1", "a/b.c", "categoryEntry");
  const b = await buildCompletionEventId("t1", "s1", "a/b.c", "categoryEntry");
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(a, /[/.]/);
  const distinctTrackers = new Set(await Promise.all([
    buildCompletionEventId("t1", "s1", "f", "categoryEntry"),
    buildCompletionEventId("t2", "s1", "f", "categoryEntry"),
    buildCompletionEventId("t1", "s2", "f", "categoryEntry"),
    buildCompletionEventId("t1", "s1", "g", "categoryEntry"),
    buildCompletionEventId("t1", "s1", "f", "manualReviewField"),
  ]));
  assert.equal(distinctTrackers.size, 5);
});

// Regression for the exact ambiguity a naive `join(":")`/`join("|")` would
// have: without length-prefixing, ("a", "b|c") and ("a|b", "c") could hash
// identically even though they're different (trackerId, sourceDocumentId)
// pairs.
test("buildCompletionEventId: length-prefixing removes join-ambiguity between adjacent fields", async () => {
  const a = await buildCompletionEventId("a", "b|c", "f", "categoryEntry");
  const b = await buildCompletionEventId("a|b", "c", "f", "categoryEntry");
  assert.notEqual(a, b);
});

test("assertNoCompletionEventIdCollision: identical identity fields (a legitimate re-fetch of the same event) never throws", () => {
  const event = { id: "abc", trackerId: "t1", sourceDocumentId: "s1", sourceFieldKey: "f", sourceType: "categoryEntry" };
  assert.doesNotThrow(() => assertNoCompletionEventIdCollision(event, { ...event }));
});

test("assertNoCompletionEventIdCollision: no existing doc at that id never throws", () => {
  const event = { id: "abc", trackerId: "t1", sourceDocumentId: "s1", sourceFieldKey: "f", sourceType: "categoryEntry" };
  assert.doesNotThrow(() => assertNoCompletionEventIdCollision(event, null));
  assert.doesNotThrow(() => assertNoCompletionEventIdCollision(event, undefined));
});

test("assertNoCompletionEventIdCollision: a same-id but different-identity document throws and names the mismatched fields", () => {
  const event = { id: "abc", trackerId: "t1", sourceDocumentId: "s1", sourceFieldKey: "f", sourceType: "categoryEntry" };
  const collidingDoc = { trackerId: "t2", sourceDocumentId: "s1", sourceFieldKey: "f", sourceType: "categoryEntry" }; // different trackerId, same hash id (hypothetically)
  assert.throws(() => assertNoCompletionEventIdCollision(event, collidingDoc), /collision/);
  assert.throws(() => assertNoCompletionEventIdCollision(event, collidingDoc), /trackerId/);
});
