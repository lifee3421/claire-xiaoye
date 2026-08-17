// ===========================================================================
// Profile Size Audit — Node.js via Firestore REST API
// ===========================================================================
// Usage:
//   1. Open the production app (https://claire-xiaoye.vercel.app) in browser
//   2. Open DevTools Console, run:
//      (await firebase.auth().currentUser.getIdToken()).slice(0,20)  // verify
//      await firebase.auth().currentUser.getIdToken()                 // copy full
//   3. If the above doesn't work (v9 modular), run this instead:
//      import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js")
//        .then(m => m.getApps()[0]).then(app =>
//          import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js")
//            .then(m => m.getAuth(app).currentUser.getIdToken())
//        ).then(t => console.log(t))
//   4. Copy the token, then run:
//      node scripts/auditProfileSize.rest.mjs --token=<YOUR_ID_TOKEN>
//      node scripts/auditProfileSize.rest.mjs --token=<YOUR_ID_TOKEN> --uid=<UID>
//
// This script is READ-ONLY — it never writes to Firestore.
// ===========================================================================

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--?/, "").split("=");
    return [k, v.join("=") || true];
  })
);

const ID_TOKEN = args.token;
const UID = args.uid || "";

if (!ID_TOKEN) {
  console.error("Usage: node scripts/auditProfileSize.rest.mjs --token=<FIREBASE_ID_TOKEN> [--uid=<UID>]");
  console.error("");
  console.error("Get your ID token from the browser console:");
  console.error("  (await getAuth(getApps()[0]).currentUser.getIdToken())");
  process.exit(1);
}

const PROJECT_ID = "claire-xiaoye";
const FIRESTORE_ERROR_SIZE = 1049892; // Prospective size of the failed write (not the current stored document)
const FIRESTORE_MAX = 1048576; // 1 MiB

// --- Firestore REST API value unwrapper ---
function unwrapValue(field) {
  if (!field || typeof field !== "object") return field;
  if (field.nullValue !== undefined) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.integerValue !== undefined) return parseInt(field.integerValue, 10);
  if (field.doubleValue !== undefined) return parseFloat(field.doubleValue);
  if (field.timestampValue !== undefined) return field.timestampValue;
  if (field.referenceValue !== undefined) return field.referenceValue;
  if (field.bytesValue !== undefined) return field.bytesValue;
  if (field.geoPointValue !== undefined) return field.geoPointValue;
  if (field.arrayValue !== undefined) {
    return (field.arrayValue.values || []).map(unwrapValue);
  }
  if (field.mapValue !== undefined) {
    const obj = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) {
      obj[k] = unwrapValue(v);
    }
    return obj;
  }
  return field;
}

// --- Helpers ---
function jsonByteSize(value) {
  if (value === undefined || value === null) return 0;
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / 1048576).toFixed(3) + " MiB";
}

function isDataUrl(v) {
  return typeof v === "string" && (v.startsWith("data:") || v.startsWith("base64,"));
}

