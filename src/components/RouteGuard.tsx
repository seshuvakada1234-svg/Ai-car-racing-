import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, UserRole } from "../contexts/AuthContext";
import { Compass } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4 font-sans">
        <Compass className="w-12 h-12 text-blue-400 animate-spin" />
        <span className="font-sans font-black text-xs tracking-widest uppercase text-slate-400">
          Loading Session...
        </span>
      </div>
    );
  }

  if (!user || !profile) {
    // Redirect to /login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const role = profile.role;

  // Admins have access to everything. Otherwise, check allowedRoles array.
  const isAllowed = allowedRoles
    ? (role === "admin" || allowedRoles.includes(role))
    : true;

  if (!isAllowed) {
    // Redirect based on actual role
    if (role === "admin") {
      return <Navigate to="/admin" replace />;
    } else if (role === "broadcaster") {
      return <Navigate to="/broadcaster" replace />;
    } else {
      return <Navigate to="/garage" replace />;
    }
  }

  return <>{children}</>;
};

interface PublicRouteProps {
  children: React.ReactNode;
}

export const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4 font-sans">
        <Compass className="w-12 h-12 text-blue-400 animate-spin" />
        <span className="font-sans font-black text-xs tracking-widest uppercase text-slate-400">
          Loading Session...
        </span>
      </div>
    );
  }

  if (user && profile) {
    // Already authenticated, redirect to default path per role
    const role = profile.role;
    if (role === "admin") {
      return <Navigate to="/admin" replace />;
    } else if (role === "broadcaster") {
      return <Navigate to="/broadcaster" replace />;
    } else {
      return <Navigate to="/garage" replace />;
    }
  }

  return <>{children}</>;
};
