import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./exercise-record-export.js", import.meta.url), "utf8");

test("exercise export endpoint loads and stays server-uid pinned", async () => {
  const mod = await import("./exercise-record-export.js");
  assert.equal(typeof mod.default, "function");
  assert.deepEqual(mod.config, { api: { bodyParser: false } });
  assert.match(source, /process\.env\.CATKEEPER_USER_UID/);
  assert.equal(source.includes("body.uid"), false);
  assert.match(source, /x-catkeeper-signature/);
});
