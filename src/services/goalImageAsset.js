// Dashboard goal image — Firestore sub-document asset model ("A1").
//
// WHY THIS EXISTS
// ---------------
// The goal image used to be inlined as a base64 data URL on the top-level
// users/{uid} profile document.  At ~663.8 KB of base64 it was the single
// largest field there and pushed the profile past Firestore's hard 1 MiB
// per-document limit, which made every profile write fail with
// invalid-argument (document-too-large).
//
// The first fix moved it to Cloud Storage.  That is no longer viable: since
// 2026-02-03 Cloud Storage for Firebase requires the Blaze plan, and this
// project deliberately stays on Spark (no billing account).
//
// So the bytes now live in a dedicated sub-document:
//
//     users/{uid}/assets/dashboardGoalImage
//
// stored as a Firestore `Bytes` value — NOT base64.  base64 inflates payloads
// by ~1.33x against the very same 1 MiB per-document ceiling; `Bytes` stores
// the raw octets, so a compressed ~400 KB image sits comfortably inside one
// document with no chunking needed.
//
// The profile keeps only a ~150-byte pointer (`dashboardGoalImageRef`).  That
// matters beyond the size limit: the profile doc is under a live onSnapshot
// subscription, so leaving the image there meant re-transferring the whole
// picture on every unrelated profile field change.
//
// WHY THIS MODULE IS DEPENDENCY-FREE
// ----------------------------------
// No firebase import, no DOM import.  The write ordering, the read fallback
// chain and the objectURL lifecycle are the parts that can silently destroy a
// user's image or leak memory, so they must be unit-testable under plain
// `node --test`.  The Firestore glue lives in goalImageFirestore.js and the
// canvas work in goalImageCompress.js; both are injected here.

export const GOAL_IMAGE_ASSET_COLLECTION = "assets";
export const GOAL_IMAGE_ASSET_DOC_ID = "dashboardGoalImage";
export const GOAL_IMAGE_DEFAULT_CONTENT_TYPE = "image/webp";

// Hard ceiling on the stored bytes.  Firestore's document limit is 1 MiB and
// the asset doc also carries contentType/byteSize/updatedAt, so 900 KiB leaves
// comfortable headroom while still accepting anything the compressor produces
// in practice (it targets ~400 KB).
export const GOAL_IMAGE_MAX_BYTES = 900 * 1024;

/** Firestore path of the per-user goal image asset document. */
export function goalImageAssetPath(uid) {
  if (!uid) throw new Error("uid is required for the goal image asset path");
  return `users/${uid}/${GOAL_IMAGE_ASSET_COLLECTION}/${GOAL_IMAGE_ASSET_DOC_ID}`;
}

/**
 * Normalizes anything byte-ish into a Uint8Array.
 *
 * Accepts a Firestore `Bytes` instance (duck-typed via `toUint8Array()`, so
 * this module never has to import the SDK), a Uint8Array, any other TypedArray
 * or DataView, an ArrayBuffer, or a plain number array (what a JSON-roundtripped
 * document looks like).  Returns null for anything else — callers treat null as
 * "no usable asset" and fall back rather than throwing.
 */
