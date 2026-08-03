// Firestore glue for the dashboard goal image asset.
//
// Kept deliberately thin: every decision (ordering, verification, fallback,
// objectURL lifecycle) lives in the dependency-free goalImageAsset.js so it
// can be unit-tested.  This file only knows how to talk to Firestore.

import { Bytes, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import {
  GOAL_IMAGE_ASSET_COLLECTION,
  GOAL_IMAGE_ASSET_DOC_ID,
  buildGoalImageAssetDoc,
  buildGoalImageProfilePatch,
  decodeGoalImageBytes,
} from "./goalImageAsset.js";

function requireDb() {
  if (!db) throw new Error("Firestore is not initialized");
  return db;
}

function assetDocRef(uid) {
  if (!uid) throw new Error("uid is required for the goal image asset document");
  return doc(requireDb(), "users", uid, GOAL_IMAGE_ASSET_COLLECTION, GOAL_IMAGE_ASSET_DOC_ID);
}

// Render-path cache, keyed by `${uid}|${version}`.
//
// Not an optimisation — a requirement.  Spark's free tier allows 10 GiB/month
// of egress; a ~400 KB image re-downloaded on every mount of the dashboard
// would burn through that with ordinary daily use.  The version comes from the
// profile pointer, so a new upload naturally invalidates the entry.
const assetCache = new Map();
const ASSET_CACHE_LIMIT = 4;

function cacheKey(uid, version) {
  return `${uid}|${version || ""}`;
}

function dropCachedAssets(uid) {
  for (const key of [...assetCache.keys()]) {
    if (key.startsWith(`${uid}|`)) assetCache.delete(key);
  }
}

/**
 * Writes the asset document.  Uses a full setDoc (no merge) on purpose: this
 * document has exactly one job, so a replace guarantees no stale field from a
 * previous shape survives alongside the new bytes.
 */
export async function writeGoalImageAsset({ uid, bytes, contentType }) {
  const payload = buildGoalImageAssetDoc({
    bytes,
    contentType,
    toBytes: (view) => Bytes.fromUint8Array(view),
    timestamp: serverTimestamp,
  });
  await setDoc(assetDocRef(uid), payload);
  dropCachedAssets(uid);
}

/**
 * Uncached read — used by the write path's read-back verification, where a
 * cache hit would defeat the entire purpose of verifying.
 */
export async function readGoalImageAsset({ uid }) {
  const snapshot = await getDoc(assetDocRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() || {};
  return {
    bytes: data.bytes,
    contentType: data.contentType,
    byteSize: data.byteSize,
    updatedAt: data.updatedAt,
  };
}

/**
 * Cached read — used by the render path.  Uses getDoc rather than onSnapshot
 * deliberately: a long-lived subscription on a ~400 KB document would re-push
 * the whole payload on any write, which is exactly the cost we just removed
 * from the profile document.
 */
export async function readGoalImageAssetCached({ uid, version }) {
  const key = cacheKey(uid, version);
  if (assetCache.has(key)) return assetCache.get(key);

  const asset = await readGoalImageAsset({ uid });
  if (!asset) return null;

  const entry = {
    bytes: decodeGoalImageBytes(asset.bytes),
    contentType: asset.contentType,
    byteSize: asset.byteSize,
  };
  if (!entry.bytes) return null;

  if (assetCache.size >= ASSET_CACHE_LIMIT) assetCache.delete(assetCache.keys().next().value);
  assetCache.set(key, entry);
  return entry;
}

/** Test/diagnostic hook — the UI never calls this. */
export function __clearGoalImageAssetCache() {
  assetCache.clear();
}

/**
 * FINAL step of a save: point the profile at the new asset and clear the
 * legacy inline base64 in the same merge write.  Called only after the asset
 * has been written AND read back successfully.
 */
export async function commitGoalImageRef({ uid, ref, patch }) {
  if (!uid) throw new Error("uid is required to commit the goal image ref");
  await setDoc(doc(requireDb(), "users", uid), patch || buildGoalImageProfilePatch(ref), { merge: true });
}
