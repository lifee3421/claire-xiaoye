/**
 * One-time idempotent migration: moves the legacy inline base64 `dashboardGoalImage`
 * (stored on the top-level users/{uid} profile document) into a dedicated Firestore
 * sub-document `users/{uid}/assets/dashboardGoalImage` holding the raw bytes as a
 * Firestore `Bytes` value, then repoints the profile at a lightweight
 * `dashboardGoalImageRef` and clears the old base64.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous attempt moved the image to Cloud Storage, but since 2026-02-03 Cloud
 * Storage for Firebase requires the Blaze plan and this project stays on Spark. The
 * bytes now live inside Firestore instead (see src/services/goalImageAsset.js, the
 * "A1" model). This script back-fills every production profile that still carries the
 * old inline base64 so the field can be retired without losing anyone's image.
 *
 * SAFETY GUARANTEES (mirrors the live app's save path)
 * ------------------------------------------------
 * 1. Idempotent: skips when dashboardGoalImage is empty, or when a valid
 *    dashboardGoalImageRef already exists AND the legacy base64 has been cleared.
 *    Re-running after a partial failure always makes progress and never double-writes
 *    in a destructive way.
 * 2. Writes the asset FIRST, getDoc read-back verifies (doc exists, byteSize matches,
 *    contentType matches, stored Bytes length matches) and ONLY THEN merges the profile
 *    pointer + clears the base64.  ANY failure before that final merge leaves the old
 *    base64 completely untouched, so a user's image can never disappear.
 * 3. Does NOT re-compress: the ~663.8 KB base64 decodes to ~500 KB binary, which fits
 *    comfortably inside a single 1 MiB Firestore document.  The original MIME is kept.
 *
 * REUSES A1 SCHEMA
 * ----------------
 * The pointer built here (buildGoalImageProfileRef / buildGoalImageProfilePatch below)
 * MUST stay byte-for-byte in sync with src/services/goalImageAsset.js so production
 * profiles and the live app write path agree on one format.
 *
 * USAGE
 * -----
 * Paste this entire file into the browser DevTools Console while logged in to the
 * production app (https://claire-xiaoye.vercel.app).  No Firebase CLI, no Admin SDK,
 * no service-account credentials required — it bootstraps from the public web config
 * and waits for your existing auth session to restore.
 */

// --- Production public config (safe to embed: this is the client-side web config) ---
const FIREBASE_API_KEY = "AIzaSyDMVAhMiIxnEo3d97fd-FPeDwIm6SXRGJA";
const FIREBASE_AUTH_DOMAIN = "claire-xiaoye.firebaseapp.com";
const FIREBASE_PROJECT_ID = "claire-xiaoye";
const FIREBASE_MESSAGING_SENDER_ID = "760082118070";
const FIREBASE_APP_ID = "1:760082118070:web:d52262fabb00894d0c3d17";

// Canonical goal-image pointer builders — KEEP IN SYNC WITH src/services/goalImageAsset.js.
// (Local copies because this script runs from the Console and cannot import the Vite module.)
function buildGoalImageProfileRef({ contentType, byteSize, version }) {
  return {
    kind: "firestore-asset",
    path: "assets/dashboardGoalImage",
    contentType: contentType || "image/webp",
    byteSize: Number(byteSize) || 0,
    version: String(version || ""),
  };
}
function buildGoalImageProfilePatch(ref) {
  return { dashboardGoalImageRef: ref || null, dashboardGoalImage: "" };
}