export function decodeGoalImageBytes(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value.toUint8Array === "function") {
    const out = value.toUint8Array();
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

/**
 * Builds the asset document payload.
 *
 * @param {object} args
 * @param {Uint8Array} args.bytes        — raw (already compressed) image bytes
 * @param {string}   [args.contentType]  — MIME type of those bytes
 * @param {function} args.toBytes        — (Uint8Array) => Firestore Bytes; injected
 * @param {function} args.timestamp      — () => serverTimestamp() sentinel; injected
 */
export function buildGoalImageAssetDoc({ bytes, contentType, toBytes, timestamp }) {
  if (typeof toBytes !== "function") throw new Error("toBytes function is required");
  if (typeof timestamp !== "function") throw new Error("timestamp function is required");

  const view = decodeGoalImageBytes(bytes);
  if (!view || view.byteLength === 0) throw new Error("goal image bytes are required");
  if (view.byteLength > GOAL_IMAGE_MAX_BYTES) {
    const error = new Error(`goal image is ${view.byteLength} bytes, over the ${GOAL_IMAGE_MAX_BYTES} byte cap`);
    error.code = "too_large";
    throw error;
  }

  return {
    bytes: toBytes(view),
    contentType: contentType || GOAL_IMAGE_DEFAULT_CONTENT_TYPE,
    byteSize: view.byteLength,
    // serverTimestamp() sentinel — this is a brand-new document, so there is
    // no pre-existing Timestamp to accidentally coerce into a string.
    updatedAt: timestamp(),
  };
}

/**
 * Builds the lightweight pointer stored on the profile document.
 *
 * Deliberately tiny and free of any image data.  `version` doubles as the
 * client-side cache key: the render path re-reads the asset only when the
 * version changes, which keeps us well inside Spark's 10 GiB/month egress.
 *
 * The exact shape here is the CANONICAL goal-image pointer format.  The
 * one-time migration script (scripts/migrateGoalImageToFirestoreAsset.browser.mjs)
 * emits the same object so production profiles and the live app write path
 * agree on a single schema — see that script's local copy of this builder,
 * which MUST stay in sync with this one.
 *
 * `path` is the document RELATIVE to users/{uid} (the app rebuilds the
 * absolute ref from uid, so the pointer never has to carry it), and `kind`
 * brands the pointer so future asset backends can be told apart.
 */
export function buildGoalImageProfileRef({ uid, contentType, byteSize, version }) {
  return {
    kind: "firestore-asset",
    path: `${GOAL_IMAGE_ASSET_COLLECTION}/${GOAL_IMAGE_ASSET_DOC_ID}`,
    contentType: contentType || GOAL_IMAGE_DEFAULT_CONTENT_TYPE,
    byteSize: Number(byteSize) || 0,
    version: String(version || ""),
  };
}

/**
 * The profile patch applied in the FINAL step of a successful save.
 *
 * Two fields, one write: point at the new asset AND drop the legacy inline
 * base64.  Keeping these together is what guarantees the profile is never
 * left holding both (which would defeat the whole point of the migration).
 */
export function buildGoalImageProfilePatch(ref) {
  return {
    dashboardGoalImageRef: ref || null,
    dashboardGoalImage: "",
  };
}

/** True when the profile still carries the pre-migration inline data URL. */
export function isLegacyBase64GoalImage(value) {
  return typeof value === "string" && value.startsWith("data:");
}

/** True when the profile points at a Firestore asset document. */
export function hasGoalImageRef(profile) {
  const ref = profile?.dashboardGoalImageRef;
  return Boolean(ref && typeof ref === "object" && ref.path);
}

/** True when the goal card has any image to show, old-style or new-style. */
export function profileHasGoalImage(profile) {
  return hasGoalImageRef(profile) || Boolean(profile?.dashboardGoalImage);
}

// ---------------------------------------------------------------------------
// WRITE PATH
// ---------------------------------------------------------------------------

/**
 * Saves a new goal image, in a strictly ordered, fail-safe sequence.
 *
 *   1. compress          — shrink client-side before anything is written
 *   2. write asset       — the profile still points at the OLD image here, so
 *                          a failure leaves the previous picture fully intact
 *   3. read back + verify— confirm the bytes really landed, before the profile
 *                          is allowed to depend on them
 *   4. commit the ref    — and only now clear the legacy base64
 *
 * The ordering is the entire safety property: there is no window in which the
 * profile points at an asset that does not exist, and no path on which the old
 * image is destroyed before the new one is proven readable.
 *
 * @returns {Promise<{ok: boolean, ref?: object, bytes?: Uint8Array, contentType?: string, byteSize?: number, reason?: string, skipped?: boolean}>}
 */
export async function saveGoalImageAsset({
  uid,
  file,
  compress,
  writeAsset,
  readAsset,
  commitRef,
  maxBytes = GOAL_IMAGE_MAX_BYTES,
  now = () => new Date().toISOString(),
}) {
  if (!uid) throw new Error("uid is required to save the goal image");
  const injected = { compress, writeAsset, readAsset, commitRef };
  for (const [name, fn] of Object.entries(injected)) {
    if (typeof fn !== "function") throw new Error(`${name} function is required`);
  }
  if (!file) return { ok: false, skipped: true };

  // --- 1. compress -----------------------------------------------------
  const compressed = await compress(file);
  const bytes = decodeGoalImageBytes(compressed?.bytes);
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: "compress_failed" };
  if (bytes.byteLength > maxBytes) return { ok: false, reason: "too_large", byteSize: bytes.byteLength };
  const contentType = compressed?.contentType || GOAL_IMAGE_DEFAULT_CONTENT_TYPE;

  // --- 2. write the asset ----------------------------------------------
  // Any rejection here propagates untouched.  Crucially, commitRef has NOT
  // been called, so the profile still holds the previous image.
  await writeAsset({ uid, bytes, contentType });

  // --- 3. read back and verify ------------------------------------------
  const stored = await readAsset({ uid });
  const storedBytes = decodeGoalImageBytes(stored?.bytes);
  if (!storedBytes || storedBytes.byteLength === 0) {
    const error = new Error("goal image read-back returned no bytes");
    error.code = "readback_failed";
    throw error;
  }
  if (storedBytes.byteLength !== bytes.byteLength) {
    const error = new Error(`goal image read-back size mismatch: wrote ${bytes.byteLength}, read ${storedBytes.byteLength}`);
    error.code = "readback_mismatch";
    throw error;
  }
  if (stored.byteSize !== undefined && Number(stored.byteSize) !== bytes.byteLength) {
    const error = new Error(`goal image read-back byteSize mismatch: wrote ${bytes.byteLength}, doc says ${stored.byteSize}`);
    error.code = "readback_mismatch";
    throw error;
  }

  // --- 4. commit the pointer (and only now drop the legacy base64) -------
  const ref = buildGoalImageProfileRef({ uid, contentType, byteSize: bytes.byteLength, version: now() });
  await commitRef({ uid, ref, patch: buildGoalImageProfilePatch(ref) });

  return { ok: true, ref, bytes, contentType, byteSize: bytes.byteLength };
}

