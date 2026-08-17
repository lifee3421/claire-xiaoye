// Profile Size Audit — one-time diagnostic script.
//
// Reads users/{uid} from Firestore (Admin SDK, read-only) and calculates
// the UTF-8 byte size of every top-level field. Does NOT write anything.
//
// Usage:
//   1. Set GOOGLE_APPLICATION_CREDENTIALS to your service account key JSON.
//   2. node scripts/auditProfileSize.mjs --uid=<your real uid>
//
// Output:
//   - Total estimated profile byte size (vs Firestore 1 MiB limit)
//   - Top 10 largest fields (byte size + percentage)
//   - scheduleAssistantDraftArchive per-date breakdown
//   - dashboardGoalImage base64 / data URL flag

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const FIRESTORE_MAX_DOC_SIZE = 1_048_576; // 1 MiB

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  })
);

if (!args.uid || args.uid === true) {
  console.error(
    "Missing --uid=<your real uid>. See usage comment at the top of this file."
  );
  process.exit(1);
}

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath) {
  initializeApp({
    credential: cert(JSON.parse(readFileSync(credentialPath, "utf8"))),
  });
} else {
  initializeApp({ credential: applicationDefault() });
}

const db = getFirestore();
const uid = args.uid;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the UTF-8 byte size of a value's JSON representation.
 * Firestore stores documents as protocol buffers, and the actual wire size
 * can differ slightly from JSON size (field name overhead, type tags, etc.).
 * However, JSON byte size is a very close approximation and is what the
 * Firestore client SDK serializes before sending — so it's the right metric
 * for diagnosing which fields are bloating the document.
 */
