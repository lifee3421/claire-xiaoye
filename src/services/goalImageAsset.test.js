// Tests for the dashboard goal image "A1" model: bytes in a Firestore
// sub-document, a lightweight pointer on the profile, no Cloud Storage.
//
// The write ordering and the read fallback chain are the parts that can
// destroy a user's only copy of their image, so they are tested directly
// rather than through the UI.  Everything here runs under plain `node --test`
// because goalImageAsset.js / goalImageCompress.js import neither firebase
// nor the DOM.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  GOAL_IMAGE_ASSET_COLLECTION,
  GOAL_IMAGE_ASSET_DOC_ID,
  GOAL_IMAGE_MAX_BYTES,
  buildGoalImageAssetDoc,
  buildGoalImageProfilePatch,
  buildGoalImageProfileRef,
  decodeGoalImageBytes,
  goalImageAssetPath,
  hasGoalImageRef,
  isLegacyBase64GoalImage,
  profileHasGoalImage,
  resolveGoalImageSource,
  saveGoalImageAsset,
} from "./goalImageAsset.js";
import {
  GOAL_IMAGE_MAX_EDGE,
  GOAL_IMAGE_TARGET_BYTES,
  compressGoalImage,
  fitWithinMaxEdge,
} from "./goalImageCompress.js";

// --- helpers ---------------------------------------------------------------

// Stand-in for the Firestore `Bytes` class — same duck-typed surface
// (fromUint8Array / toUint8Array) that goalImageAsset.js relies on so it never
// has to import the SDK.
class FakeBytes {
  constructor(view) {
    this.view = view;
  }
  static fromUint8Array(view) {
    return new FakeBytes(view);
  }
  toUint8Array() {
    return this.view;
  }
}

const SERVER_TIMESTAMP = { __kind: "serverTimestamp" };
const timestamp = () => SERVER_TIMESTAMP;
const toBytes = (view) => FakeBytes.fromUint8Array(view);

function bytesOf(length, seed = 7) {
  const view = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) view[i] = (i * seed) % 256;
  return view;
}

const LEGACY_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

/**
 * Builds a fully-instrumented saveGoalImageAsset harness: every injected
 * dependency records its calls so the ORDER and the "was it called at all"
 * assertions can be made precisely.
 */
function makeSaveHarness(overrides = {}) {
  const order = [];
  const commitCalls = [];
  const writeCalls = [];
  const compressed = overrides.compressed ?? { bytes: bytesOf(2048), contentType: "image/webp" };

  const harness = {
    order,
    commitCalls,
    writeCalls,
    compress: overrides.compress
      ?? (async () => {
        order.push("compress");
        return compressed;
      }),
    writeAsset: overrides.writeAsset
      ?? (async (args) => {
        order.push("writeAsset");
        writeCalls.push(args);
      }),
    readAsset: overrides.readAsset
      ?? (async () => {
        order.push("readAsset");
        return { bytes: FakeBytes.fromUint8Array(compressed.bytes), contentType: compressed.contentType, byteSize: compressed.bytes.byteLength };
      }),
    commitRef: overrides.commitRef
      ?? (async (args) => {
        order.push("commitRef");
        commitCalls.push(args);
      }),
  };
  return harness;
}

// ---------------------------------------------------------------------------
// 1. Bytes encode / decode
// ---------------------------------------------------------------------------

test("decodeGoalImageBytes accepts every shape Firestore can hand back", () => {
  const raw = bytesOf(16);

  assert.deepEqual(decodeGoalImageBytes(raw), raw);
  assert.deepEqual(decodeGoalImageBytes(FakeBytes.fromUint8Array(raw)), raw);
  assert.deepEqual(decodeGoalImageBytes([...raw]), raw);
  assert.deepEqual(decodeGoalImageBytes(raw.buffer), raw);

  assert.equal(decodeGoalImageBytes(null), null);
  assert.equal(decodeGoalImageBytes(undefined), null);
  assert.equal(decodeGoalImageBytes("data:image/png;base64,AAA"), null);
});

