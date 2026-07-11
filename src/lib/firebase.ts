import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const isClient = typeof window !== "undefined";

// Helper to safely retrieve environment variables in both Node.js (process.env) and Vite (import.meta.env)
const getEnv = (key: string): string => {
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env) {
      switch (key) {
        case "VITE_FIREBASE_API_KEY":
          return import.meta.env.VITE_FIREBASE_API_KEY || "";
        case "VITE_FIREBASE_AUTH_DOMAIN":
          return import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "";
        case "VITE_FIREBASE_PROJECT_ID":
          return import.meta.env.VITE_FIREBASE_PROJECT_ID || "";
        case "VITE_FIREBASE_STORAGE_BUCKET":
          return import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "";
        case "VITE_FIREBASE_MESSAGING_SENDER_ID":
          return import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "";
        case "VITE_FIREBASE_APP_ID":
          return import.meta.env.VITE_FIREBASE_APP_ID || "";
        case "VITE_FIREBASE_MEASUREMENT_ID":
          return import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "";
        case "VITE_FIREBASE_FIRESTORE_DATABASE_ID":
          return import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "";
      }
    }
  } catch (e) {
    // Fallback to empty string if access throws
  }
  return "";
};

const getAuthDomain = () => {
  const defaultAuthDomain = getEnv("VITE_FIREBASE_AUTH_DOMAIN");
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

const firebaseConfig = {
  apiKey: getEnv("VITE_FIREBASE_API_KEY"),
  authDomain: getAuthDomain() || getEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: getEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: getEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnv("VITE_FIREBASE_APP_ID"),
  measurementId: getEnv("VITE_FIREBASE_MEASUREMENT_ID"),
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const firestoreDbId = getEnv("VITE_FIREBASE_FIRESTORE_DATABASE_ID");
const db = firestoreDbId ? getFirestore(app, firestoreDbId) : getFirestore(app);

export { app, auth, googleProvider, db };
export type { User };
