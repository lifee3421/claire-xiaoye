import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  NEW_WORLD_PLANNER_BRIDGE_PATHS,
  dispatchNewWorldPlannerBridge,
  verifyNewWorldPlannerBridge,
} from "./newWorldPlannerBridgeEndpoint.js";

function sign(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

test("New World Planner bridge uses the existing Catkeeper HMAC wire contract", () => {
  const secret = "bridge-secret";
  const timestamp = "100000";
  const rawBody = JSON.stringify({ path: "/api/planner-ui-context", body: { date: "2026-08-19" } });
  const signature = sign(secret, timestamp, rawBody);
  assert.deepEqual(verifyNewWorldPlannerBridge({
    headers: { "x-catkeeper-timestamp": timestamp, "x-catkeeper-signature": signature },
    rawBody,
    secret,
    now: 100000,
  }), { ok: true });
  assert.equal(verifyNewWorldPlannerBridge({
    headers: { "x-catkeeper-timestamp": timestamp, "x-catkeeper-signature": "0".repeat(64) },
    rawBody,
    secret,
    now: 100000,
  }).code, "invalid_signature");
});

test("bridge surface is an explicit allowlist and rejects arbitrary legacy paths before Firestore", async () => {
  assert.deepEqual([...NEW_WORLD_PLANNER_BRIDGE_PATHS], [
    "/api/planner-ui-context",
    "/api/planner-standalone-mutate",
    "/api/planner-standalone-meta",
    "/api/planner-draft-sidecar",
    "/api/planner-ui-proposal",
    "/api/planner-ui-proposal-apply",
  ]);
  const result = await dispatchNewWorldPlannerBridge({ db: null, uid: "pinned", path: "/api/not-a-planner-route", body: { uid: "attacker" } });
  assert.equal(result.status, 404);
});

test("bridge target uid is server-pinned and request body cannot choose it", async () => {
  const source = await readFile(new URL("./newWorldPlannerBridgeEndpoint.js", import.meta.url), "utf8");
  assert.match(source, /CATKEEPER_USER_UID/);
  assert.doesNotMatch(source, /envelope\?\.uid|body\.uid|body\?\.uid/);
});

test("HMAC bridge reuses consolidated planner function budget rather than adding a thirteenth api function", async () => {
  const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  const rewrite = vercel.rewrites.find((item) => item.source === "/api/newworld-planner-bridge");
  assert.equal(rewrite.destination, "/api/planner?__plannerRoute=newworld-bridge");
  const planner = await readFile(new URL("../../api/planner.js", import.meta.url), "utf8");
  assert.match(planner, /\["newworld-bridge", newWorldPlannerBridgeHandler\]/);
  assert.match(planner, /route === "direct-edit" \|\| route === "newworld-bridge"/);
});
