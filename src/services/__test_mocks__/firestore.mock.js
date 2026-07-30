// Minimal stand-in for the "firebase/firestore" named exports dataService.js
// imports at module scope, used ONLY by the ESM loader hook in
// scripts/testEsmLoader.mjs to let dataService.js's real code run under
// plain `node --test` without a live Firestore. Every export below exists
// solely so the module-level `import {...} from "firebase/firestore"` in
// dataService.js resolves — functions this particular test doesn't
// exercise throw loudly if accidentally called, rather than silently
// returning something plausible-looking.
export const __setDocCalls = [];

export function __resetFirestoreMock() {
  __setDocCalls.length = 0;
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
export const getDocs = unmocked("getDocs");
export const onSnapshot = unmocked("onSnapshot");
export const orderBy = unmocked("orderBy");
export const query = unmocked("query");
export const runTransaction = unmocked("runTransaction");
export const updateDoc = unmocked("updateDoc");
export const writeBatch = unmocked("writeBatch");
export const where = unmocked("where");
export const limit = unmocked("limit");
export const startAfter = unmocked("startAfter");
