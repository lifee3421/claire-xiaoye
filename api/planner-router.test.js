import test from "node:test";
import assert from "node:assert/strict";
import plannerRouter, { config } from "./planner.js";

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("shared planner function disables body parsing for HMAC compatibility", () => {
  assert.equal(config.api.bodyParser, false);
});

test("unknown consolidated planner route fails closed", async () => {
  const req = { method: "GET", query: { __plannerRoute: "not-a-route" }, headers: {} };
  const res = responseRecorder();
  await plannerRouter(req, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.payload, { error: "planner route not found" });
});

for (const route of ["mutate", "direct-edit", "draft-sidecar", "ui-proposal", "ui-proposal-apply"]) {
  test(`shared planner router reaches ${route} handler`, async () => {
    const req = { method: "GET", query: { __plannerRoute: route }, headers: {} };
    const res = responseRecorder();
    await plannerRouter(req, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.payload?.error, "method not allowed");
  });
}
