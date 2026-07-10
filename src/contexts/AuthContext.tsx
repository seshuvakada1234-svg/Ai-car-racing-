import React, { createContext, useContext, useState, useEffect } from "react";
import { auth, db, googleProvider } from "../lib/firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, User } from "firebase/auth";
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
  trophies?: number;
  keys?: number;
  coins?: number;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginAsGuest: (email?: string) => Promise<void>;
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

  useEffect(() => {
    // Handle redirect sign-in result on mount to complete the Google OAuth flow
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          console.log("Successfully resolved Google redirect sign-in for:", result.user.email);
        }
      })
      .catch((error) => {
        console.error("Error resolving Google redirect sign-in:", error);
      });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          setUser(firebaseUser);

          // Determine correct role based on the email
          const currentRole = getRoleFromEmail(firebaseUser.email);
          const userDocRef = doc(db, "users", firebaseUser.uid);
          
          let finalProfile: UserProfile;

          try {
            const docSnap = await getDoc(userDocRef);

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
                try {
                  await setDoc(userDocRef, updatedData, { merge: true });
                } catch (writeError) {
                  console.warn("Failed to update user profile in Firestore (falling back to memory):", writeError);
                }
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
              try {
                await setDoc(userDocRef, initialProfile);
              } catch (writeError) {
                console.warn("Failed to create user profile in Firestore (falling back to memory):", writeError);
              }
              finalProfile = {
                ...initialProfile,
                createdAt: new Date(),
              };
            }
          } catch (dbError) {
            console.warn("Error reading/writing to Firestore users collection, using fallback local profile:", dbError);
            finalProfile = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || "Racer",
              email: firebaseUser.email || "",
              photoURL: firebaseUser.photoURL || "",
              role: currentRole,
              createdAt: new Date(),
            };
          }

          setProfile(finalProfile);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        console.error("Error in onAuthStateChanged wrapper:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    setLoading(true);
    try {
      // In an iframe-based development preview environment (like AI Studio), 
      // signInWithRedirect will fail or display a 403 because Google's Accounts page
      // blocks rendering inside iframes. signInWithPopup opens a separate tab,
      // avoiding iframe blockades completely on both mobile and desktop.
      console.log("Initiating Google Sign-In with Popup for iframe compatibility...");
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      console.error("Failed to log in with Google:", e);
      setLoading(false);
      throw e;
    }
  };

  const loginAsGuest = async (email: string = "seshuvakada1234@gmail.com") => {
    setLoading(true);
    try {
      const mockUid = "guest-uid-" + Math.floor(Math.random() * 1000000);
      const mockUser = {
        uid: mockUid,
        email: email,
        displayName: "Guest Racer",
        photoURL: "",
      } as any;
      
      setUser(mockUser);
      setProfile({
        uid: mockUid,
        name: "Guest Racer",
        email: email,
        photoURL: "",
        role: getRoleFromEmail(email),
        createdAt: new Date(),
      });
    } catch (e) {
      console.error("Failed to log in as guest:", e);
    } finally {
      setLoading(false);
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
    <AuthContext.Provider value={{ user, profile, loading, loginWithGoogle, loginAsGuest, logout, setProfileField }}>
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
