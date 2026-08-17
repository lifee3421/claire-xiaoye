// Minimal stand-in for the "firebase/firestore" named exports dataService.js
// imports at module scope, used ONLY by the ESM loader hook in
// scripts/testEsmLoader.mjs to let dataService.js's real code run under
// plain `node --test` without a live Firestore. Every export below exists
// solely so the module-level `import {...} from "firebase/firestore"` in
// dataService.js resolves — functions this particular test doesn't
// exercise throw loudly if accidentally called, rather than silently
// returning something plausible-looking.
export const __setDocCalls = [];
export const __batchCalls = [];
const querySnapshots = [];

export function __resetFirestoreMock() {
  __setDocCalls.length = 0;
  __batchCalls.length = 0;
  querySnapshots.length = 0;
}

export function __queueQuerySnapshot(rows = []) {
  querySnapshots.push(rows);
}

export function doc(...args) {
  return { __kind: "docRef", path: args.slice(1).join("/") };
}

export function collection(...args) {
  return { __kind: "collectionRef", path: args.slice(1).join("/") };
}

export function serverTimestamp() {
  return { __kind: "serverTimestamp" };
}

export function setDoc(ref, payload, options) {
  __setDocCalls.push({ ref, payload, options });
  return Promise.resolve();
}

function unmocked(name) {
  return () => { throw new Error(`firestore.mock.js: "${name}" was called but is not mocked — this test only exercises saveProfileSettings' setDoc path.`); };
}

export const addDoc = unmocked("addDoc");
export const deleteDoc = unmocked("deleteDoc");
export const getDoc = unmocked("getDoc");
export function getDocs() {
  const rows = querySnapshots.shift() || [];
  return Promise.resolve({
    docs: rows.map((row) => ({ id: row.id, data: () => ({ ...row.data }) })),
  });
}
export const onSnapshot = unmocked("onSnapshot");
export const orderBy = unmocked("orderBy");
export function query(...args) { return { __kind: "query", args }; }
export const runTransaction = unmocked("runTransaction");
export const updateDoc = unmocked("updateDoc");
export function writeBatch() {
  const calls = [];
  __batchCalls.push(calls);
  return {
    set(ref, payload, options) { calls.push({ type: "set", ref, payload, options }); },
    update(ref, payload) { calls.push({ type: "update", ref, payload }); },
    delete(ref) { calls.push({ type: "delete", ref }); },
    commit() { return Promise.resolve(); },
  };
}
export function where(...args) { return { __kind: "where", args }; }
export function limit(...args) { return { __kind: "limit", args }; }
export const startAfter = unmocked("startAfter");
/** Used by dataService's ledger counter bumps (rewardTotalEarned/rewardTotalSpent). */
export function increment(value) { return { __kind: "increment", value }; }
