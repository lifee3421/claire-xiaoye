import assert from "node:assert/strict";
import test from "node:test";
import { buildTimelineCardEditForm } from "./timelineCardEdit.js";

test("timeline card editor prefers the resolved block category over stale task metadata", () => {
  const form = buildTimelineCardEditForm({
    task: { id: "math", title: "数学", categoryId: "personal", segments: [50] },
    block: { id: "math-1", categoryId: "study.math", categoryLevel2Id: "study.math", studyMinutes: 50 },
    segmentOverride: {},
  });

  assert.equal(form.categoryId, "study.math");
});

test("an explicit segment category remains authoritative", () => {
  const form = buildTimelineCardEditForm({
    task: { categoryId: "study.math", segments: [50] },
    block: { categoryId: "study.math", studyMinutes: 50 },
    segmentOverride: { categoryId: "study.english" },
  });

  assert.equal(form.categoryId, "study.english");
});