// ---------------------------------------------------------------------------
// READ PATH
// ---------------------------------------------------------------------------

const NOOP_REVOKE = () => {};

function defaultCreateBlob(bytes, contentType) {
  return new Blob([bytes], { type: contentType || GOAL_IMAGE_DEFAULT_CONTENT_TYPE });
}

/**
 * Resolves what the goal card should actually render, with a three-step
 * fallback so a transient Firestore hiccup can never blank the homepage:
 *
 *   1. new asset ref  → read Bytes → Blob → objectURL   (kind: "asset")
 *   2. legacy inline value on the profile                (kind: "legacy")
 *   3. nothing — caller shows the placeholder            (kind: "none")
 *
 * Always returns a `revoke()`.  For the asset path it releases the objectURL
 * exactly once (idempotent, so an early-cancelled effect and its cleanup can
 * both call it); for the other two it is a no-op.  Callers MUST invoke it on
 * unmount / before replacing the source, otherwise every re-resolve leaks a
 * few hundred KB.
 */
export async function resolveGoalImageSource({
  profile,
  readAsset,
  createObjectURL,
  revokeObjectURL,
  createBlob = defaultCreateBlob,
  onError,
}) {
  const legacy = typeof profile?.dashboardGoalImage === "string" ? profile.dashboardGoalImage : "";
  const ref = profile?.dashboardGoalImageRef;
  const uid = profile?.id;

  if (ref && ref.path && uid && typeof readAsset === "function" && typeof createObjectURL === "function") {
    try {
      const stored = await readAsset({ uid, path: ref.path, version: ref.version });
      const bytes = decodeGoalImageBytes(stored?.bytes);
      if (bytes && bytes.byteLength > 0) {
        const blob = createBlob(bytes, stored?.contentType || ref.contentType);
        const url = createObjectURL(blob);
        let revoked = false;
        return {
          kind: "asset",
          src: url,
          revoke: () => {
            if (revoked) return;
            revoked = true;
            if (typeof revokeObjectURL === "function") revokeObjectURL(url);
          },
        };
      }
    } catch (error) {
      // Deliberately swallowed: the whole point of the fallback chain is that
      // a failed asset read degrades to the previous image (or the placeholder)
      // instead of throwing into the render tree.
      if (typeof onError === "function") onError(error);
    }
  }

  if (legacy) return { kind: "legacy", src: legacy, revoke: NOOP_REVOKE };
  return { kind: "none", src: "", revoke: NOOP_REVOKE };
}
