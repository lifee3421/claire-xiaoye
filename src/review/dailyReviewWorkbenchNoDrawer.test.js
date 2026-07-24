import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const workbenchPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "DailyReviewWorkbench.jsx");
const source = readFileSync(workbenchPath, "utf8");

test("DailyReviewWorkbench.jsx no longer imports or renders ReviewEditDrawer", () => {
  assert.equal(source.includes("ReviewEditDrawer"), false);
});
