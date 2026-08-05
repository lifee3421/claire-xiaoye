// firebase-admin implementation of the reward/shop port.
//
// This file is the ONLY place the server talks to Firestore for reward/shop
// work. All of the actual decisions live in rewardShopCore.js and are driven
// by rewardShopEngine.js — swapping this port for the browser one
// (src/services/rewardShopClientPort.js) runs literally the same redeem
// logic against the web SDK.
//
// Everything is scoped to users/{uid}: the port is constructed with a uid
// and physically cannot address another user's document, so a request body
// can never steer a write somewhere else.

import { FieldValue } from "firebase-admin/firestore";

function snapshotOf(snap) {
  return { exists: snap.exists, id: snap.id, data: snap.exists ? snap.data() : null };
}

export function createRewardShopAdminPort({ db, uid }) {
  if (!db) throw new Error("createRewardShopAdminPort requires a Firestore instance");
  if (!uid) throw new Error("createRewardShopAdminPort requires a uid");

  const userRef = db.collection("users").doc(uid);

  function collection(name) {
    return userRef.collection(name);
  }

  return {
    profileRef() {
      return userRef;
    },

    async getProfile() {
      return snapshotOf(await userRef.get());
    },

    ref(collectionName, docId) {
      const col = collection(collectionName);
      return docId ? col.doc(docId) : col.doc();
    },

    async getDoc(collectionName, docId) {
      return snapshotOf(await collection(collectionName).doc(docId).get());
    },

    async listDocs(collectionName, { orderByField = "", direction = "desc", limit = 0 } = {}) {
      let query = collection(collectionName);
      // orderBy silently drops documents missing the field, so it is only
      // applied to the append-only collections this codebase always stamps
      // (pointTransactions.createdAt / rewardInstances.redeemedAt). `products`
      // is listed unordered on purpose — legacy rows predate createdAt.
      if (orderByField) query = query.orderBy(orderByField, direction);
      if (limit > 0) query = query.limit(limit);
      const snap = await query.get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },

    async runTransaction(fn) {
      return await db.runTransaction(async (tx) => await fn(tx));
    },

    async txGet(tx, ref) {
      return snapshotOf(await tx.get(ref));
    },

    txSet(tx, ref, data, options) {
      if (options) tx.set(ref, data, options);
      else tx.set(ref, data);
    },

    txDelete(tx, ref) {
      tx.delete(ref);
    },

    serverTimestamp() {
      return FieldValue.serverTimestamp();
    },

    now() {
      return new Date();
    },
  };
}
