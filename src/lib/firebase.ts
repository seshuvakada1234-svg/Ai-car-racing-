import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const isClient = typeof window !== "undefined";
const getAuthDomain = () => {
  if (!isClient) return "gen-lang-client-0751322500.firebaseapp.com";
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
  return "gen-lang-client-0751322500.firebaseapp.com";
};

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAHuQWbA8Ws5YpYBhVsinH9vhCWo6pvejY",
  authDomain: getAuthDomain(),
  projectId: "gen-lang-client-0751322500",
  storageBucket: "gen-lang-client-0751322500.firebasestorage.app",
  messagingSenderId: "427595066203",
  appId: "1:427595066203:web:aa7c6fb3503275e5fa887e",
};

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Initialize Firestore with default database
const db = getFirestore(app);

export { app, auth, googleProvider, db };
export type { User };
