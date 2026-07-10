import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase Configuration
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAHuQWbA8Ws5YpYBhVsinH9vhCWo6pvejY",
  authDomain: "gen-lang-client-0751322500.firebaseapp.com",
  projectId: "gen-lang-client-0751322500",
  storageBucket: "gen-lang-client-0751322500.firebasestorage.app",
  messagingSenderId: "427595066203",
  appId: "1:427595066203:web:aa7c6fb3503275e5fa887e",
};

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);

// Authentication
const auth = getAuth(app);

// Google Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

// Firestore
const db = getFirestore(
  app,
  "ai-studio-6c7a2c4e-0ec1-4008-a8bc-0b3f9058dbdd"
);

export {
  app,
  auth,
  googleProvider,
  db,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
};

export type { User };
