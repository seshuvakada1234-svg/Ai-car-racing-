
import React, { createContext, useContext, useState, useEffect } from "react";
import { auth, db, googleProvider } from "../lib/firebase";
import { signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../lib/firestoreError";

export type UserRole = "admin" | "broadcaster" | "user" | "BROADCAST_ADMIN" | "STREAM_CLIENT" | "PLAYER";

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL: string;
  role: UserRole;
  createdAt: any;
  trophies?: number;
  keys?: number;
  coins?: number;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  setProfileField: (field: keyof UserProfile, value: any) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Determine role based on email as requested
  const getRoleFromEmail = (email: string | null): UserRole => {
    if (!email) return "PLAYER";
    const emailLower = email.toLowerCase().trim();
    if (emailLower === "seshuvakada1234@gmail.com" || emailLower === "resumepro.ads@gmail.com") {
      return "admin";
    } else if (emailLower === "seshuvakada522@gmail.com") {
      return "BROADCAST_ADMIN";
    } else if (emailLower === "seshuvakada5@gmail.com") {
      return "STREAM_CLIENT";
    }
    return "PLAYER";
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          setUser(firebaseUser);

          // Determine correct role based on the email
          const currentRole = getRoleFromEmail(firebaseUser.email);
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const docSnap = await getDoc(userDocRef);

          let finalProfile: UserProfile;

          if (docSnap.exists()) {
            const data = docSnap.data();
            // If the role isn't matched up (e.g. email role changed or was created differently),
            // update it to match the strict email assignment logic
            if (data.role !== currentRole) {
              const updatedData = {
                ...data,
                role: currentRole,
                name: data.name || firebaseUser.displayName || "Racer",
                photoURL: data.photoURL || firebaseUser.photoURL || "",
              };
              await setDoc(userDocRef, updatedData, { merge: true });
              finalProfile = {
                uid: firebaseUser.uid,
                name: updatedData.name,
                email: firebaseUser.email || "",
                photoURL: updatedData.photoURL,
                role: currentRole,
                createdAt: data.createdAt,
              };
            } else {
              finalProfile = {
                uid: firebaseUser.uid,
                name: data.name || firebaseUser.displayName || "Racer",
                email: firebaseUser.email || "",
                photoURL: data.photoURL || firebaseUser.photoURL || "",
                role: data.role as UserRole,
                createdAt: data.createdAt,
              };
            }
          } else {
            // Document does not exist, create it inside Firestore
            const initialProfile = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || "Racer",
              email: firebaseUser.email || "",
              photoURL: firebaseUser.photoURL || "",
              role: currentRole,
              createdAt: serverTimestamp(),
            };
            await setDoc(userDocRef, initialProfile);
            finalProfile = {
              ...initialProfile,
              createdAt: new Date(),
            };
          }

          setProfile(finalProfile);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        console.error("Error synchronizing auth user profile:", error);
        if (firebaseUser) {
          handleFirestoreError(error, OperationType.GET, "users/" + firebaseUser.uid);
        } else {
          handleFirestoreError(error, OperationType.GET, "users");
        }
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Failed to log in with Google:", e);
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
    <AuthContext.Provider value={{ user, profile, loading, loginWithGoogle, logout, setProfileField }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