(async function migrateGoalImageToFirestoreAsset() {
  // --- Firebase bootstrap (robust, mirrors the prior Storage migration script) ---
  //
  // The CDN ESM build of firebase-app is a SEPARATE module instance from the one the
  // Vite bundle uses, so getApps() here will NOT see the app already initialized by the
  // page. We therefore: reuse the page app if getApps() happens to be non-empty,
  // otherwise initializeApp() ourselves with the public config, and ALWAYS wait for the
  // auth state via onAuthStateChanged before touching any data. Never read
  // auth.currentUser synchronously.
  const appMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
  const firestoreMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

  let app;
  const existingApps = appMod.getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
  } else {
    app = appMod.initializeApp({
      apiKey: FIREBASE_API_KEY,
      authDomain: FIREBASE_AUTH_DOMAIN,
      projectId: FIREBASE_PROJECT_ID,
      messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
      appId: FIREBASE_APP_ID,
    });
  }
  const auth = authMod.getAuth(app);

  // Wait for the auth state to restore (up to 5s) before using the user.
  const user = await new Promise((resolve) => {
    let resolved = false;
    const unsub = authMod.onAuthStateChanged(auth, (u) => {
      if (!resolved) { resolved = true; unsub(); resolve(u); }
    });
    setTimeout(() => { if (!resolved) { resolved = true; unsub(); resolve(auth.currentUser); } }, 5000);
  });
  if (!user) {
    console.error("Not logged in. Please log in to the app first, then re-run this script.");
    return;
  }
  const uid = user.uid;

  const db = firestoreMod.getFirestore(app);
  const { doc, getDoc, setDoc, serverTimestamp, Bytes } = firestoreMod;

  const profileRef = doc(db, "users", uid);
  const assetRef = doc(db, "users", uid, "assets", "dashboardGoalImage");

  // --- Read current profile ---
  const snap = await getDoc(profileRef);
  if (!snap.exists()) { console.error("Profile document not found"); return; }
  const profile = snap.data() || {};

  const current = profile.dashboardGoalImage || "";
  const existingRef = profile.dashboardGoalImageRef;
  const hasValidRef = Boolean(
    existingRef && typeof existingRef === "object" && existingRef.kind === "firestore-asset" && existingRef.path,
  );

  // --- Idempotent skip ---
  if (hasValidRef && !current) {
    console.log("[migrate] Already migrated (valid ref present, base64 cleared) — nothing to do.");
    return;
  }
  if (!current) {
    console.log("[migrate] dashboardGoalImage is empty — nothing to migrate.");
    return;
  }
  if (!current.startsWith("data:")) {
    console.log("[migrate] dashboardGoalImage is not a base64 data URL — skipping.");
    return;
  }

  // --- Decode the data URL into raw bytes, preserving the original MIME ---
  const parsed = /^data:([^;]*)(;base64)?,(.*)$/s.exec(current);
  if (!parsed || !parsed[2]) {
    console.error("[migrate] dashboardGoalImage is not a base64 data URL — aborting to avoid data loss.");
    return;
  }
  const mime = parsed[1] || "image/png";
  const binary = atob(parsed[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  console.log(`[migrate] Decoded base64 → ${bytes.byteLength} bytes (${mime}). Writing asset...`);

  // --- Write the asset sub-document (full replace, no merge) ---
  const assetPayload = {
    bytes: Bytes.fromUint8Array(bytes),
    contentType: mime,
    byteSize: bytes.byteLength,
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(assetRef, assetPayload);
  } catch (error) {
    console.error("[migrate] Asset write FAILED — old base64 image preserved in profile:", error);
    return;
  }

  // --- Read back and verify before touching the profile ---
  try {
    const verify = await getDoc(assetRef);
    if (!verify.exists()) throw new Error("asset document does not exist after write");
    const data = verify.data() || {};
    if (Number(data.byteSize) !== bytes.byteLength) {
      throw new Error(`byteSize mismatch: wrote ${bytes.byteLength}, read ${data.byteSize}`);
    }
    if (data.contentType !== mime) {
      throw new Error(`contentType mismatch: wrote ${mime}, read ${data.contentType}`);
    }
    const storedBytes = data.bytes instanceof Uint8Array
      ? data.bytes
      : (data.bytes && typeof data.bytes.toUint8Array === "function" ? data.bytes.toUint8Array() : null);
    if (!storedBytes || storedBytes.byteLength !== bytes.byteLength) {
      throw new Error("stored Bytes length mismatch");
    }
    console.log("[migrate] Read-back verified (exists, byteSize, contentType, Bytes length all match).");
  } catch (error) {
    console.error("[migrate] Read-back verification FAILED — old base64 image preserved:", error);
    return;
  }

  // --- ONLY NOW repoint the profile and clear the legacy base64 ---
  // This is the single point at which the profile stops carrying the base64, and it
  // runs only after the asset is proven readable. A failure here leaves the asset
  // document in place and the base64 intact, so a re-run finishes the job safely.
  const version = new Date().toISOString();
  const ref = buildGoalImageProfileRef({ contentType: mime, byteSize: bytes.byteLength, version });
  const patch = buildGoalImageProfilePatch(ref);
  try {
    await setDoc(profileRef, patch, { merge: true });
    console.log("[migrate] Profile repointed to asset and base64 cleared. Migration complete!");
    console.log(`[migrate] Old size: ${current.length} bytes (base64); new ref: ${JSON.stringify(ref)}`);
  } catch (error) {
    console.error("[migrate] Profile merge FAILED — asset written but base64 NOT cleared. Re-run to finish:", error);
  }
})();
