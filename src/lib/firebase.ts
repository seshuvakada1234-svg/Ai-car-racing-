import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const isClient = typeof window !== "undefined";
const getAuthDomain = () => {
  if (!isClient) return firebaseConfig.authDomain;
  const hostname = window.location.hostname;
  
  // Use current hostname for custom domains (e.g., Vercel) to support same-origin redirects
  if (
    hostname &&
    !hostname.includes("localhost") &&
    !hostname.includes("127.0.0.1") &&
    !hostname.includes("run.app") &&
    !hostname.includes("aistudio")
  ) {
    return hostname;
  }
  return firebaseConfig.authDomain;
};

const FIREBASE_CONFIG = {
  ...firebaseConfig,
  authDomain: getAuthDomain(),
};

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Initialize Firestore with custom database ID from configuration
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export { app, auth, googleProvider, db };
export type { User };
