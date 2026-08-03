// Pure, dependency-free helper for the dashboard goal image upload flow.
//
// Kept separate from goalImageStorage.js on purpose: goalImageStorage.js
// imports the Firebase SDK, which makes it hard to unit-test under plain
// `node --test` (it also pulls in import.meta.env).  This module has zero
// imports so the upload decision can be tested directly, and the actual
// Storage call is injected via the `upload` argument.

export const MAX_GOAL_IMAGE_BYTES = 850 * 1024;

/**
 * Resolves the dashboard goal image upload for a given profile.
 *
 * The caller is responsible for resolving the UID from the profile object —
 * SettingsPage passes `profile.id` (it does NOT have access to the parent's
 * `data` variable, so passing `data.profile.id` there would throw a
 * ReferenceError at runtime).
 *
 * @param {object} args
 * @param {string} args.profileId — the user's UID (from profile.id)
 * @param {File|Blob} args.file    — the selected image file
 * @param {function} args.upload   — (uid, blob) => Promise<url>; injected so
 *                                    callers/tests can supply Storage or a mock
 * @param {number} [args.maxBytes] — size cap; defaults to MAX_GOAL_IMAGE_BYTES
 * @returns {Promise<{ok: boolean, url?: string, skipped?: boolean, reason?: string}>}
 */
export async function uploadGoalImageForProfile({ profileId, file, upload, maxBytes = MAX_GOAL_IMAGE_BYTES }) {
  if (typeof upload !== "function") throw new Error("upload function is required");
  if (!file) return { ok: false, skipped: true };
  if (file.size > maxBytes) return { ok: false, reason: "too_large" };
  const url = await upload(profileId, file);
  return { ok: true, url };
}
