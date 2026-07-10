// AuthContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { auth, db, googleProvider } from "../lib/firebase";
import {
  signInWithPopup,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  updateProfile,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";

export type UserRole = "admin" | "broadcaster" | "user";

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL: string;
  role: UserRole;
  createdAt: any;
  isGuest?: boolean;
  trophies?: number;
  keys?: number;
  coins?: number;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  loginError: string | null;
  clearLoginError: () => void;
  loginWithGoogle: () => Promise<void>;
  loginAsGuest: (displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  setProfileField: (field: keyof UserProfile, value: any) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getRoleFromEmail = (email: string | null): UserRole => {
  if (!email) return "user";
  const emailLower = email.toLowerCase().trim();
  if (
    emailLower === "seshuvakada1234@gmail.com" ||
    emailLower === "resumepro.ads@gmail.com"
  ) {
    return "admin";
  } else if (
    emailLower === "seshuvakada522@gmail.com" ||
    emailLower === "seshuvakada5@gmail.com"
  ) {
    return "broadcaster";
  }
  return "user";
};

const normalizeRole = (role: string | null | undefined): UserRole => {
  if (!role) return "user";
  const r = role.toLowerCase().trim();
  if (r === "admin") return "admin";
  if (r === "broadcaster") return "broadcaster";
  return "user";
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    console.log("Current User:", user);
    console.log("Current Profile:", profile);
    console.log("Loading:", loading);
  }, [user, profile, loading]);

  const clearLoginError = useCallback(() => setLoginError(null), []);

  // Shared logic: given a Firebase Auth user, ensure a matching Firestore profile
  // exists and return the resolved local profile. This is the single source of
  // truth used by both Google sign-in and guest (anonymous) sign-in, so neither
  // path can silently diverge or fail differently.
  const ensureUserProfile = async (firebaseUser: User): Promise<UserProfile> => {
    const isGuest = firebaseUser.isAnonymous;
    const currentRole = getRoleFromEmail(firebaseUser.email);
    const userDocRef = doc(db, "users", firebaseUser.uid);

    const docSnap = await getDoc(userDocRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const normalizedDbRole = normalizeRole(data.role);
      
      if ((normalizedDbRole !== currentRole && !isGuest) || (data.isGuest === undefined && isGuest !== undefined)) {
        const updatedData = {
          ...data,
          role: isGuest ? "user" : currentRole,
          email: firebaseUser.email || data.email || "",
          isGuest,
          name: data.name || firebaseUser.displayName || "Racer",
          photoURL: data.photoURL || firebaseUser.photoURL || "",
        };
        await setDoc(userDocRef, updatedData, { merge: true });
        return {
          uid: firebaseUser.uid,
          name: updatedData.name,
          email: updatedData.email,
          photoURL: updatedData.photoURL,
          role: isGuest ? "user" : currentRole,
          createdAt: data.createdAt,
          isGuest,
        };
      }
      return {
        uid: firebaseUser.uid,
        name: data.name || firebaseUser.displayName || "Racer",
        email: data.email || firebaseUser.email || "",
        photoURL: data.photoURL || firebaseUser.photoURL || "",
        role: normalizeRole(normalizedDbRole || (isGuest ? "user" : currentRole)),
        createdAt: data.createdAt,
        isGuest: data.isGuest !== undefined ? data.isGuest : isGuest,
      };
    }

    // Brand-new user/guest: create the Firestore doc. This is the write that
    // was previously failing silently for new players — now it's awaited and
    // any failure propagates up instead of being swallowed.
    const initialProfile = {
      uid: firebaseUser.uid,
      name: firebaseUser.displayName || (isGuest ? "Guest Racer" : "Racer"),
      email: firebaseUser.email || "",
      photoURL: firebaseUser.photoURL || "",
      role: currentRole,
      isGuest,
      createdAt: serverTimestamp(),
    };
    await setDoc(userDocRef, initialProfile);
    return { ...initialProfile, createdAt: new Date() };
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("Firebase User:", firebaseUser);
      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      try {
        const finalProfile = await ensureUserProfile(firebaseUser);
        console.log("Firestore Profile:", finalProfile);
        setProfile(finalProfile);
        setLoginError(null);
      } catch (dbError: any) {
        // Surface the real reason instead of hiding it. Most commonly this is
        // a Firestore security-rules rejection on create/read for the new user.
        console.error("Failed to load/create user profile:", dbError);
        handleFirestoreError(dbError, OperationType.GET, `users/${firebaseUser.uid}`);
        setLoginError(
          dbError?.code === "permission-denied"
            ? "Your account signed in, but we couldn't create your player profile (permission denied). Check Firestore rules."
            : "Signed in, but couldn't load your player profile. Please try again."
        );
        // Fall back to a local-only profile so the app isn't fully blocked.
        setProfile({
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || "Racer",
          email: firebaseUser.email || "",
          photoURL: firebaseUser.photoURL || "",
          role: normalizeRole(getRoleFromEmail(firebaseUser.email)),
          isGuest: firebaseUser.isAnonymous,
          createdAt: new Date(),
        });
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    setLoading(true);
    setLoginError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      console.error("Failed to log in with Google:", e);
      setLoginError(mapAuthError(e));
      setLoading(false);
      throw e;
    }
  };

  // Real Firebase Anonymous Auth — this is what makes guest play actually
  // work with Firestore security rules, since request.auth.uid is now a real,
  // server-verified value instead of a client-side mock.
  const loginAsGuest = async (displayName: string = "Guest Racer") => {
    setLoading(true);
    setLoginError(null);
    try {
      const cred = await signInAnonymously(auth);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
      // onAuthStateChanged will fire and handle profile creation.
    } catch (e: any) {
      console.error("Failed to log in as guest:", e);
      setLoginError(mapAuthError(e));
      setLoading(false);
      throw e;
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      setUser(null);
      setProfile(null);
    } catch (e) {
      console.error("Failed to logout:", e);
    } finally {
      setLoading(false);
    }
  };

  const setProfileField = async (field: keyof UserProfile, value: any) => {
    if (!user || !profile) return;
    try {
      const userDocRef = doc(db, "users", user.uid);
      await setDoc(userDocRef, { [field]: value }, { merge: true });
      setProfile((prev) => (prev ? { ...prev, [field]: value } : null));
    } catch (e) {
      console.error("Failed to update profile field:", e);
      handleFirestoreError(e, OperationType.WRITE, "users/" + user.uid);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        loginError,
        clearLoginError,
        loginWithGoogle,
        loginAsGuest,
        logout,
        setProfileField,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

function mapAuthError(e: any): string {
  const code = e?.code || "";
  if (code === "auth/unauthorized-domain") {
    return "This domain isn't authorized in Firebase Auth settings. Add it under Authentication → Settings → Authorized domains.";
  }
  if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
    return "Sign-in popup was blocked or closed. Please allow popups and try again.";
  }
  if (code === "auth/admin-restricted-operation") {
    return "Anonymous sign-in is disabled for this project. Enable it in Firebase Console → Authentication → Sign-in method.";
  }
  return e?.message || "Login failed. Please try again.";
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};