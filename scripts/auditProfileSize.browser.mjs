// ===========================================================================
// Profile Size Audit — Browser Console Snippet
// ===========================================================================
// INSTRUCTIONS:
// 1. Open the production app (https://claire-xiaoye.vercel.app) in Chrome
// 2. Make sure you're logged in
// 3. Open DevTools Console (F12)
// 4. Paste this ENTIRE script and press Enter
//
// This script is READ-ONLY — it never writes to Firestore.
//
// NOTE: JSON.stringify byte size != Firestore wire serialization size.
// This audit is for field-level ranking and proportion analysis only.
// ===========================================================================

(async () => {
  const FIREBASE_API_KEY = "AIzaSyDMVAhMiIxnEo3d97fd-FPeDwIm6SXRGJA";
  const FIREBASE_AUTH_DOMAIN = "claire-xiaoye.firebaseapp.com";
  const FIREBASE_PROJECT_ID = "claire-xiaoye";
  const FIREBASE_STORAGE_BUCKET = "claire-xiaoye.firebasestorage.app";
  const FIREBASE_MESSAGING_SENDER_ID = "760082118070";
  const FIREBASE_APP_ID = "1:760082118070:web:d52262fabb00894d0c3d17";

  const FIRESTORE_ERROR_SIZE = 1049892; // Prospective size of the failed write (not the current stored document)
  const FIRESTORE_MAX = 1048576; // 1 MiB

  // --- Helpers ---
  function jsonByteSize(value) {
    if (value === undefined || value === null) return 0;
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KiB";
    return (bytes / 1048576).toFixed(3) + " MiB";
  }

  function isDataUrl(v) {
    return typeof v === "string" && (v.startsWith("data:") || v.startsWith("base64,"));
  }

  function pad(str, len, alignRight = false) {
    str = String(str);
    if (str.length >= len) return str;
    const spaces = " ".repeat(len - str.length);
    return alignRight ? spaces + str : str + spaces;
  }

  // --- Step 1: Get Firebase auth state ---
  // Try to reuse the app's existing Firebase instance first
  let app = null;
  let auth = null;
  let user = null;

  try {
    const appMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
    const authMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
    const firestoreMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");

    const existingApps = appMod.getApps();
    if (existingApps.length > 0) {
      app = existingApps[0];
    } else {
      app = appMod.initializeApp({
        apiKey: FIREBASE_API_KEY,
        authDomain: FIREBASE_AUTH_DOMAIN,
        projectId: FIREBASE_PROJECT_ID,
        storageBucket: FIREBASE_STORAGE_BUCKET,
        messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
        appId: FIREBASE_APP_ID,
      });
    }
    auth = authMod.getAuth(app);

    // Wait for auth state (up to 5 seconds)
    user = await new Promise((resolve) => {
      let resolved = false;
      const unsub = authMod.onAuthStateChanged(auth, (u) => {
        if (!resolved) { resolved = true; unsub(); resolve(u); }
      });
      setTimeout(() => { if (!resolved) { resolved = true; unsub(); resolve(auth.currentUser); } }, 5000);
    });
  } catch (err) {
    console.error("Failed to initialize Firebase:", err);
    return;
  }

  if (!user) {
    console.error("Not authenticated. Please log into the app first, then re-run this script.");
    console.log("Tip: If the app is already logged in, the script may not be able to access the auth state.");
    console.log("Alternative: Run scripts/auditProfileSize.rest.mjs with your ID token.");
    return;
  }

  const uid = user.uid;
  const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
  const db = getFirestore(app);

  // --- Step 2: Read profile document ---
  console.log(`Fetching users/${uid} from Firestore...`);
  const profileSnap = await getDoc(doc(db, "users", uid));
  if (!profileSnap.exists()) {
    console.error(`Document users/${uid} does not exist.`);
    return;
  }

  const data = profileSnap.data();

  // --- Step 3: Compute field sizes ---
  const fieldSizes = [];
  let totalSize = 0;

  for (const [key, value] of Object.entries(data)) {
    const valueSize = jsonByteSize(value);
    const keySize = new TextEncoder().encode(key).length;
    const fieldTotal = valueSize + keySize + 6; // +6 for JSON structural overhead
    fieldSizes.push({ key, valueSize, keySize, fieldTotal, value });
    totalSize += fieldTotal;
  }

  fieldSizes.sort((a, b) => b.fieldTotal - a.fieldTotal);

  const delta = totalSize - FIRESTORE_ERROR_SIZE;

  // =========================================================================
  // OUTPUT
  // =========================================================================

  const line = "=".repeat(80);
  const dash = "-".repeat(80);

  console.log(line);
  console.log("  Firestore Profile Size Audit — Real Data");
  console.log(line);
  console.log();

  // --- Header ---
  console.log(`Failed write size (from error): ${FIRESTORE_ERROR_SIZE.toLocaleString()} bytes (${formatBytes(FIRESTORE_ERROR_SIZE)})`);
  console.log(`Audit estimated total (JSON.stringify UTF-8): ${totalSize.toLocaleString()} bytes (${formatBytes(totalSize)})`);
  console.log(`Difference: ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} bytes`);
  console.log(`Note: The failed write size is the prospective document that exceeded the 1 MiB limit.`);
  console.log(`      This audit GETs the last successfully saved document, so the two sizes`);
  console.log(`      are not expected to match. The difference is NOT solely JSON vs Firestore`);
  console.log(`      encoding — the documents themselves may have different field contents.`);
  console.log(`      Use this audit for field-level ranking and proportion analysis only.`);
  console.log();
  console.log(`UID: ${uid}`);
  console.log(`Email: ${user.email || "(not available)"}`);
  console.log();

  // --- Top-level fields ---
  console.log(dash);
  console.log("  Top-Level Fields (sorted by byte size)");
  console.log(dash);
  console.log();

  fieldSizes.forEach((f, i) => {
    const pct = ((f.fieldTotal / totalSize) * 100).toFixed(1);
    const type = Array.isArray(f.value)
      ? `array[${f.value.length}]`
      : f.value && typeof f.value === "object"
        ? `object[${Object.keys(f.value).length} keys]`
        : typeof f.value;
    const base64 = isDataUrl(f.value) ? " [BASE64/DATA-URL]" : "";
    console.log(`  ${pad(i + 1, 2)}. ${pad(f.key, 42)} ${pad(f.fieldTotal, 10, true)} bytes  ${pad(pct, 5, true)}%  ${type}${base64}`);
  });

  console.log();
  console.log(`  ${"─".repeat(76)}`);
  console.log(`  ${pad("TOTAL", 42)} ${pad(totalSize, 10, true)} bytes  ${formatBytes(totalSize)}`);
  console.log();

  // =========================================================================
  // scheduleAssistantDraftArchive
  // =========================================================================
  console.log(dash);
  console.log("  scheduleAssistantDraftArchive — Per-Entry Breakdown");
  console.log(dash);
  console.log();

  const archive = data.scheduleAssistantDraftArchive;
  if (!Array.isArray(archive) || archive.length === 0) {
    console.log("  Archive is empty or not an array.");
  } else {
    const archiveTotal = jsonByteSize(archive);
    console.log(`  Entry count: ${archive.length} (code caps at 14 via .slice(0, 14) — NOT infinite growth)`);
    console.log(`  Total size: ${archiveTotal.toLocaleString()} bytes (${formatBytes(archiveTotal)})`);
    console.log(`  Average per entry: ${Math.round(archiveTotal / archive.length).toLocaleString()} bytes (${formatBytes(Math.round(archiveTotal / archive.length))})`);
    console.log();

    const entrySizes = archive.map((entry, index) => {
      const date = entry?.targetDate || entry?.savedOn || `(entry ${index}, no date)`;
      const archivedOn = entry?.archivedOn || "";
      const size = jsonByteSize(entry);
      return { date, archivedOn, size, index };
    });

    const sorted = [...entrySizes].sort((a, b) => b.size - a.size);

    console.log(`  ${pad("Date", 14)} ${pad("Archived On", 14)} ${pad("Size (bytes)", 12, true)} ${pad("Readable", 10, true)}`);
    console.log(`  ${"─".repeat(14)} ${"─".repeat(14)} ${"─".repeat(12)} ${"─".repeat(10)}`);

    sorted.forEach((e) => {
      console.log(`  ${pad(e.date, 14)} ${pad(e.archivedOn, 14)} ${pad(e.size, 12, true)} ${pad(formatBytes(e.size), 10, true)}`);
    });

    console.log();
    console.log(`  Max:  ${sorted[0].date} — ${sorted[0].size.toLocaleString()} bytes (${formatBytes(sorted[0].size)})`);
    console.log(`  Min:  ${sorted[sorted.length - 1].date} — ${sorted[sorted.length - 1].size.toLocaleString()} bytes (${formatBytes(sorted[sorted.length - 1].size)})`);
    console.log(`  Avg:  ${Math.round(archiveTotal / archive.length).toLocaleString()} bytes (${formatBytes(Math.round(archiveTotal / archive.length))})`);
  }
  console.log();

  // =========================================================================
  // scheduleAssistantSettings
  // =========================================================================
  console.log(dash);
  console.log("  scheduleAssistantSettings — Sub-Field Breakdown");
  console.log(dash);
  console.log();
  console.log("  NOTE: normalizePlannerTemplates() is display-only (App.jsx:3673).");
  console.log("  Factory templates are NOT persisted in settings.dayTemplates.");
  console.log("  Only user-customized templates are stored in Firestore.");
  console.log();

  const settings = data.scheduleAssistantSettings || {};
  if (typeof settings !== "object" || Object.keys(settings).length === 0) {
    console.log("  scheduleAssistantSettings is empty or not an object.");
  } else {
    const settingsFields = [
      "mathTemplates",
      "englishTemplates",
      "dayTemplates",
      "commonTasks",
      "rhythmPresets",
      "studyTargetDefaults",
      "deletedDayTemplateSystemKeys",
      "defaultDayTemplateId",
      "defaultMathTemplateId",
      "defaultEnglishTemplateId",
    ];

    const knownTotal = settingsFields.reduce((sum, key) => sum + jsonByteSize(settings[key]), 0);
    const settingsTotal = jsonByteSize(settings);
    const otherFields = Object.keys(settings).filter((k) => !settingsFields.includes(k));
    const otherFieldSizes = otherFields.map((k) => ({ key: k, size: jsonByteSize(settings[k]) })).sort((a, b) => b.size - a.size);

    console.log(`  ${pad("Sub-field", 42)} ${pad("Size (bytes)", 12, true)} ${pad("Readable", 10, true)}`);
    console.log(`  ${"─".repeat(42)} ${"─".repeat(12)} ${"─".repeat(10)}`);

    for (const key of settingsFields) {
      const size = jsonByteSize(settings[key]);
      if (size > 0) {
        const count = Array.isArray(settings[key]) ? ` [${settings[key].length} items]` : (settings[key] && typeof settings[key] === "object" ? ` [${Object.keys(settings[key]).length} keys]` : "");
        console.log(`  ${pad(key, 42)} ${pad(size, 12, true)} ${pad(formatBytes(size), 10, true)}${count}`);
      }
    }

    if (otherFieldSizes.length > 0) {
      console.log(`  ${"─".repeat(42)} ${"─".repeat(12)} ${"─".repeat(10)}`);
      console.log(`  ${pad("(other sub-fields)", 42)}`);
      for (const f of otherFieldSizes) {
        if (f.size > 0) {
          console.log(`  ${pad("  " + f.key, 42)} ${pad(f.size, 12, true)} ${pad(formatBytes(f.size), 10, true)}`);
        }
      }
    }

    console.log(`  ${"─".repeat(42)} ${"─".repeat(12)} ${"─".repeat(10)}`);
    console.log(`  ${pad("TOTAL", 42)} ${pad(settingsTotal, 12, true)} ${pad(formatBytes(settingsTotal), 10, true)}`);
  }
  console.log();

  // =========================================================================
  // scheduleAssistantDraft
  // =========================================================================
  console.log(dash);
  console.log("  scheduleAssistantDraft — Top 10 Largest Child Fields");
  console.log(dash);
  console.log();

  const draft = data.scheduleAssistantDraft || {};
  if (typeof draft !== "object" || Object.keys(draft).length === 0) {
    console.log("  scheduleAssistantDraft is empty or not an object.");
  } else {
    const draftFields = Object.entries(draft).map(([key, value]) => ({
      key,
      size: jsonByteSize(value),
      type: Array.isArray(value)
        ? `array[${value.length}]`
        : value && typeof value === "object"
          ? `object[${Object.keys(value).length} keys]`
          : typeof value,
    }));
    draftFields.sort((a, b) => b.size - a.size);

    console.log(`  ${pad("#", 2)} ${pad("Child Field", 36)} ${pad("Size (bytes)", 12, true)} ${pad("Readable", 10, true)}  Type`);
    console.log(`  ${"─".repeat(2)} ${"─".repeat(36)} ${"─".repeat(12)} ${"─".repeat(10)}  ${"─".repeat(20)}`);

    draftFields.slice(0, 10).forEach((f, i) => {
      console.log(`  ${pad(i + 1, 2)} ${pad(f.key, 36)} ${pad(f.size, 12, true)} ${pad(formatBytes(f.size), 10, true)}  ${f.type}`);
    });

    const draftTotal = jsonByteSize(draft);
    console.log();
    console.log(`  Draft total: ${draftTotal.toLocaleString()} bytes (${formatBytes(draftTotal)})`);
  }
  console.log();

  // =========================================================================
  // scheduleSegmentGoals
  // =========================================================================
  console.log(dash);
  console.log("  scheduleSegmentGoals — Date Count & Size");
  console.log(dash);
  console.log();

  const segmentGoals = data.scheduleSegmentGoals || {};
  if (typeof segmentGoals !== "object" || Object.keys(segmentGoals).length === 0) {
    console.log("  scheduleSegmentGoals is empty or not an object.");
  } else {
    const goalKeys = Object.keys(segmentGoals);
    const goalTotal = jsonByteSize(segmentGoals);

    console.log(`  Date count: ${goalKeys.length}`);
    console.log(`  Total size: ${goalTotal.toLocaleString()} bytes (${formatBytes(goalTotal)})`);
    console.log(`  Average per date: ${Math.round(goalTotal / goalKeys.length).toLocaleString()} bytes (${formatBytes(Math.round(goalTotal / goalKeys.length))})`);

    const goalSizes = goalKeys.map((date) => ({ date, size: jsonByteSize(segmentGoals[date]) })).sort((a, b) => b.size - a.size);
    console.log();
    console.log(`  ${pad("Date", 14)} ${pad("Size (bytes)", 12, true)} ${pad("Readable", 10, true)}`);
    console.log(`  ${"─".repeat(14)} ${"─".repeat(12)} ${"─".repeat(10)}`);
    for (const g of goalSizes) {
      console.log(`  ${pad(g.date, 14)} ${pad(g.size, 12, true)} ${pad(formatBytes(g.size), 10, true)}`);
    }
  }
  console.log();

  // =========================================================================
  // dashboardGoalImage
  // =========================================================================
  console.log(dash);
  console.log("  dashboardGoalImage");
  console.log(dash);
  console.log();

  const goalImage = data.dashboardGoalImage;
  if (!goalImage) {
    console.log("  dashboardGoalImage is empty/null/undefined.");
  } else {
    const size = new TextEncoder().encode(String(goalImage)).length;
    const dataUrl = isDataUrl(goalImage);
    console.log(`  Byte size: ${size.toLocaleString()} bytes (${formatBytes(size)})`);
    console.log(`  Is data URL / base64: ${dataUrl ? "YES" : "NO"}`);
    if (dataUrl) {
      console.log(`  Prefix: ${goalImage.substring(0, 80)}...`);
    } else if (typeof goalImage === "string") {
      console.log(`  Type: string (length ${goalImage.length})`);
      console.log(`  Preview: ${goalImage.substring(0, 80)}...`);
    } else {
      console.log(`  Type: ${typeof goalImage}`);
    }
  }
  console.log();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(line);
  console.log("  Summary");
  console.log(line);
  console.log();
  console.log(`  Failed write size:         ${FIRESTORE_ERROR_SIZE.toLocaleString()} bytes (${formatBytes(FIRESTORE_ERROR_SIZE)})`);
  console.log(`  JSON.stringify estimate:   ${totalSize.toLocaleString()} bytes (${formatBytes(totalSize)})`);
  console.log(`  Difference:                ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} bytes`);
  console.log();
  console.log(`  Top 5 fields by size:`);
  fieldSizes.slice(0, 5).forEach((f, i) => {
    const pct = ((f.fieldTotal / totalSize) * 100).toFixed(1);
    console.log(`    ${i + 1}. ${pad(f.key, 40)} ${pad(f.fieldTotal, 10, true)} bytes  ${pad(pct, 5, true)}%`);
  });
  console.log();
  console.log(`  NOTE: JSON.stringify byte size != Firestore wire serialization size.`);
  console.log(`  Firestore's internal format includes type tags, field name encoding,`);
  console.log(`  and protocol buffer overhead not captured by JSON.stringify.`);
  console.log(`  Use these numbers for field-level ranking and proportion analysis only.`);
  console.log();

  // Make data available for programmatic access
  window.__profileAudit = { totalSize, firestoreErrorSize: FIRESTORE_ERROR_SIZE, delta, fieldSizes, data };
  console.log("Full audit data available as window.__profileAudit");
})();
