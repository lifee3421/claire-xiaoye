import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { uploadGoalImageForProfile, MAX_GOAL_IMAGE_BYTES } from "./goalImageUpload.js";

// ---------------------------------------------------------------------------
// Unit tests — pure helper, no Firebase / DOM required.
// ---------------------------------------------------------------------------

test("uploadGoalImageForProfile calls upload with profileId (not data.profile.id)", async () => {
  const calls = [];
  const upload = async (uid, blob) => {
    calls.push([uid, blob]);
    return "https://storage.example/goal-image";
  };
  const file = new File([new Uint8Array([1, 2, 3])], "goal.png", { type: "image/png" });

  const result = await uploadGoalImageForProfile({ profileId: "user-123", file, upload });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://storage.example/goal-image");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "user-123"); // the UID handed to Storage
  assert.equal(calls[0][1], file);
});

test("uploadGoalImageForProfile returns too_large when file exceeds the cap", async () => {
  const upload = async () => "https://storage.example/x";
  const big = new File([new Uint8Array(MAX_GOAL_IMAGE_BYTES + 1)], "big.png", { type: "image/png" });

  const result = await uploadGoalImageForProfile({ profileId: "u", file: big, upload });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_large");
});

test("uploadGoalImageForProfile skips when no file is provided", async () => {
  const upload = async () => "https://storage.example/x";

  const result = await uploadGoalImageForProfile({ profileId: "u", file: null, upload });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
});

test("uploadGoalImageForProfile throws when upload fn is missing", async () => {
  const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });

  await assert.rejects(
    () => uploadGoalImageForProfile({ profileId: "u", file }),
    /upload function is required/,
  );
});

// ---------------------------------------------------------------------------
// Source-contract test — guards the CALL SITE in src/App.jsx.
//
// The original bug was `uploadGoalImage(data.profile.id, file)` inside
// SettingsPage, where `data` is NOT in scope (SettingsPage only receives
// `profile`).  That produced a runtime ReferenceError only when a user
// selected an image.  This test fails the build if the buggy pattern
// reappears or if the fixed call site drifted.
// ---------------------------------------------------------------------------

test("App.jsx calls upload with profile.id (no data.profile.id ReferenceError)", () => {
  const appPath = fileURLToPath(new URL("../App.jsx", import.meta.url));
  const source = readFileSync(appPath, "utf8");

  // The buggy pattern must never exist anywhere.
  assert.equal(
    source.includes("uploadGoalImage(data.profile.id"),
    false,
    "Found uploadGoalImage(data.profile.id, ...) — SettingsPage has no `data` in scope; this throws a runtime ReferenceError on upload.",
  );

  // The fixed call site must use the injected helper with profile.id.
  assert.ok(
    source.includes("uploadGoalImageForProfile({ profileId: profile.id"),
    "Expected SettingsPage.handleGoalImageChange to call uploadGoalImageForProfile({ profileId: profile.id, ... }).",
  );
});
