// Stand-in for src/services/firebase.js's `db` export, used only by the ESM
// loader hook in scripts/testEsmLoader.mjs so dataService.js's real code
// can run under plain `node --test` without a live Firebase app.
export const db = { __kind: "mockDb" };
export const auth = { __kind: "mockAuth" };
export const googleProvider = { __kind: "mockGoogleProvider" };
