import test from "node:test";
import assert from "node:assert/strict";
import { setCanonicalPlannerWritePatch } from "./canonicalPlannerCommit.js";

test("canonical Planner write strips undefined optional metadata before Firestore", () => {
  let captured = null;
  const transaction = {
    set(ref, value, options) { captured = { ref, value, options }; },
  };
  const userRef = { id: "user-1" };
  const sentinel = new Date("2026-08-23T12:00:00.000Z");

  setCanonicalPlannerWritePatch(transaction, userRef, {
    scheduleAssistantDraft: {
      todayCustomBlocks: [{
        id: "rescheduled-1",
        title: "数学",
        category: "数学",
        categoryId: "math",
        categoryLevel2Id: undefined,
        categoryName: undefined,
        nested: { keep: "yes", drop: undefined },
      }],
      updatedAt: sentinel,
    },
  });

  assert.ok(captured);
  assert.equal(captured.value.scheduleAssistantDraft.todayCustomBlocks[0].categoryId, "math");
  assert.equal("categoryLevel2Id" in captured.value.scheduleAssistantDraft.todayCustomBlocks[0], false);
  assert.equal("categoryName" in captured.value.scheduleAssistantDraft.todayCustomBlocks[0], false);
  assert.deepEqual(captured.value.scheduleAssistantDraft.todayCustomBlocks[0].nested, { keep: "yes" });
  assert.equal(captured.value.scheduleAssistantDraft.updatedAt, sentinel);
  assert.deepEqual(captured.options.mergeFields, ["scheduleAssistantDraft"]);
});
