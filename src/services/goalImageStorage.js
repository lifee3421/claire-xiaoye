import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "./firebase.js";

/**
 * Uploads a dashboard goal image to Firebase Storage and returns the
 * download URL.  The image is stored under users/{uid}/dashboardGoalImage/
 * so it is naturally scoped per-user.
 *
 * @param {string} uid  — current user's UID
 * @param {Blob|File} blob — the image blob to upload
 * @returns {Promise<string>} — resolved download URL (https)
 */
export async function uploadGoalImage(uid, blob) {
  if (!storage) throw new Error("Firebase Storage is not initialized");
  if (!uid) throw new Error("UID is required to upload goal image");
  if (!blob) throw new Error("Image blob is required");

  const ext = blob.type === "image/jpeg" ? ".jpg"
    : blob.type === "image/webp" ? ".webp"
    : blob.type === "image/gif" ? ".gif"
    : ".png";
  const path = `users/${uid}/dashboardGoalImage/${Date.now()}${ext}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, blob, { contentType: blob.type || "image/png" });
  const url = await getDownloadURL(storageRef);

  // Verify the URL is fetchable before returning it — this catches
  // Storage rules / CORS issues early instead of silently storing a
  // broken URL in the profile document.
  const probe = await fetch(url, { method: "GET", mode: "cors" });
  if (!probe.ok) throw new Error(`Storage URL verification failed: ${probe.status}`);

  return url;
}

/**
 * Converts a base64 data URL to a Blob.
 * Used by the one-time migration from profile-embedded base64 → Storage URL.
 */
export function dataUrlToBlob(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const [meta, base64] = dataUrl.split(",");
  if (!base64) return null;
  const mimeMatch = /data:([^;]+)/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Returns true if the value looks like a base64 data URL (the legacy
 * storage format for dashboardGoalImage).
 */
export function isBase64DataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

/**
 * Returns true if the value looks like a Storage download URL (the new
 * format) or any other HTTP(S) URL.
 */
export function isStorageUrl(value) {
  return typeof value === "string" && (value.startsWith("https://") || value.startsWith("http://")) && !value.startsWith("data:");
}
