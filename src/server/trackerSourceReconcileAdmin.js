import { resolveEffectiveTrackers } from "../utils/trackerDefaults.js";
import { planTrackerSourceReconcile } from "./trackerSourceReconcileCore.js";

export const TRACKER_SOURCE_REPAIR_VERSION = 1;

function rows(snapshot) {
  return snapshot?.docs?.map((item) => ({ id: item.id, ...item.data() })) || [];
}

function uniqueById(items) {
  return [...new Map((Array.isArray(items) ? items : []).filter((item) => item?.id).map((item) => [item.id, item])).values()];
}

async function readFullSourceSnapshot(db, uid) {
  const base = db.collection("users").doc(uid);
  const [settlements, exerciseRecords, events] = await Promise.all([
    base.collection("settlements").get(),
    base.collection("exerciseRecords").get(),
    base.collection("completionEvents").get(),
  ]);
  return { settlements: rows(settlements), exerciseRecords: rows(exerciseRecords), existingEvents: rows(events) };
}

async function readDateSourceSnapshot(db, uid, dates) {
  const base = db.collection("users").doc(uid);
  const settlements = [];
  const exerciseRecords = [];
  const existingEvents = [];

  for (const date of [...new Set((dates || []).filter(Boolean))]) {
    const [directSettlement, exerciseRecord, eventSnapshot] = await Promise.all([
      base.collection("settlements").doc(date).get(),
      base.collection("exerciseRecords").doc(date).get(),
      base.collection("completionEvents").where("occurredOn", "==", date).get(),
    ]);

    if (directSettlement.exists) {
      settlements.push({ id: directSettlement.id, ...directSettlement.data() });
    } else {
      // Legacy settlements were not always keyed by reviewDate. Equality on
      // reviewDate keeps targeted repair correct without scanning history.
      const legacyMatches = await base.collection("settlements").where("reviewDate", "==", date).get();
      settlements.push(...rows(legacyMatches));
    }
    if (exerciseRecord.exists) exerciseRecords.push({ id: exerciseRecord.id, ...exerciseRecord.data() });
    existingEvents.push(...rows(eventSnapshot));
  }

  return {
    settlements: uniqueById(settlements),
    exerciseRecords: uniqueById(exerciseRecords),
    existingEvents: uniqueById(existingEvents),
  };
}

async function writePlan(db, uid, plan) {
  const writes = [
    ...(plan?.toUpsert || []).map((event) => ({ kind: "set", event })),
    ...(plan?.toRetract || []).map((event) => ({ kind: "set", event })),
  ];
  let written = 0;
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    const chunk = writes.slice(offset, offset + 400);
    for (const { event } of chunk) {
      batch.set(db.collection("users").doc(uid).collection("completionEvents").doc(event.id), event, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

/**
 * Server-authoritative Tracker self-heal.
 *
 * `fullRepair:true` performs a one-time historical materialization whenever
 * TRACKER_SOURCE_REPAIR_VERSION advances. After that, normal calls only
 * reconcile the supplied dates, so daily review / Keep sync stays cheap.
 * The version is written only after a successful full repair.
 */
export async function reconcileTrackerSourcesAdmin(db, uid, { dates = [], fullRepair = true } = {}) {
  if (!db || !uid) return { status: "noop", reason: "missing_db_or_uid" };
  const profileRef = db.collection("users").doc(uid);
  const profileSnap = await profileRef.get();
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const trackers = resolveEffectiveTrackers(profile).filter((tracker) => tracker?.enabled !== false);
  const needsFullRepair = fullRepair && Number(profile?.trackerSourceRepairVersion || 0) < TRACKER_SOURCE_REPAIR_VERSION;
  const uniqueDates = [...new Set((dates || []).filter(Boolean))];

  if (!needsFullRepair && !uniqueDates.length) return { status: "noop", reason: "nothing_to_reconcile" };

  const snapshot = needsFullRepair
    ? await readFullSourceSnapshot(db, uid)
    : await readDateSourceSnapshot(db, uid, uniqueDates);
  const plan = await planTrackerSourceReconcile({ trackers, ...snapshot });
  const written = await writePlan(db, uid, plan);

  if (needsFullRepair) {
    await profileRef.set({
      trackerSourceRepairVersion: TRACKER_SOURCE_REPAIR_VERSION,
      trackerSourceRepairUpdatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  return {
    status: "reconciled",
    mode: needsFullRepair ? "full_repair" : "dates",
    dates: uniqueDates,
    sourceCounts: {
      settlements: snapshot.settlements.length,
      exerciseRecords: snapshot.exerciseRecords.length,
      existingEvents: snapshot.existingEvents.length,
    },
    upserted: plan.toUpsert.length,
    retracted: plan.toRetract.length,
    written,
    repairVersion: TRACKER_SOURCE_REPAIR_VERSION,
  };
}
