import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const isClient = typeof window !== "undefined";

// Helper to safely retrieve environment variables in both Node.js and Vite
const getEnv = (key: string, fallback: string = ""): string => {
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env) {
      const val = import.meta.env[key];
      if (val) return val;
    }
  } catch (e) {
    // Fallback to empty string if access throws
  }
  return fallback;
};

// Prioritize environment variables (Vercel overrides) and fall back to applet-config values
const apiKey = getEnv("VITE_FIREBASE_API_KEY") || firebaseConfig.apiKey || "";
const projectId = getEnv("VITE_FIREBASE_PROJECT_ID") || firebaseConfig.projectId || "";
const storageBucket = getEnv("VITE_FIREBASE_STORAGE_BUCKET") || firebaseConfig.storageBucket || "";
const messagingSenderId = getEnv("VITE_FIREBASE_MESSAGING_SENDER_ID") || firebaseConfig.messagingSenderId || "";
const appId = getEnv("VITE_FIREBASE_APP_ID") || firebaseConfig.appId || "";
const measurementId = getEnv("VITE_FIREBASE_MEASUREMENT_ID") || firebaseConfig.measurementId || "";
const firestoreDbId = getEnv("VITE_FIREBASE_FIRESTORE_DATABASE_ID") || firebaseConfig.firestoreDatabaseId || "";
const defaultAuthDomain = getEnv("VITE_FIREBASE_AUTH_DOMAIN") || firebaseConfig.authDomain || "";

const getAuthDomain = () => {
  if (!isClient) return defaultAuthDomain;
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
  return defaultAuthDomain;
};

const finalConfig = {
  apiKey,
  authDomain: getAuthDomain() || defaultAuthDomain,
  projectId,
  storageBucket,
  messagingSenderId,
  appId,
  measurementId,
};

const app = getApps().length ? getApp() : initializeApp(finalConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const db = firestoreDbId ? getFirestore(app, firestoreDbId) : getFirestore(app);

export { app, auth, googleProvider, db };
export type { User };
