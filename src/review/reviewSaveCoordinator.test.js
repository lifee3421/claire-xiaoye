import test from "node:test";
import assert from "node:assert/strict";
import { runAutoDraftSave } from "./reviewSaveCoordinator.js";

test("formal save cancels a pending automatic draft save", async () => {
  const formalSavingRef = { current: true };
  let calls = 0;
  const saved = await runAutoDraftSave({
    formalSavingRef,
    payload: { status: "editing" },
    save: async () => { calls += 1; },
  });
  assert.equal(saved, false);
  assert.equal(calls, 0);
});