test("buildGoalImageAssetDoc round-trips the bytes and carries contentType/byteSize/serverTimestamp", () => {
  const raw = bytesOf(4096);

  const doc = buildGoalImageAssetDoc({ bytes: raw, contentType: "image/webp", toBytes, timestamp });

  // Stored as Firestore Bytes, NOT base64 — the whole point of A1.
  assert.ok(doc.bytes instanceof FakeBytes);
  assert.deepEqual(decodeGoalImageBytes(doc.bytes), raw);
  assert.equal(doc.byteSize, 4096);
  assert.equal(doc.contentType, "image/webp");
  // A brand-new document, so serverTimestamp() is safe: there is no existing
  // Timestamp being coerced into a string.
  assert.equal(doc.updatedAt, SERVER_TIMESTAMP);
  assert.equal(JSON.stringify(doc).includes("data:"), false);
});

test("buildGoalImageAssetDoc defaults contentType and rejects empty / oversized bytes", () => {
  assert.equal(buildGoalImageAssetDoc({ bytes: bytesOf(8), toBytes, timestamp }).contentType, "image/webp");

  assert.throws(() => buildGoalImageAssetDoc({ bytes: new Uint8Array(0), toBytes, timestamp }), /bytes are required/);
  assert.throws(() => buildGoalImageAssetDoc({ bytes: null, toBytes, timestamp }), /bytes are required/);

  try {
    buildGoalImageAssetDoc({ bytes: new Uint8Array(GOAL_IMAGE_MAX_BYTES + 1), toBytes, timestamp });
    assert.fail("expected the oversized guard to throw");
  } catch (error) {
    assert.equal(error.code, "too_large");
  }
});

// ---------------------------------------------------------------------------
// 2. Profile ref construction
// ---------------------------------------------------------------------------

test("goalImageAssetPath points at users/{uid}/assets/dashboardGoalImage", () => {
  assert.equal(goalImageAssetPath("uid-1"), "users/uid-1/assets/dashboardGoalImage");
  assert.equal(GOAL_IMAGE_ASSET_COLLECTION, "assets");
  assert.equal(GOAL_IMAGE_ASSET_DOC_ID, "dashboardGoalImage");
  assert.throws(() => goalImageAssetPath(""), /uid is required/);
});

test("buildGoalImageProfileRef stays a tiny pointer with no image data in it", () => {
  const ref = buildGoalImageProfileRef({ uid: "uid-1", contentType: "image/webp", byteSize: 401_234, version: "2026-08-03T06:00:00.000Z" });

  assert.deepEqual(ref, {
    kind: "firestore-asset",
    path: "assets/dashboardGoalImage",
    contentType: "image/webp",
    byteSize: 401234,
    version: "2026-08-03T06:00:00.000Z",
  });

  // The entire reason the image left the profile document: the replacement
  // must be negligible next to Firestore's 1 MiB per-document limit.
  const serialized = JSON.stringify(ref);
  assert.ok(serialized.length < 300, `profile ref should stay tiny, got ${serialized.length} bytes`);
  assert.equal(serialized.includes("data:"), false);

  // `path` is relative to users/{uid} so the pointer never has to carry the
  // uid, and `kind` brands the backend so future asset stores can be told apart.
  assert.equal(ref.kind, "firestore-asset");
  assert.equal(ref.path, `${GOAL_IMAGE_ASSET_COLLECTION}/${GOAL_IMAGE_ASSET_DOC_ID}`);

  // Defaults, and numeric coercion for a byteSize that arrived as a string.
  const fallback = buildGoalImageProfileRef({ uid: "uid-2" });
  assert.equal(fallback.kind, "firestore-asset");
  assert.equal(fallback.contentType, "image/webp");
  assert.equal(fallback.byteSize, 0);
  assert.equal(fallback.version, "");
});

