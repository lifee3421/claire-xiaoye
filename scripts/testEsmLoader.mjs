// A narrow, test-only ESM loader hook (--experimental-loader) that lets
// src/services/dataService.js's REAL code run under plain `node --test`,
// which otherwise can't import it at all: Vite resolves extensionless
// relative specifiers (import {x} from "./demoStore") and dataService.js
// uses that convention throughout, but Node's native ESM resolver requires
// an explicit extension. This hook does exactly two things, and nothing
// else:
//   1. For dataService.js specifically, redirects "./firebase" and
//      "firebase/firestore" to the test doubles in
//      src/services/__test_mocks__/ — so saveProfileSettings' real setDoc
//      call can be intercepted and inspected instead of hitting a live
//      Firebase project.
//   2. For any other extensionless relative specifier, retries resolution
//      with ".js" appended before giving up — this is what actually lets
//      the module graph (demoStore.js, calculations.js, reading.js,
//      maskCyclePatch.js, trackerIdentity.js, trackerReconcileJobs.js, ...)
//      load at all.
// Not used anywhere except pnpm test's dataServiceProfileSettings test —
// see package.json's "test" script, which does NOT register this loader,
// so it has zero effect on the rest of the suite.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const MOCKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "services", "__test_mocks__");

export async function resolve(specifier, context, nextResolve) {
  const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : "";
  // rewardShopApi.js (the browser's write path, which needs `auth` to attach
  // an ID token) and rewardShopClientPort.js (the read-only browser port) are
  // both in dataService.js's module graph and import the same Firebase
  // specifiers, so they need the same redirect — otherwise importing
  // dataService.js pulls in a live SDK.
  const FIREBASE_BOUND_MODULES = ["dataService.js", "rewardShopClientPort.js", "rewardShopApi.js"];
  const isDataService = FIREBASE_BOUND_MODULES.some((name) => parentPath.endsWith(`${path.sep}${name}`) || parentPath.endsWith(`/${name}`));

  if (isDataService && specifier === "./firebase") {
    return nextResolve(pathToFileURL(path.join(MOCKS_DIR, "firebase.mock.js")).href, context);
  }
  if (isDataService && specifier === "firebase/firestore") {
    return nextResolve(pathToFileURL(path.join(MOCKS_DIR, "firestore.mock.js")).href, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isBareOrAbsolute = !specifier.startsWith(".");
    const alreadyHasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);
    if (isBareOrAbsolute || alreadyHasExtension || error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return nextResolve(`${specifier}.js`, context);
  }
}
