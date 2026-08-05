// Minimal stand-in for the "firebase/firestore" named exports dataService.js
// (and goalImageFirestore.js) imports at module scope, used ONLY by the ESM
// loader hook in scripts/testEsmLoader.mjs to let their real code run under
// plain `node --test` without a live Firestore. Every export below exists
// solely so the module-level `import {...} from "firebase/firestore"` resolves
// — functions a particular test doesn't exercise throw loudly if accidentally
// called, rather than silently returning something plausible-looking.
export const __setDocCalls = [];
export const __batchCalls = [];
const querySnapshots = [];
let __getDocImpl = null;

export function __resetFirestoreMock() {
  __setDocCalls.length = 0;
  __batchCalls.length = 0;
  querySnapshots.length = 0;
  __getDocImpl = null;
}

export function __queueQuerySnapshot(rows = []) {
  querySnapshots.push(rows);
}

// Tests that exercise the read path (goalImageFirestore's cache) install a
// controllable getDoc here.  Left unset, getDoc still throws loudly — it is
// only safe to call once a test has decided what it should return.
export function __setGetDocImpl(fn) {
  __getDocImpl = fn;
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

// Firestore Bytes stand-in: round-trips a Uint8Array through toUint8Array(),
// matching the duck-typed decode in goalImageAsset.js (decodeGoalImageBytes).
export const Bytes = {
  fromUint8Array(view) {
    return { __kind: "Bytes", toUint8Array: () => view };
  },
};

function unmocked(name) {
  return () => { throw new Error(`firestore.mock.js: "${name}" was called but is not mocked — this test only exercises saveProfileSettings' setDoc path.`); };
}

export const addDoc = unmocked("addDoc");
export const deleteDoc = unmocked("deleteDoc");
export function getDoc(ref) {
  if (!__getDocImpl) throw new Error('firestore.mock.js: "getDoc" was called but no impl was set via __setGetDocImpl — this test does not exercise the read path.');
  return __getDocImpl(ref);
}
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
