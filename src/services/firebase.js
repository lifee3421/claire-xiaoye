import { initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// This is deliberately a development-only escape hatch for local UI checks.
// A production build never treats the flag as a Firebase bypass, even if a
// hosting environment accidentally provides the variable.
const forceLocalDemo = import.meta.env.DEV && import.meta.env.VITE_FORCE_LOCAL_DEMO === "true";

export const isFirebaseConfigured = !forceLocalDemo && Object.values(firebaseConfig).every(Boolean);

let app = null;
let auth = null;
let db = null;
let storage = null;
let googleProvider = null;
let firebaseAuthReady = Promise.resolve();

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Make reload and foreground behaviour explicit for the HTTPS Planner origin.
  // This stays within Firebase's browser session store; no native token bridge exists.
  firebaseAuthReady = setPersistence(auth, browserLocalPersistence);
  db = getFirestore(app);
  storage = getStorage(app);
  googleProvider = new GoogleAuthProvider();
}

export { app, auth, db, storage, googleProvider, firebaseAuthReady };
