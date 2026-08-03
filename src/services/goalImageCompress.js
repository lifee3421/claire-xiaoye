// Client-side compression for the dashboard goal image.
//
// The previous implementation only REJECTED oversized files ("图片太大，尽量
// 压到 850KB 内") and left the user to shrink them by hand.  Since the bytes
// now share Firestore's 1 MiB per-document ceiling, actually compressing is
// what removes the need for any chunking scheme: a phone photo comes in at
// several MB and leaves at ~400 KB.
//
// Every browser dependency (createImageBitmap / canvas / encoder) is injected
// with a default, so the resize maths and the quality ladder are testable
// under plain `node --test`.

export const GOAL_IMAGE_MAX_EDGE = 1200;
export const GOAL_IMAGE_TARGET_BYTES = 400 * 1024;
export const GOAL_IMAGE_HARD_MAX_BYTES = 900 * 1024;
export const GOAL_IMAGE_OUTPUT_TYPE = "image/webp";
export const GOAL_IMAGE_QUALITY_LADDER = [0.82, 0.72, 0.62, 0.52, 0.42];

/**
 * Scales a width/height pair down so the LONGEST edge is at most `maxEdge`,
 * preserving aspect ratio.  Never upscales.
 */
export function fitWithinMaxEdge(width, height, maxEdge = GOAL_IMAGE_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

async function defaultLoadBitmap(file) {
  if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap is unavailable in this environment");
  return createImageBitmap(file);
}

function defaultCreateCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") throw new Error("no canvas implementation is available");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function defaultEncode(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob produced no blob"))),
      type,
      quality,
    );
  });
}

async function defaultBlobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Compresses an image file to WebP, longest edge <= 1200px, aiming for
 * ~400 KB.
 *
 * Walks a quality ladder at full 1200px first and returns as soon as a
 * candidate lands under the target.  If nothing does, it repeats the ladder at
 * 75% of the edge before giving up and returning the smallest candidate it
 * produced — the caller (saveGoalImageAsset) is what enforces the 900 KB hard
 * cap, so a stubborn image surfaces as a clean "too_large" instead of a
 * Firestore invalid-argument.
 *
 * @returns {Promise<{bytes: Uint8Array, contentType: string, byteSize: number, width: number, height: number, quality: number}>}
 */
export async function compressGoalImage(file, options = {}) {
  const {
    maxEdge = GOAL_IMAGE_MAX_EDGE,
    targetBytes = GOAL_IMAGE_TARGET_BYTES,
    qualityLadder = GOAL_IMAGE_QUALITY_LADDER,
    outputType = GOAL_IMAGE_OUTPUT_TYPE,
    loadBitmap = defaultLoadBitmap,
    createCanvas = defaultCreateCanvas,
    encode = defaultEncode,
    blobToBytes = defaultBlobToBytes,
  } = options;

  if (!file) throw new Error("a file is required to compress the goal image");

  const bitmap = await loadBitmap(file);
  try {
    const edges = [maxEdge, Math.max(1, Math.round(maxEdge * 0.75))];
    let best = null;

    for (const edge of edges) {
      const { width, height } = fitWithinMaxEdge(bitmap.width, bitmap.height, edge);
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("could not acquire a 2d canvas context");
      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of qualityLadder) {
        const blob = await encode(canvas, outputType, quality);
        const bytes = await blobToBytes(blob);
        const candidate = {
          bytes,
          // Browsers that cannot encode WebP silently fall back to PNG, so
          // trust the blob's own type rather than what we asked for.
          contentType: blob.type || outputType,
          byteSize: bytes.byteLength,
          width,
          height,
          quality,
        };
        if (!best || candidate.byteSize < best.byteSize) best = candidate;
        if (candidate.byteSize <= targetBytes) return candidate;
      }
    }

    return best;
  } finally {
    if (typeof bitmap?.close === "function") bitmap.close();
  }
}