test("hasGoalImageRef / profileHasGoalImage / isLegacyBase64GoalImage classify profiles correctly", () => {
  const withRef = { dashboardGoalImageRef: { kind: "firestore-asset", path: "assets/dashboardGoalImage" } };
  const legacyOnly = { dashboardGoalImage: LEGACY_DATA_URL };

  assert.equal(hasGoalImageRef(withRef), true);
  assert.equal(hasGoalImageRef(legacyOnly), false);
  assert.equal(hasGoalImageRef({ dashboardGoalImageRef: {} }), false);
  assert.equal(hasGoalImageRef(null), false);

  assert.equal(profileHasGoalImage(withRef), true);
  assert.equal(profileHasGoalImage(legacyOnly), true);
  assert.equal(profileHasGoalImage({ dashboardGoalImage: "" }), false);

  assert.equal(isLegacyBase64GoalImage(LEGACY_DATA_URL), true);
  assert.equal(isLegacyBase64GoalImage("https://example.test/x.png"), false);
  assert.equal(isLegacyBase64GoalImage(null), false);
});

// ---------------------------------------------------------------------------
// 3. Read path — legacy base64 fallback
// ---------------------------------------------------------------------------

test("resolveGoalImageSource falls back to the legacy base64 when there is no ref yet", async () => {
  let readCalls = 0;

  const resolved = await resolveGoalImageSource({
    profile: { id: "uid-1", dashboardGoalImage: LEGACY_DATA_URL, dashboardGoalImageRef: null },
    readAsset: async () => {
      readCalls += 1;
      return null;
    },
    createObjectURL: () => "blob:should-not-happen",
    revokeObjectURL: () => {},
  });

  assert.equal(resolved.kind, "legacy");
  assert.equal(resolved.src, LEGACY_DATA_URL);
  assert.equal(readCalls, 0, "no ref means no Firestore read at all");
  // Still safe to call — callers revoke unconditionally in effect cleanup.
  assert.doesNotThrow(() => resolved.revoke());
});

test("resolveGoalImageSource returns the placeholder shape when there is nothing to show", async () => {
  const resolved = await resolveGoalImageSource({
    profile: { id: "uid-1", dashboardGoalImage: "", dashboardGoalImageRef: null },
    readAsset: async () => null,
    createObjectURL: () => "blob:nope",
    revokeObjectURL: () => {},
  });

  assert.equal(resolved.kind, "none");
  assert.equal(resolved.src, "");
});

// ---------------------------------------------------------------------------
// 4. Read path — asset read failure must degrade, never blank the card
// ---------------------------------------------------------------------------

test("resolveGoalImageSource falls back to legacy base64 when the asset read throws", async () => {
  const errors = [];

  const resolved = await resolveGoalImageSource({
    profile: {
      id: "uid-1",
      dashboardGoalImage: LEGACY_DATA_URL,
      dashboardGoalImageRef: { path: "users/uid-1/assets/dashboardGoalImage", version: "v1" },
    },
    readAsset: async () => {
      throw new Error("permission-denied");
    },
    createObjectURL: () => "blob:should-not-happen",
    revokeObjectURL: () => {},
    onError: (error) => errors.push(error),
  });

  assert.equal(resolved.kind, "legacy");
  assert.equal(resolved.src, LEGACY_DATA_URL);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /permission-denied/);
});

test("resolveGoalImageSource degrades to the placeholder when the asset read fails and there is no legacy image", async () => {
  const resolved = await resolveGoalImageSource({
    profile: {
      id: "uid-1",
      dashboardGoalImage: "",
      dashboardGoalImageRef: { path: "users/uid-1/assets/dashboardGoalImage", version: "v1" },
    },
    readAsset: async () => {
      throw new Error("unavailable");
    },
    createObjectURL: () => "blob:should-not-happen",
    revokeObjectURL: () => {},
  });

  assert.equal(resolved.kind, "none");
  assert.equal(resolved.src, "");
});

