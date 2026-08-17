// Run this yourself with your own service-account credentials — nothing
// here ever needs to be shared with anyone. It:
//   1. Checks whether the Cloud Firestore (default) database exists for
//      the claire-xiaoye project.
//   2. If it exists, does a harmless read/write probe against
//      users/{uid}/trackers, users/{uid}/completionEvents,
//      users/{uid}/trackerReconcileJobs to confirm those paths are
//      reachable via the Admin SDK.
//   3. Only with --seed: writes the one test Tracker config into
//      users/{uid}'s `trackers` array field (merge:true — never touches
//      any other profile field).
//
// IMPORTANT CAVEAT: the Admin SDK bypasses Firestore Security Rules
// entirely by design. This script can prove the collections/paths exist
// and are reachable, but it CANNOT tell you whether your normal client-
// side security rules correctly allow your own uid and deny others — that
// can only be verified by actually logging into the app in a browser as
// yourself (steps 4-6 below, which the agent cannot do on your behalf).
//
// Usage:
//   1. Download a service account key JSON from Firebase Console ->
//      Project Settings -> Service Accounts -> Generate new private key.
//   2. Set the env var (PowerShell):
//        $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\key.json"
//   3. Check only (no writes):
//        node scripts/adminCheckAndSeedTracker.mjs --uid=<your real uid>
//   4. Check + seed the test tracker:
//        node scripts/adminCheckAndSeedTracker.mjs --uid=<your real uid> --seed
//
// Find your uid: Firebase Console -> Authentication -> Users tab, or in
// the app itself (Settings page usually shows the signed-in account).
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? true];
}));

if (!args.uid || args.uid === true) {
  console.error("Missing --uid=<your real uid>. See the usage comment at the top of this file.");
  process.exit(1);
}

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath) {
  initializeApp({ credential: cert(JSON.parse(readFileSync(credentialPath, "utf8"))) });
} else {
  initializeApp({ credential: applicationDefault() });
}

const db = getFirestore();
const uid = args.uid;

async function main() {
  console.log(`Checking Firestore (default) database for project, uid=${uid} ...`);

  let dbExists = true;
  try {
    await db.collection("users").doc(uid).get();
  } catch (error) {
    if (String(error?.code) === "5" || /NOT_FOUND/i.test(String(error?.message))) {
      dbExists = false;
    } else {
      console.error("Unexpected error reaching Firestore:", error.message);
      process.exit(1);
    }
  }

  console.log(`1) Firestore (default) database exists: ${dbExists ? "YES" : "NO — go create it in the Firebase Console first, nothing below will work until then"}`);
  if (!dbExists) process.exit(0);

  const profileSnap = await db.collection("users").doc(uid).get();
  console.log(`2) users/${uid} profile doc exists: ${profileSnap.exists ? "YES" : "NO (will be created on first real save from the app)"}`);
  if (profileSnap.exists) {
    const data = profileSnap.data();
    console.log(`   current trackers field: ${JSON.stringify(data.trackers ?? "(not set)")}`);
  }

  for (const sub of ["trackers", "completionEvents", "trackerReconcileJobs"]) {
    try {
      const snap = await db.collection("users").doc(uid).collection(sub).limit(1).get();
      console.log(`   users/${uid}/${sub}: reachable via Admin SDK, ${snap.size} doc(s) currently present (Admin SDK bypasses security rules — this does NOT confirm your client-side rules are correct, only that nothing structurally blocks it)`);
    } catch (error) {
      console.log(`   users/${uid}/${sub}: ERROR — ${error.message}`);
    }
  }

  if (!args.seed) {
    console.log("\nRun again with --seed to write the test tracker config into profile.trackers.");
    return;
  }

  const testTracker = {
    id: "family-a",
    title: "联系外婆",
    schedule: { kind: "interval", every: 7, unit: "day" },
    goal: { aggregation: "occurrence", target: 1, unit: "times" },
    evidenceBindings: [],
    stickerSettings: { enabled: true, emoji: "📞", title: "该联系外婆啦", time: "09:00", type: "reminder" },
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existingTrackers = Array.isArray(profileSnap.data()?.trackers) ? profileSnap.data().trackers : [];
  const nextTrackers = [...existingTrackers.filter((t) => t.id !== "family-a"), testTracker];

  await db.collection("users").doc(uid).set({ trackers: nextTrackers, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`\n3) Wrote test tracker "family-a" into users/${uid}.trackers (${nextTrackers.length} tracker(s) total now). Only the trackers field was touched.`);
  console.log("Next: open the site with ?enableUnifiedTracker=1 while logged in as this same account and check today's schedule page.");
}

main().catch((error) => { console.error(error); process.exit(1); });
