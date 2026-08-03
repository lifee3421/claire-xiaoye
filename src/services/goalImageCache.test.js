// Cache-ownership test for the dashboard goal image render path.
//
// The render cache in goalImageFirestore.js (readGoalImageAssetCached) MUST store
// the raw asset bytes / Firestore data — NEVER an object URL.  Object URLs are
// revoked on unmount; if the cache held one, the next (cache-hit) mount would
// hand back an already-revoked blob: URL and the image would break.
//
// This test reproduces the component lifecycle the useGoalImageSource hook drives:
//   mount 1  -> asset read once (Firestore), fresh object URL minted
//   unmount 1-> object URL revoked
//   mount 2  -> cache hit (NO Firestore re-read), but a NEW object URL is minted
//               from the cached bytes, and it still renders
//   mount 3  -> proves the cached value is bytes, not a URL (keeps minting fresh URLs)

import test from "node:test";
import assert from "node:assert/strict";
import { __setGetDocImpl, __resetFirestoreMock, Bytes } from "./__test_mocks__/firestore.mock.js";
import { readGoalImageAssetCached, __clearGoalImageAssetCache } from "./goalImageFirestore.js";
import { resolveGoalImageSource } from "./goalImageAsset.js";

function snapshot(data) {
  return { exists: () => data !== null, data: () => (data ? { ...data } : undefined) };
}

test("goal image render cache stores raw bytes, not object URLs", async () => {
  __resetFirestoreMock();
  __clearGoalImageAssetCache();

  const uid = "cache-user";
  const version = "2026-08-03T00:00:00.000Z";
  const bytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const contentType = "image/png";

  let getDocCalls = 0;
  __setGetDocImpl((ref) => {
    getDocCalls += 1;
    if (ref?.path === `users/${uid}/assets/dashboardGoalImage`) {
      return Promise.resolve(snapshot({
        bytes: Bytes.fromUint8Array(bytes),
        contentType,
        byteSize: bytes.byteLength,
        updatedAt: { __kind: "serverTimestamp" },
      }));
    }
    return Promise.resolve(snapshot(null));
  });

  let urlCounter = 0;
  const createdUrls = [];
  const createObjectURL = (blob) => {
    const url = `blob:goal-image/${++urlCounter}`;
    createdUrls.push(url);
    return url;
  };
  const revoked = [];
  const revokeObjectURL = (url) => revoked.push(url);

  const profile = {
    id: uid,
    dashboardGoalImageRef: {
      kind: "firestore-asset",
      path: "assets/dashboardGoalImage",
      contentType,
      byteSize: bytes.byteLength,
      version,
    },
  };

  // --- Mount 1: reads Firestore once, mints a fresh object URL ---
  const r1 = await resolveGoalImageSource({ profile, readAsset: readGoalImageAssetCached, createObjectURL, revokeObjectURL });
  assert.equal(r1.kind, "asset", "resolves to the asset");
  assert.equal(getDocCalls, 1, "asset is read exactly once on first mount");
  const url1 = r1.src;
  assert.equal(url1, "blob:goal-image/1", "first mount produces a fresh object URL");

  // --- Unmount 1: the URL minted on mount 1 is revoked ---
  r1.revoke();
  assert.deepEqual(revoked, [url1], "object URL from mount 1 is revoked on unmount");

  // --- Mount 2: same uid+version => cache hit, NO Firestore re-read, but a
  //     brand-new object URL is minted from the cached bytes.  If the cache
  //     had stored the (now-revoked) blob: URL, this would hand back a dead
  //     URL and the image would break. ---
  const r2 = await resolveGoalImageSource({ profile, readAsset: readGoalImageAssetCached, createObjectURL, revokeObjectURL });
  assert.equal(getDocCalls, 1, "second mount hits the data cache and does NOT re-read Firestore");
  const url2 = r2.src;
  assert.notEqual(url2, url1, "second mount creates a NEW object URL, not the revoked cached one");
  assert.equal(r2.kind, "asset", "second mount still renders the asset");

  r2.revoke();
  assert.deepEqual(revoked, [url1, url2], "both mounts' URLs are revoked exactly once each");

  // --- Mount 3: the cache must hold bytes, never a URL.  A third mount keeps
  //     minting yet another fresh URL from the same cached bytes. ---
  const r3 = await resolveGoalImageSource({ profile, readAsset: readGoalImageAssetCached, createObjectURL, revokeObjectURL });
  assert.equal(getDocCalls, 1, "third mount is still served from the cache");
  assert.equal(r3.src, "blob:goal-image/3", "cache keeps producing fresh URLs, never a stale one");
  r3.revoke();
});

test("goal image cache: legacy fallback does not trigger an asset read", async () => {
  // Guard so the read-path assertion above is meaningful: without a ref the
  // resolver must go straight to the legacy data URL and never call getDoc.
  __resetFirestoreMock();
  __clearGoalImageAssetCache();
  let getDocCalls = 0;
  __setGetDocImpl(() => { getDocCalls += 1; return Promise.resolve(snapshot(null)); });

  const profile = { id: "u2", dashboardGoalImage: "data:image/png;base64,AAAA" };
  const r = await resolveGoalImageSource({
    profile,
    readAsset: readGoalImageAssetCached,
    createObjectURL: () => "blob:x",
    revokeObjectURL: () => {},
  });
  assert.equal(r.kind, "legacy", "no ref => legacy data URL fallback");
  assert.equal(getDocCalls, 0, "no asset read when profile has no ref");
});
