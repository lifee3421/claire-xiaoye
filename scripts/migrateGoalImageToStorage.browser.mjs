/**
 * One-time idempotent migration: moves dashboardGoalImage from base64 data URL
 * (stored inline in the Firestore profile document) to Firebase Storage,
 * replacing the profile field with a download URL.
 *
 * Safety guarantees:
 * 1. If dashboardGoalImage is already a URL (not base64), does nothing.
 * 2. Uploads to Storage FIRST, verifies the URL is fetchable, THEN updates
 *    the profile document.  If upload or verification fails, the old base64
 *    is left untouched.
 * 3. Can be run multiple times — if the profile already has a URL, it skips.
 *
 * Usage: paste this entire file into the browser Console on
 * https://claire-xiaoye.vercel.app while logged in.
 */
(async function migrateGoalImageToStorage() {
  // --- Firebase bootstrap (reuse the app already initialized by the page) ---
  const { getApps } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
  const app = getApps()[0];
  if (!app) { console.error("Firebase app not initialized"); return; }

  const { getAuth } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
  const { getFirestore, doc, getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js");

  const auth = getAuth(app);
  const user = auth.currentUser;
  if (!user) { console.error("Not logged in"); return; }
  const uid = user.uid;

  const db = getFirestore(app);
  const storage = getStorage(app);

  // --- Read current profile ---
  const profileRef = doc(db, "users", uid);
  const snap = await getDoc(profileRef);
  if (!snap.exists()) { console.error("Profile document not found"); return; }
  const profile = snap.data();

  const currentValue = profile.dashboardGoalImage || "";
  if (!currentValue) { console.log("dashboardGoalImage is empty — nothing to migrate"); return; }
  if (!currentValue.startsWith("data:")) { console.log("dashboardGoalImage is already a URL — migration already done:", currentValue.slice(0, 80) + "..."); return; }

  // --- It's a base64 data URL — proceed with migration ---
  console.log(`[migrate] Found base64 image (${currentValue.length} bytes). Starting migration...`);

  // Parse the data URL
  const [meta, base64] = currentValue.split(",");
  if (!base64) { console.error("Invalid data URL format"); return; }
  const mimeMatch = /data:([^;]+)/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";

  // Convert to blob
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  console.log(`[migrate] Converted to blob: ${blob.size} bytes (${mime})`);

  // Upload to Storage
  const storagePath = `users/${uid}/dashboard/goal-image`;
  const storageRef = ref(storage, storagePath);
  console.log(`[migrate] Uploading to gs://${storageRef.bucket}/${storagePath}...`);

  try {
    await uploadBytes(storageRef, blob, { contentType: mime });
    console.log("[migrate] Upload complete. Getting download URL...");
  } catch (error) {
    console.error("[migrate] Upload FAILED — old base64 image is preserved in profile:", error);
    return;
  }

  // Get download URL
  let url;
  try {
    url = await getDownloadURL(storageRef);
    console.log(`[migrate] Download URL: ${url}`);
  } catch (error) {
    console.error("[migrate] getDownloadURL FAILED — old base64 image is preserved:", error);
    return;
  }

  // Verify the URL is fetchable
  try {
    const probe = await fetch(url, { method: "GET", mode: "cors" });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
    console.log("[migrate] URL verification passed (fetch OK).");
  } catch (error) {
    console.error("[migrate] URL verification FAILED — old base64 image is preserved:", error);
    return;
  }

  // Update the profile document — replace base64 with URL
  try {
    await setDoc(profileRef, { dashboardGoalImage: url, updatedAt: new Date().toISOString() }, { merge: true });
    console.log("[migrate] Profile document updated. Migration complete!");
    console.log(`[migrate] Old size: ${currentValue.length} bytes (base64)`);
    console.log(`[migrate] New size: ${url.length} bytes (URL)`);
    console.log(`[migrate] Space saved: ~${(currentValue.length - url.length).toLocaleString()} bytes`);
  } catch (error) {
    console.error("[migrate] Profile update FAILED — the image was uploaded to Storage but the profile still has base64. You can retry this script.", error);
    console.log(`[migrate] The uploaded Storage path is: ${storagePath}`);
    console.log(`[migrate] The download URL is: ${url}`);
  }
})();
