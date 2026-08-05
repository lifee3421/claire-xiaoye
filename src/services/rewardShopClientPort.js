// Web-SDK implementation of the reward/shop port.
//
// The browser twin of src/server/rewardShopAdminPort.js. Both feed the same
// src/server/rewardShopEngine.js, so redeeming from the Mall page and
// redeeming from WeChat run the identical validation, the identical point
// deduction and write the identical documents — the web path is not a
// second implementation that can drift.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { createRewardShopEngine } from "../server/rewardShopEngine.js";

// The web SDK exposes `exists()` as a method; admin exposes `exists` as a
// property. Normalizing here is what keeps the engine SDK-agnostic.
function snapshotOf(snap) {
  const exists = typeof snap.exists === "function" ? snap.exists() : Boolean(snap.exists);
  return { exists, id: snap.id, data: exists ? snap.data() : null };
}

export function createRewardShopClientPort(uid) {
  if (!uid) throw new Error("createRewardShopClientPort requires a uid");
  const userRef = doc(db, "users", uid);

  return {
    profileRef() {
      return userRef;
    },

    async getProfile() {
      return snapshotOf(await getDoc(userRef));
    },

    ref(collectionName, docId) {
      return docId ? doc(db, "users", uid, collectionName, docId) : doc(collection(db, "users", uid, collectionName));
    },

    async getDoc(collectionName, docId) {
      return snapshotOf(await getDoc(doc(db, "users", uid, collectionName, docId)));
    },

    async listDocs(collectionName, { orderByField = "", direction = "desc", limit = 0 } = {}) {
      const base = collection(db, "users", uid, collectionName);
      const constraints = [];
      if (orderByField) constraints.push(orderBy(orderByField, direction));
      if (limit > 0) constraints.push(limitTo(limit));
      const snap = await getDocs(constraints.length ? query(base, ...constraints) : base);
      return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
    },

    async runTransaction(fn) {
      return await runTransaction(db, async (tx) => await fn(tx));
    },

    async txGet(tx, ref) {
      return snapshotOf(await tx.get(ref));
    },

    txSet(tx, ref, data, options) {
      if (options) tx.set(ref, data, options);
      else tx.set(ref, data);
    },

    serverTimestamp() {
      return serverTimestamp();
    },

    now() {
      return new Date();
    },
  };
}

// Read-only on purpose. Every reward/shop WRITE now goes through
// /api/reward-shop, which runs the same engine under the Admin SDK after
// verifying a Firebase ID token — see src/services/rewardShopApi.js.
//
// The browser keeps its live onSnapshot subscriptions and these read helpers,
// but the write methods are not re-exported at all: calling
// `createWebRewardShopReader(uid).redeemShopItem(...)` is a TypeError instead
// of a silent second implementation of "deduct points" running client-side
// with the user's own credentials.
export const WEB_READ_ONLY_METHODS = Object.freeze(["getBalance", "listTransactions", "listShopItems", "listOwnedRewards", "resolveShopItem"]);

export function createWebRewardShopReader(uid) {
  const engine = createRewardShopEngine(createRewardShopClientPort(uid), { actor: "web" });
  const reader = {};
  for (const method of WEB_READ_ONLY_METHODS) reader[method] = engine[method];
  return Object.freeze(reader);
}