function jsonByteSize(value) {
  if (value === undefined || value === null) return 0;
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(3)} MiB`;
}

function isDataUrl(value) {
  if (typeof value !== "string") return false;
  return value.startsWith("data:") || value.startsWith("base64,");
}

// Fields the user specifically asked us to highlight.
const PRIORITY_FIELDS = new Set([
  "scheduleAssistantDraft",
  "scheduleAssistantDraftArchive",
  "scheduleAssistantSettings",
  "scheduleSegmentGoals",
  "classificationTaxonomy",
  "reviewTrackers",
  "trackers",
  "reviewProjects",
  "scheduleStickerTemplates",
  "dailyReviewUi",
  "dashboardGoalImage",
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Profile Size Audit ===`);
  console.log(`Project: claire-xiaoye | UID: ${uid}\n`);

  const profileSnap = await db.collection("users").doc(uid).get();

  if (!profileSnap.exists) {
    console.error(`Document users/${uid} does not exist.`);
    process.exit(1);
  }

  const data = profileSnap.data();

  // Firestore's internal representation includes field names, type tags,
  // and metadata. The JSON byte size is a close lower-bound approximation.
  // We also compute a "key overhead" estimate: each field name contributes
  // its string length + a few bytes of protobuf overhead.
  const fieldSizes = [];
  let totalSize = 0;

  for (const [key, value] of Object.entries(data)) {
    // Skip Firestore sentinel values (serverTimestamp, etc.) that resolve
    // to Timestamp objects — measure their JSON representation.
    const size = jsonByteSize(value);
    const keyOverhead = Buffer.byteLength(key, "utf8") + 4; // rough protobuf field tag
    const fieldTotal = size + keyOverhead;
    fieldSizes.push({ key, valueSize: size, keyOverhead, fieldTotal, value });
    totalSize += fieldTotal;
  }

  // Sort by size descending
  fieldSizes.sort((a, b) => b.fieldTotal - a.fieldTotal);

  // --- Total size ---
  console.log(`Total estimated profile size: ${formatBytes(totalSize)} (${totalSize.toLocaleString()} bytes)`);
  console.log(`Firestore limit:              ${formatBytes(FIRESTORE_MAX_DOC_SIZE)} (${FIRESTORE_MAX_DOC_SIZE.toLocaleString()} bytes)`);
  const delta = totalSize - FIRESTORE_MAX_DOC_SIZE;
  if (delta > 0) {
    console.log(`\n  *** OVER LIMIT by ${formatBytes(delta)} (${delta.toLocaleString()} bytes) ***`);
  } else {
    console.log(`\n  Under limit by ${formatBytes(Math.abs(delta))} (${Math.abs(delta).toLocaleString()} bytes)`);
  }

  // --- Top 10 largest fields ---
  console.log(`\n--- Top 10 Largest Fields ---\n`);
  console.log(
    `${"#".padStart(3)}  ${"Field".padEnd(40)} ${"Size".padStart(12)} ${"% of total".padStart(12)}  Notes`
  );
  console.log(`${"-".repeat(3)}  ${"-".repeat(40)} ${"-".repeat(12)} ${"-".repeat(12)}  ${"-".repeat(30)}`);

  fieldSizes.slice(0, 10).forEach((field, i) => {
    const pct = ((field.fieldTotal / totalSize) * 100).toFixed(1);
    let notes = "";
    if (PRIORITY_FIELDS.has(field.key)) notes = "[priority]";
    if (isDataUrl(field.value)) notes += " [BASE64/DATA-URL]";
    if (Array.isArray(field.value)) notes += ` [array: ${field.value.length} items]`;
    if (field.value && typeof field.value === "object" && !Array.isArray(field.value)) {
      notes += ` [object: ${Object.keys(field.value).length} keys]`;
    }
    console.log(
      `${String(i + 1).padStart(3)}  ${field.key.padEnd(40)} ${formatBytes(field.fieldTotal).padStart(12)} ${pct.padStart(11)}%  ${notes}`
    );
  });

  // --- All fields (full table) ---
  console.log(`\n--- All Fields (sorted by size) ---\n`);
  console.log(
    `${"Field".padEnd(40)} ${"Value Size".padStart(12)} ${"Key Overhead".padStart(12)} ${"Total".padStart(12)} ${"% of total".padStart(10)}`
  );
  console.log(`${"-".repeat(40)} ${"-".repeat(12)} ${"-".repeat(12)} ${"-".repeat(12)} ${"-".repeat(10)}`);

  fieldSizes.forEach((field) => {
    const pct = ((field.fieldTotal / totalSize) * 100).toFixed(2);
    let marker = PRIORITY_FIELDS.has(field.key) ? " *" : "  ";
    if (isDataUrl(field.value)) marker += "[B64]";
    console.log(
      `${marker}${field.key.padEnd(38)} ${formatBytes(field.valueSize).padStart(12)} ${formatBytes(field.keyOverhead).padStart(12)} ${formatBytes(field.fieldTotal).padStart(12)} ${pct.padStart(9)}%`
    );
  });

  // --- Priority fields summary ---
  console.log(`\n--- Priority Fields Summary ---\n`);
  let priorityTotal = 0;
  for (const field of fieldSizes) {
    if (!PRIORITY_FIELDS.has(field.key)) continue;
    priorityTotal += field.fieldTotal;
    const pct = ((field.fieldTotal / totalSize) * 100).toFixed(1);
    console.log(`  ${field.key.padEnd(40)} ${formatBytes(field.fieldTotal).padStart(12)}  ${pct.padStart(6)}%`);
  }
  console.log(`  ${"".padEnd(40)} ${"-".repeat(12)}`);
  console.log(`  ${"Priority fields subtotal".padEnd(40)} ${formatBytes(priorityTotal).padStart(12)}  ${((priorityTotal / totalSize) * 100).toFixed(1)}%`);

  // --- scheduleAssistantDraftArchive breakdown ---
  const archive = data.scheduleAssistantDraftArchive;
  console.log(`\n--- scheduleAssistantDraftArchive Breakdown ---\n`);

  if (!Array.isArray(archive) || archive.length === 0) {
    console.log("  Archive is empty or not an array.");
  } else {
    const archiveTotal = jsonByteSize(archive);
    console.log(`  Total entries: ${archive.length}`);
    console.log(`  Total size:    ${formatBytes(archiveTotal)} (${archiveTotal.toLocaleString()} bytes)`);
    console.log(`  Average per entry: ${formatBytes(Math.round(archiveTotal / archive.length))}`);
    console.log();

    const entrySizes = archive.map((entry, index) => {
      const date = entry?.targetDate || entry?.savedOn || `(entry ${index})`;
      const size = jsonByteSize(entry);
      return { date, size, index };
    });

    entrySizes.sort((a, b) => b.size - a.size);

    console.log(`  ${"Date".padEnd(14)} ${"Size".padStart(12)} ${"% of archive".padStart(14)}`);
    console.log(`  ${"-".repeat(14)} ${"-".repeat(12)} ${"-".repeat(14)}`);

    entrySizes.forEach(({ date, size }) => {
      const pct = ((size / archiveTotal) * 100).toFixed(1);
      console.log(`  ${date.padEnd(14)} ${formatBytes(size).padStart(12)} ${pct.padStart(13)}%`);
    });

    const maxEntry = entrySizes[0];
    const minEntry = entrySizes[entrySizes.length - 1];
    console.log(`\n  Largest entry:  ${maxEntry.date} — ${formatBytes(maxEntry.size)}`);
    console.log(`  Smallest entry: ${minEntry.date} — ${formatBytes(minEntry.size)}`);
  }

  // --- dashboardGoalImage flag ---
  console.log(`\n--- dashboardGoalImage Check ---\n`);
  const goalImage = data.dashboardGoalImage;
  if (!goalImage) {
    console.log("  dashboardGoalImage is empty/null.");
  } else if (isDataUrl(goalImage)) {
    const size = Buffer.byteLength(goalImage, "utf8");
    console.log(`  *** BASE64 / DATA URL DETECTED ***`);
    console.log(`  Size: ${formatBytes(size)} (${size.toLocaleString()} bytes)`);
    console.log(`  Preview: ${goalImage.substring(0, 80)}...`);
  } else {
    const size = Buffer.byteLength(goalImage, "utf8");
    console.log(`  Not a data URL. Type: ${typeof goalImage}, size: ${formatBytes(size)}`);
    console.log(`  Preview: ${goalImage.substring(0, 80)}`);
  }

  // --- Migration recommendation data ---
  console.log(`\n--- Migration Candidate Analysis ---\n`);

  // Fields that grow by date (unbounded)
  const dateGrowthFields = fieldSizes.filter((f) =>
    ["scheduleAssistantDraftArchive", "scheduleSegmentGoals", "reviewTrackers"].includes(f.key)
  );

  console.log("  Fields that grow by date (unbounded):");
  dateGrowthFields.forEach((f) => {
    const pct = ((f.fieldTotal / totalSize) * 100).toFixed(1);
    console.log(`    ${f.key.padEnd(40)} ${formatBytes(f.fieldTotal).padStart(12)}  ${pct.padStart(6)}%`);
  });

  // Large static fields (bounded but big)
  const largeStaticFields = fieldSizes.filter(
    (f) => !dateGrowthFields.includes(f) && f.fieldTotal > 1024 && f.key !== "scheduleAssistantDraftArchive"
  );
  console.log("\n  Large fields (> 1 KiB, static):");
  largeStaticFields.slice(0, 10).forEach((f) => {
    const pct = ((f.fieldTotal / totalSize) * 100).toFixed(1);
    console.log(`    ${f.key.padEnd(40)} ${formatBytes(f.fieldTotal).padStart(12)}  ${pct.padStart(6)}%`);
  });

  // --- Summary ---
  console.log(`\n=== Summary ===\n`);
  console.log(`  Profile total:     ${formatBytes(totalSize)} / ${formatBytes(FIRESTORE_MAX_DOC_SIZE)} (${totalSize > FIRESTORE_MAX_DOC_SIZE ? "OVER LIMIT" : "OK"})`);
  if (totalSize > FIRESTORE_MAX_DOC_SIZE) {
    console.log(`  Over by:           ${formatBytes(totalSize - FIRESTORE_MAX_DOC_SIZE)}`);
  }

  // Top 3 reduction targets
  const top3 = fieldSizes.slice(0, 3);
  const top3Total = top3.reduce((sum, f) => sum + f.fieldTotal, 0);
  console.log(`  Top 3 fields:      ${formatBytes(top3Total)} (${((top3Total / totalSize) * 100).toFixed(1)}% of total)`);
  top3.forEach((f, i) => {
    console.log(`    ${i + 1}. ${f.key} — ${formatBytes(f.fieldTotal)}`);
  });

  console.log(`\n  * = priority field  [B64] = base64/data URL`);
  console.log(`\n  Note: Sizes are JSON UTF-8 byte estimates. Firestore's internal`);
  console.log(`  protobuf wire format may differ slightly, but JSON size is the`);
  console.log(`  primary metric for client SDK serialization and is a close`);
  console.log(`  approximation of the document size that Firestore enforces.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