// --- Main ---
async function main() {
  // Step 1: If no UID provided, try to get it from the token
  let uid = UID;
  if (!uid) {
    try {
      const payload = JSON.parse(Buffer.from(ID_TOKEN.split(".")[1], "base64").toString("utf8"));
      uid = payload.user_id || payload.sub || "";
      if (!uid) {
        console.error("Could not extract UID from token. Please provide --uid=<UID>");
        process.exit(1);
      }
      console.log(`Extracted UID from token: ${uid}`);
    } catch {
      console.error("Could not decode token. Please provide --uid=<UID>");
      process.exit(1);
    }
  }

  // Step 2: Read the profile document via Firestore REST API
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;

  console.log(`\nFetching: ${url}\n`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ID_TOKEN}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Firestore REST API error: ${res.status} ${res.statusText}`);
    console.error(text);
    process.exit(1);
  }

  const doc = await res.json();

  // Step 3: Unwrap Firestore types to plain JS objects
  const data = {};
  for (const [key, field] of Object.entries(doc.fields || {})) {
    data[key] = unwrapValue(field);
  }

  // Step 4: Compute field sizes
  const fieldSizes = [];
  let totalSize = 0;

  for (const [key, value] of Object.entries(data)) {
    const valueSize = jsonByteSize(value);
    const keySize = Buffer.byteLength(key, "utf8");
    // Approximate Firestore field overhead: key + type wrapper overhead
    const fieldTotal = valueSize + keySize + 6; // +6 for JSON structural overhead
    fieldSizes.push({ key, valueSize, keySize, fieldTotal, value });
    totalSize += fieldTotal;
  }

  fieldSizes.sort((a, b) => b.fieldTotal - a.fieldTotal);

  // =========================================================================
  // OUTPUT
  // =========================================================================

  console.log("=".repeat(80));
  console.log("  Firestore Profile Size Audit — Real Data");
  console.log("=".repeat(80));
  console.log();

  // --- Header ---
  console.log(`Failed write size (from error): ${FIRESTORE_ERROR_SIZE.toLocaleString()} bytes (${formatBytes(FIRESTORE_ERROR_SIZE)})`);
  console.log(`Audit estimated total (JSON.stringify UTF-8): ${totalSize.toLocaleString()} bytes (${formatBytes(totalSize)})`);

  const delta = totalSize - FIRESTORE_ERROR_SIZE;
  console.log(`Difference: ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} bytes`);
  console.log(`Note: The failed write size is the prospective document that exceeded the 1 MiB limit.`);
  console.log(`      This audit GETs the last successfully saved document, so the two sizes`);
  console.log(`      are not expected to match. The difference is NOT solely JSON vs Firestore`);
  console.log(`      encoding — the documents themselves may have different field contents.`);
  console.log(`      Use this audit for field-level ranking and proportion analysis only.`);
  console.log();

  console.log(`UID: ${uid}`);
  console.log(`Document name: ${doc.name || `projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`}`);
  console.log();

  // --- Top-level fields ---
  console.log("-".repeat(80));
  console.log("  Top-Level Fields (sorted by byte size)");
  console.log("-".repeat(80));
  console.log();

  fieldSizes.forEach((f, i) => {
    const pct = ((f.fieldTotal / totalSize) * 100).toFixed(1);
    const type = Array.isArray(f.value)
      ? `array[${f.value.length}]`
      : f.value && typeof f.value === "object"
        ? `object[${Object.keys(f.value).length} keys]`
        : typeof f.value;
    const base64 = isDataUrl(f.value) ? " [BASE64/DATA-URL]" : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${f.key.padEnd(42)} ${String(f.fieldTotal).padStart(10)} bytes  ${pct.padStart(5)}%  ${type}${base64}`);
  });

  console.log();
  console.log(`  ${"─".repeat(76)}`);
  console.log(`  ${"TOTAL".padEnd(42)} ${String(totalSize).padStart(10)} bytes  ${formatBytes(totalSize)}`);
  console.log();

  // =========================================================================
  // scheduleAssistantDraftArchive
  // =========================================================================
  console.log("-".repeat(80));
  console.log("  scheduleAssistantDraftArchive — Per-Entry Breakdown");
  console.log("-".repeat(80));
  console.log();

  const archive = data.scheduleAssistantDraftArchive;
  if (!Array.isArray(archive) || archive.length === 0) {
    console.log("  Archive is empty or not an array.");
  } else {
    const archiveTotal = jsonByteSize(archive);
    console.log(`  Entry count: ${archive.length} (code caps at 14 via .slice(0, 14))`);
    console.log(`  Total size: ${archiveTotal.toLocaleString()} bytes (${formatBytes(archiveTotal)})`);
    console.log(`  Average per entry: ${Math.round(archiveTotal / archive.length).toLocaleString()} bytes (${formatBytes(Math.round(archiveTotal / archive.length))})`);
    console.log();

    const entrySizes = archive.map((entry, index) => {
      const date = entry?.targetDate || entry?.savedOn || `(entry ${index}, no date)`;
      const archivedOn = entry?.archivedOn || "";
      const size = jsonByteSize(entry);
      return { date, archivedOn, size, index };
    });

    // Sort by size descending for display
    const sorted = [...entrySizes].sort((a, b) => b.size - a.size);

    console.log(`  ${"Date".padEnd(14)} ${"Archived On".padEnd(14)} ${"Size (bytes)".padStart(12)} ${"Readable".padStart(10)}`);
    console.log(`  ${"─".repeat(14)} ${"─".repeat(14)} ${"─".repeat(12)} ${"─".repeat(10)}`);

    sorted.forEach((e) => {
      console.log(`  ${e.date.padEnd(14)} ${e.archivedOn.padEnd(14)} ${String(e.size).padStart(12)} ${formatBytes(e.size).padStart(10)}`);
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
  console.log("-".repeat(80));
  console.log("  scheduleAssistantSettings — Sub-Field Breakdown");
  console.log("-".repeat(80));
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
    const otherSize = settingsTotal - knownTotal;

    // Also list any other sub-fields not in the known list
    const otherFields = Object.keys(settings).filter((k) => !settingsFields.includes(k));
    const otherFieldSizes = otherFields.map((k) => ({ key: k, size: jsonByteSize(settings[k]) })).sort((a, b) => b.size - a.size);

    console.log(`  ${"Sub-field".padEnd(42)} ${"Size (bytes)".padStart(12)} ${"Readable".padStart(10)}`);
    console.log(`  ${"─".repeat(42)} ${"─".repeat(12)} ${"─".repeat(10)}`);

    // Known fields
    for (const key of settingsFields) {
      const size = jsonByteSize(settings[key]);
      if (size > 0) {
        const count = Array.isArray(settings[key]) ? ` [${settings[key].length} items]` : (settings[key] && typeof settings[key] === "object" ? ` [${Object.keys(settings[key]).length} keys]` : "");
        console.log(`  ${key.padEnd(42)} ${String(size).padStart(12)} ${formatBytes(size).padStart(10)}${count}`);
      }
    }

    // Other fields
    if (otherFieldSizes.length > 0) {
      console.log(`  ${"─".repeat(42)} ${"─".repeat(12)} ${"─".repeat(10)}`);
      console.log(`  ${"(other sub-fields)".padEnd(42)}`);
      for (const f of otherFieldSizes) {
        if (f.size > 0) {
          console.log(`  ${("  " + f.key).padEnd(42)} ${String(f.size).padStart(12)} ${formatBytes(f.size).padStart(10)}`);
        }
      }
    }

    console.log(`  ${"─".repeat(42)} ${"─".repeat(12)} ${"─".repeat(10)}`);
    console.log(`  ${"TOTAL".padEnd(42)} ${String(settingsTotal).padStart(12)} ${formatBytes(settingsTotal).padStart(10)}`);
  }
  console.log();

  // =========================================================================
  // scheduleAssistantDraft
  // =========================================================================
  console.log("-".repeat(80));
  console.log("  scheduleAssistantDraft — Top 10 Largest Child Fields");
  console.log("-".repeat(80));
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

    console.log(`  ${"#".padStart(2)} ${"Child Field".padEnd(36)} ${"Size (bytes)".padStart(12)} ${"Readable".padStart(10)}  Type`);
    console.log(`  ${"─".repeat(2)} ${"─".repeat(36)} ${"─".repeat(12)} ${"─".repeat(10)}  ${"─".repeat(20)}`);

    draftFields.slice(0, 10).forEach((f, i) => {
      console.log(`  ${String(i + 1).padStart(2)} ${f.key.padEnd(36)} ${String(f.size).padStart(12)} ${formatBytes(f.size).padStart(10)}  ${f.type}`);
    });

    const draftTotal = jsonByteSize(draft);
    console.log();
    console.log(`  Draft total: ${draftTotal.toLocaleString()} bytes (${formatBytes(draftTotal)})`);
  }
  console.log();

  // =========================================================================
  // scheduleSegmentGoals
  // =========================================================================
  console.log("-".repeat(80));
  console.log("  scheduleSegmentGoals — Date Count & Size");
  console.log("-".repeat(80));
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

    // Per-date breakdown
    const goalSizes = goalKeys.map((date) => ({ date, size: jsonByteSize(segmentGoals[date]) })).sort((a, b) => b.size - a.size);
    console.log();
    console.log(`  ${"Date".padEnd(14)} ${"Size (bytes)".padStart(12)} ${"Readable".padStart(10)}`);
    console.log(`  ${"─".repeat(14)} ${"─".repeat(12)} ${"─".repeat(10)}`);
    for (const g of goalSizes) {
      console.log(`  ${g.date.padEnd(14)} ${String(g.size).padStart(12)} ${formatBytes(g.size).padStart(10)}`);
    }
  }
  console.log();

  // =========================================================================
  // dashboardGoalImage
  // =========================================================================
  console.log("-".repeat(80));
  console.log("  dashboardGoalImage");
  console.log("-".repeat(80));
  console.log();

  const goalImage = data.dashboardGoalImage;
  if (!goalImage) {
    console.log("  dashboardGoalImage is empty/null/undefined.");
  } else {
    const size = Buffer.byteLength(String(goalImage), "utf8");
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
  console.log("=".repeat(80));
  console.log("  Summary");
  console.log("=".repeat(80));
  console.log();
  console.log(`  Failed write size:         ${FIRESTORE_ERROR_SIZE.toLocaleString()} bytes (${formatBytes(FIRESTORE_ERROR_SIZE)})`);
  console.log(`  JSON.stringify estimate:   ${totalSize.toLocaleString()} bytes (${formatBytes(totalSize)})`);
  console.log(`  Difference:                ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} bytes`);
  console.log();
  console.log(`  Top 5 fields by size:`);
  fieldSizes.slice(0, 5).forEach((f, i) => {
    const pct = ((f.fieldTotal / totalSize) * 100).toFixed(1);
    console.log(`    ${i + 1}. ${f.key.padEnd(40)} ${String(f.fieldTotal).padStart(10)} bytes  ${pct.padStart(5)}%`);
  });
  console.log();
  console.log(`  NOTE: JSON.stringify byte size != Firestore wire serialization size.`);
  console.log(`  Firestore's internal format includes type tags, field name encoding,`);
  console.log(`  and protocol buffer overhead not captured by JSON.stringify.`);
  console.log(`  Use these numbers for field-level ranking and proportion analysis only.`);
  console.log();

  // Write full data to file for reference
  const fs = await import("fs");
  const auditData = {
    timestamp: new Date().toISOString(),
    uid,
    firestoreErrorSize: FIRESTORE_ERROR_SIZE,
    jsonEstimateSize: totalSize,
    difference: delta,
    fields: fieldSizes.map((f) => ({
      key: f.key,
      fieldTotal: f.fieldTotal,
      valueSize: f.valueSize,
      keySize: f.keySize,
      percentage: (f.fieldTotal / totalSize) * 100,
    })),
    archive: Array.isArray(archive) ? {
      entryCount: archive.length,
      totalSize: jsonByteSize(archive),
      entries: archive.map((e) => ({
        date: e?.targetDate || e?.savedOn || "",
        archivedOn: e?.archivedOn || "",
        size: jsonByteSize(e),
      })),
    } : null,
  };
  fs.writeFileSync("audit-profile-result.json", JSON.stringify(auditData, null, 2));
  console.log(`  Full audit data written to: audit-profile-result.json`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
