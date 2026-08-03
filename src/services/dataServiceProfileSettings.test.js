// Wiring-level test for dataService.js's REAL saveProfileSettings — not a
// re-implementation, not just normalizeTrackersForStorage() in isolation.
// Runs under the ESM loader hook in scripts/testEsmLoader.mjs (see
// package.json's "test" script), which lets this file import the actual
// dataService.js module by redirecting its "./firebase" and
// "firebase/firestore" imports to the test doubles in
// src/services/__test_mocks__/ instead of a live Firebase project.
import test from "node:test";
import assert from "node:assert/strict";
import { saveProfileSettings } from "./dataService.js";
import { __resetFirestoreMock, __setDocCalls } from "./__test_mocks__/firestore.mock.js";

test.beforeEach(() => {
  __resetFirestoreMock();
});

test("saveProfileSettings: writes trackers through the real setDoc call, normalized (undefined stripped)", async () => {
  await saveProfileSettings("uid-1", {
    trackers: [
      {
        id: "family-a",
        title: "联系外婆",
        schedule: { kind: "interval", every: 7, unit: "day" },
        stickerSettings: { enabled: true, emoji: "📞", title: undefined, placementMode: "timeline", time: "09:00", type: "reminder", ignored: undefined },
        archivedAt: undefined,
      },
    ],
  });

  assert.equal(__setDocCalls.length, 1);
  const { payload, options } = __setDocCalls[0];
  assert.equal(options.merge, true); // a settings save must never wholesale-replace the profile doc

  assert.ok("trackers" in payload);
  assert.equal(payload.trackers.length, 1);
  assert.equal(payload.trackers[0].id, "family-a");
  assert.equal(payload.trackers[0].stickerSettings.emoji, "📞");
  assert.equal(payload.trackers[0].stickerSettings.placementMode, "timeline");

  // normalizeTrackersForStorage's actual effect, verified on the REAL
  // payload that would be sent to Firestore — not on the pure function
  // called directly.
  assert.equal(JSON.stringify(payload).includes("undefined"), false);
  assert.equal("title" in payload.trackers[0].stickerSettings, false);
  assert.equal("ignored" in payload.trackers[0].stickerSettings, false);
  assert.equal("archivedAt" in payload.trackers[0], false);
});

test("saveProfileSettings: omitting trackers from the settings object never touches the trackers field (merge:true + key absent = untouched, not wiped)", async () => {
  await saveProfileSettings("uid-1", { displayName: "Claire" });

  assert.equal(__setDocCalls.length, 1);
  const { payload, options } = __setDocCalls[0];
  assert.equal(options.merge, true);
  assert.equal("trackers" in payload, false); // key genuinely absent from the payload
  assert.equal(payload.displayName, "Claire");
  // Because this is a setDoc(..., {merge:true}) and the key is ABSENT (not
  // set to []), Firestore's merge semantics leave the existing
  // profile.trackers field on the server completely untouched — this test
  // asserts the client-side half of that guarantee (the payload never
  // contains the key), which is what actually prevents an unrelated
  // settings save from silently wiping out a user's tracker configuration.
});

test("saveProfileSettings: explicitly saving an empty trackers array DOES include the key (an intentional clear, distinct from omission)", async () => {
  await saveProfileSettings("uid-1", { trackers: [] });
  const { payload } = __setDocCalls[0];
  assert.ok("trackers" in payload);
  assert.deepEqual(payload.trackers, []);
});

// --- dashboard goal image (Firestore asset model) --------------------------
// The image bytes live in users/{uid}/assets/dashboardGoalImage; the profile
// keeps only the pointer. These assert the profile half of that split on the
// REAL setDoc payload.

test("saveProfileSettings: persists the goal image pointer and lets the settings form clear the legacy base64", async () => {
  const ref = {
    path: "users/uid-1/assets/dashboardGoalImage",
    contentType: "image/webp",
    byteSize: 401234,
    version: "2026-08-03T06:30:00.000Z",
  };

  await saveProfileSettings("uid-1", { dashboardGoalImageRef: ref, dashboardGoalImage: "" });

  const { payload, options } = __setDocCalls[0];
  assert.equal(options.merge, true);
  assert.deepEqual(payload.dashboardGoalImageRef, ref);
  assert.equal(payload.dashboardGoalImage, "");
  // The profile must never carry image bytes again — that is what blew past
  // Firestore's 1 MiB document limit in the first place.
  assert.equal(JSON.stringify(payload).includes("data:"), false);
  assert.ok(JSON.stringify(payload).length < 400);
});

test("saveProfileSettings: clearing the goal image writes an explicit null pointer (not an omitted key)", async () => {
  await saveProfileSettings("uid-1", { dashboardGoalImageRef: null, dashboardGoalImage: "" });

  const { payload } = __setDocCalls[0];
  // Under merge:true an omitted key would leave the old pointer in place and
  // the card would keep rendering an image the user just cleared.
  assert.ok("dashboardGoalImageRef" in payload);
  assert.equal(payload.dashboardGoalImageRef, null);
});

test("saveProfileSettings: a settings save that never touches the image leaves both image fields untouched", async () => {
  await saveProfileSettings("uid-1", { displayName: "Claire" });

  const { payload } = __setDocCalls[0];
  assert.equal("dashboardGoalImageRef" in payload, false);
  assert.equal("dashboardGoalImage" in payload, false);
});