test("resolveGoalImageSource falls back when the asset document exists but carries no usable bytes", async () => {
  const resolved = await resolveGoalImageSource({
    profile: {
      id: "uid-1",
      dashboardGoalImage: LEGACY_DATA_URL,
      dashboardGoalImageRef: { path: "users/uid-1/assets/dashboardGoalImage", version: "v1" },
    },
    readAsset: async () => ({ bytes: new Uint8Array(0), contentType: "image/webp" }),
    createObjectURL: () => "blob:should-not-happen",
    revokeObjectURL: () => {},
  });

  assert.equal(resolved.kind, "legacy");
  assert.equal(resolved.src, LEGACY_DATA_URL);
});

// ---------------------------------------------------------------------------
// 5. Write path — a failed asset write must never destroy the old image
// ---------------------------------------------------------------------------

test("saveGoalImageAsset never touches the profile when the asset write fails", async () => {
  const harness = makeSaveHarness({
    writeAsset: async () => {
      throw new Error("firestore unavailable");
    },
  });

  await assert.rejects(
    () => saveGoalImageAsset({ uid: "uid-1", file: { name: "goal.png" }, ...harness }),
    /firestore unavailable/,
  );

  // The profile still points at whatever it pointed at before, so the user's
  // previous image (legacy base64 or an older asset) is untouched.
  assert.equal(harness.commitCalls.length, 0, "commitRef must not run after a failed asset write");
  assert.deepEqual(harness.order, ["compress"]);
});

