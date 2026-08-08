import test from "node:test";
import assert from "node:assert/strict";
import {
  auditActorLabel,
  diffReviewPointSources,
  normalizeSettlementAudit,
  reviewPointSourceSummary,
  toAuditIso,
} from "./reviewSettlementAudit.js";

test("point-source diff explains offsetting changes even when total delta is zero", () => {
  const previous = {
    bankPointsAdded: 3,
    sleepAdjustmentPoints: 1,
    entertainmentScoreDelta: 0,
  };
  const next = {
    bankPointsAdded: 4,
    sleepAdjustmentPoints: 1,
    entertainmentScoreDelta: -1,
  };

  const changes = diffReviewPointSources(previous, next);
  assert.deepEqual(changes.map((item) => [item.key, item.delta]), [
    ["bankPointsAdded", 1],
    ["entertainmentScoreDelta", -1],
  ]);
  assert.equal(reviewPointSourceSummary(changes), "时间价值转分 +1分、自由娱乐积分 -1分");
});

test("new audit preserves first submit identity and detailed revision source", () => {
  const audit = normalizeSettlementAudit({
    firstSubmittedAt: "2026-08-08T14:15:00.000Z",
    firstSubmittedActor: "web",
    initialPointsAdded: 8,
    revisions: [{
      at: "2026-08-09T01:30:00.000Z",
      actor: "web",
      beforePointsAdded: 8,
      afterPointsAdded: 9.5,
      delta: 1.5,
      sourceChanges: [{ key: "workPoints", label: "工作积分", before: 0, after: 1.5, delta: 1.5 }],
      sourceSummary: "工作积分 +1.5分",
    }],
  });

  assert.equal(audit.firstSubmittedActor, "web");
  assert.equal(audit.initialPointsAdded, 8);
  assert.equal(audit.revisions[0].sourceSummary, "工作积分 +1.5分");
  assert.equal(auditActorLabel(audit.firstSubmittedActor), "你在网页亲自提交");
});

test("legacy non-zero revision without source details stays explicitly unknown", () => {
  const audit = normalizeSettlementAudit({}, {
    createdAt: "2026-08-01T10:00:00.000Z",
    pointsAdded: 7,
    reconciliationHistory: [{
      at: "2026-08-02T10:00:00.000Z",
      beforePointsAdded: 7,
      afterPointsAdded: 8,
      delta: 1,
      reason: "manual_review_revision",
    }],
  });

  assert.equal(audit.initialPointsAdded, 7);
  assert.equal(audit.revisions[0].delta, 1);
  assert.equal(audit.revisions[0].sourceSummary, "");
  assert.equal(auditActorLabel(audit.firstSubmittedActor), "提交来源未记录");
});

test("Firestore Timestamp-like values are accepted for first-submission display", () => {
  const timestampLike = { toDate: () => new Date("2026-08-08T14:15:00.000Z") };
  assert.equal(toAuditIso(timestampLike), "2026-08-08T14:15:00.000Z");
});
