import { initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  // Kept only because it predates this change and is part of the config
  // completeness gate below (isFirebaseConfigured). Cloud Storage itself is
  // deliberately NOT initialized: since 2026-02-03 Cloud Storage for Firebase
  // requires the Blaze plan, and this project stays on Spark. Binary assets
  // (dashboard goal image) live in Firestore instead — see goalImageAsset.js.
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const forceLocalDemo = import.meta.env.DEV && import.meta.env.VITE_FORCE_LOCAL_DEMO === "true";

export const isFirebaseConfigured = !forceLocalDemo && Object.values(firebaseConfig).every(Boolean);

let app = null;
let auth = null;
let db = null;
let googleProvider = null;
let firebaseAuthReady = Promise.resolve();

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  firebaseAuthReady = setPersistence(auth, browserLocalPersistence);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
}

export { app, auth, db, googleProvider, firebaseAuthReady };