test("saveGoalImageAsset rejects an over-cap image before writing anything", async () => {
  const harness = makeSaveHarness({ compressed: { bytes: new Uint8Array(GOAL_IMAGE_MAX_BYTES + 1), contentType: "image/webp" } });

  const result = await saveGoalImageAsset({ uid: "uid-1", file: { name: "huge.png" }, ...harness });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_large");
  assert.equal(harness.writeCalls.length, 0);
  assert.equal(harness.commitCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 6. Write path — read-back verification must gate the profile update
// ---------------------------------------------------------------------------

test("saveGoalImageAsset leaves the profile alone when the read-back finds nothing", async () => {
  const harness = makeSaveHarness({
    readAsset: async () => {
      harness.order.push("readAsset");
      return null;
    },
  });

  await assert.rejects(
    () => saveGoalImageAsset({ uid: "uid-1", file: { name: "goal.png" }, ...harness }),
    (error) => error.code === "readback_failed",
  );

  assert.equal(harness.commitCalls.length, 0, "an unverified asset must never be pointed at");
});

test("saveGoalImageAsset leaves the profile alone when the read-back size disagrees", async () => {
  const harness = makeSaveHarness({
    readAsset: async () => {
      harness.order.push("readAsset");
      // Truncated write — exactly the case a blind "assume it worked" would miss.
      return { bytes: FakeBytes.fromUint8Array(bytesOf(1024)), byteSize: 1024 };
    },
  });

  await assert.rejects(
    () => saveGoalImageAsset({ uid: "uid-1", file: { name: "goal.png" }, ...harness }),
    (error) => error.code === "readback_mismatch",
  );

  assert.equal(harness.commitCalls.length, 0);
});

test("saveGoalImageAsset leaves the profile alone when the stored byteSize field disagrees with the bytes", async () => {
  const raw = bytesOf(2048);
  const harness = makeSaveHarness({
    compressed: { bytes: raw, contentType: "image/webp" },
    readAsset: async () => {
      harness.order.push("readAsset");
      return { bytes: FakeBytes.fromUint8Array(raw), byteSize: 999 };
    },
  });

  await assert.rejects(
    () => saveGoalImageAsset({ uid: "uid-1", file: { name: "goal.png" }, ...harness }),
    (error) => error.code === "readback_mismatch",
  );

  assert.equal(harness.commitCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 7. Write path — success drops the base64 from the profile
// ---------------------------------------------------------------------------

test("buildGoalImageProfilePatch always clears the legacy base64 alongside the new pointer", () => {
  const ref = buildGoalImageProfileRef({ uid: "uid-1", byteSize: 100, version: "v1" });

  const patch = buildGoalImageProfilePatch(ref);
  assert.equal(patch.dashboardGoalImage, "", "the inline base64 must be cleared in the same write");
  assert.deepEqual(patch.dashboardGoalImageRef, ref);
  assert.equal(JSON.stringify(patch).includes("data:"), false);

  // Clearing the image detaches the pointer explicitly rather than omitting it
  // (merge:true would otherwise leave a stale pointer behind).
  assert.deepEqual(buildGoalImageProfilePatch(null), { dashboardGoalImageRef: null, dashboardGoalImage: "" });
});

test("saveGoalImageAsset succeeds in strict order and hands the profile a base64-free patch", async () => {
  const raw = bytesOf(3000);
  const harness = makeSaveHarness({ compressed: { bytes: raw, contentType: "image/webp" } });

  const result = await saveGoalImageAsset({
    uid: "uid-1",
    file: { name: "goal.png" },
    ...harness,
    now: () => "2026-08-03T06:30:00.000Z",
  });

  // 1 compress -> 2 write -> 3 verify -> 4 commit. Any other order would open a
  // window where the profile points at bytes that may not exist.
  assert.deepEqual(harness.order, ["compress", "writeAsset", "readAsset", "commitRef"]);

  assert.equal(result.ok, true);
  assert.equal(result.byteSize, 3000);
  assert.equal(result.contentType, "image/webp");
  assert.deepEqual(result.ref, {
    kind: "firestore-asset",
    path: "assets/dashboardGoalImage",
    contentType: "image/webp",
    byteSize: 3000,
    version: "2026-08-03T06:30:00.000Z",
  });

  assert.equal(harness.commitCalls.length, 1);
  const { patch } = harness.commitCalls[0];
  assert.equal(patch.dashboardGoalImage, "", "profile must no longer carry the inline image after a successful save");
  assert.deepEqual(patch.dashboardGoalImageRef, result.ref);
  assert.equal(JSON.stringify(patch).includes("data:"), false);

  // And the asset write got the raw bytes, not a base64 string.
  assert.equal(harness.writeCalls.length, 1);
  assert.ok(harness.writeCalls[0].bytes instanceof Uint8Array);
  assert.equal(harness.writeCalls[0].bytes.byteLength, 3000);
});

test("saveGoalImageAsset skips silently with no file and validates its injected dependencies", async () => {
  const harness = makeSaveHarness();

  const skipped = await saveGoalImageAsset({ uid: "uid-1", file: null, ...harness });
  assert.deepEqual(skipped, { ok: false, skipped: true });
  assert.equal(harness.writeCalls.length, 0);

  await assert.rejects(() => saveGoalImageAsset({ uid: "", file: {}, ...harness }), /uid is required/);
  await assert.rejects(
    () => saveGoalImageAsset({ uid: "uid-1", file: {}, writeAsset: harness.writeAsset, readAsset: harness.readAsset, commitRef: harness.commitRef }),
    /compress function is required/,
  );
});

// ---------------------------------------------------------------------------
// 8. objectURL lifecycle
// ---------------------------------------------------------------------------

test("resolveGoalImageSource revokes its objectURL exactly once", async () => {
  const created = [];
  const revoked = [];
  const raw = bytesOf(512);

  const resolved = await resolveGoalImageSource({
    profile: {
      id: "uid-1",
      dashboardGoalImage: LEGACY_DATA_URL,
      dashboardGoalImageRef: { path: "users/uid-1/assets/dashboardGoalImage", version: "v1", contentType: "image/webp" },
    },
    readAsset: async () => ({ bytes: FakeBytes.fromUint8Array(raw), contentType: "image/webp" }),
    createObjectURL: (blob) => {
      created.push(blob);
      return `blob:goal-${created.length}`;
    },
    revokeObjectURL: (url) => revoked.push(url),
  });

  assert.equal(resolved.kind, "asset", "a readable asset must win over the legacy base64");
  assert.equal(resolved.src, "blob:goal-1");
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "image/webp");
  assert.equal(created[0].size, 512);

  resolved.revoke();
  assert.deepEqual(revoked, ["blob:goal-1"]);

  // Idempotent: a cancelled effect and its cleanup both call revoke(), and a
  // double URL.revokeObjectURL on the same handle must not be able to hit an
  // unrelated, later-allocated blob.
  resolved.revoke();
  resolved.revoke();
  assert.deepEqual(revoked, ["blob:goal-1"]);
});

test("resolveGoalImageSource passes the asset contentType through to the blob, falling back to the ref", async () => {
  const raw = bytesOf(64);
  const resolved = await resolveGoalImageSource({
    profile: {
      id: "uid-1",
      dashboardGoalImage: "",
      dashboardGoalImageRef: { path: "users/uid-1/assets/dashboardGoalImage", version: "v1", contentType: "image/jpeg" },
    },
    readAsset: async () => ({ bytes: raw }),
    createObjectURL: (blob) => {
      assert.equal(blob.type, "image/jpeg");
      return "blob:typed";
    },
    revokeObjectURL: () => {},
  });

  assert.equal(resolved.src, "blob:typed");
});

// ---------------------------------------------------------------------------
// Client-side compression
// ---------------------------------------------------------------------------

test("fitWithinMaxEdge caps the longest edge at 1200px and never upscales", () => {
  assert.deepEqual(fitWithinMaxEdge(2400, 1600), { width: 1200, height: 800 });
  assert.deepEqual(fitWithinMaxEdge(1600, 2400), { width: 800, height: 1200 });
  assert.deepEqual(fitWithinMaxEdge(640, 480), { width: 640, height: 480 });
  assert.deepEqual(fitWithinMaxEdge(3000, 10), { width: 1200, height: 4 });
  assert.equal(GOAL_IMAGE_MAX_EDGE, 1200);
  assert.equal(GOAL_IMAGE_TARGET_BYTES, 400 * 1024);
});

function makeCompressDeps(sizeFor) {
  const encodeCalls = [];
  const drawCalls = [];
  const bitmap = { width: 2400, height: 1600, closed: false, close() { this.closed = true; } };
  return {
    bitmap,
    encodeCalls,
    drawCalls,
    deps: {
      loadBitmap: async () => bitmap,
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => ({ drawImage: (_bm, _x, _y, w, h) => drawCalls.push({ width: w, height: h }) }),
      }),
      encode: async (canvas, type, quality) => {
        encodeCalls.push({ width: canvas.width, quality });
        return new Blob([new Uint8Array(sizeFor(canvas.width, quality))], { type });
      },
    },
  };
}

test("compressGoalImage returns the first WebP candidate under the ~400KB target", async () => {
  const { deps, encodeCalls, bitmap } = makeCompressDeps(() => 300 * 1024);

  const result = await compressGoalImage({ name: "photo.jpg" }, deps);

  assert.equal(result.byteSize, 300 * 1024);
  assert.equal(result.contentType, "image/webp");
  assert.equal(result.width, 1200);
  assert.equal(result.height, 800);
  assert.equal(result.quality, 0.82);
  assert.equal(encodeCalls.length, 1, "should stop as soon as the target is met");
  assert.equal(bitmap.closed, true, "the decoded bitmap must be released");
});

test("compressGoalImage walks the quality ladder, then a smaller edge, before giving up", async () => {
  // Nothing at 1200px fits; at 900px the ladder eventually does.
  const { deps, encodeCalls } = makeCompressDeps((width, quality) => (width === 1200 ? 700 * 1024 : quality >= 0.72 ? 500 * 1024 : 380 * 1024));

  const result = await compressGoalImage({ name: "photo.jpg" }, deps);

  assert.equal(result.width, 900, "should fall back to 75% of the max edge");
  assert.equal(result.byteSize, 380 * 1024);
  assert.equal(result.quality, 0.62);
  assert.equal(encodeCalls.filter((call) => call.width === 1200).length, 5, "full quality ladder at 1200px first");
});

test("compressGoalImage returns its smallest candidate when nothing reaches the target", async () => {
  const { deps } = makeCompressDeps((width, quality) => Math.round((width === 1200 ? 1_400_000 : 1_000_000) * quality));

  const result = await compressGoalImage({ name: "huge.png" }, deps);

  // 1_000_000 * 0.42 — the smallest thing the ladder could produce.
  assert.equal(result.byteSize, 420_000);
  assert.ok(result.byteSize > GOAL_IMAGE_TARGET_BYTES);
  assert.equal(result.width, 900);
});

test("compressGoalImage trusts the encoder's own MIME type when WebP is unsupported", async () => {
  const { deps } = makeCompressDeps(() => 100 * 1024);
  deps.encode = async (canvas) => new Blob([new Uint8Array(100 * 1024)], { type: "image/png" });

  const result = await compressGoalImage({ name: "photo.jpg" }, deps);

  assert.equal(result.contentType, "image/png");
});

// ---------------------------------------------------------------------------
// Source contracts — guard the wiring and the removal of the Storage attempt
// ---------------------------------------------------------------------------

const repoPath = (relative) => fileURLToPath(new URL(relative, import.meta.url));

test("Cloud Storage is fully removed — no SDK import, no rules file, no leftover module", () => {
  const firebaseSource = readFileSync(repoPath("./firebase.js"), "utf8");
  assert.equal(firebaseSource.includes("firebase/storage"), false, "firebase.js must not import the Storage SDK");
  assert.equal(firebaseSource.includes("getStorage"), false, "getStorage() must be gone — Storage requires Blaze, this project is on Spark");
  assert.match(firebaseSource, /export \{ app, auth, db, googleProvider \}/, "the `storage` export must be gone");

  assert.equal(existsSync(repoPath("./goalImageStorage.js")), false);
  assert.equal(existsSync(repoPath("../../storage.rules")), false);
  assert.equal(existsSync(repoPath("../../firebase.json")), false, "firebase.json only configured Storage rules");
  assert.equal(existsSync(repoPath("../../scripts/migrateGoalImageToStorage.browser.mjs")), false);
});

test("App.jsx wires the Firestore asset path and revokes the objectURL on cleanup", () => {
  const source = readFileSync(repoPath("../App.jsx"), "utf8");

  assert.equal(source.includes("goalImageStorage"), false);
  assert.equal(source.includes("uploadGoalImage"), false);

  // Read path: cached asset read, plus the effect cleanup that releases the URL.
  assert.ok(source.includes("readAsset: readGoalImageAssetCached"), "the render path must use the cached asset read");
  assert.ok(source.includes("if (revoke) revoke();"), "the goal image effect must revoke its objectURL on cleanup");
  assert.ok(source.includes("resolved.revoke();"), "a cancelled in-flight resolve must release its objectURL too");

  // Write path: SettingsPage owns `profile`, never the parent's `data`.
  assert.equal(source.includes("saveGoalImageAsset({\n        uid: data.profile.id"), false);
  assert.ok(source.includes("uid: profile.id"), "SettingsPage must pass profile.id — it has no `data` in scope");
  assert.ok(source.includes("compress: compressGoalImage"), "uploads must go through client-side compression");
});
