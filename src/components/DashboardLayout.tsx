import React, { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  Compass,
  Shield,
  Radio,
  User as UserIcon,
  LayoutDashboard,
  Map,
  Car,
  Users,
  BarChart3,
  Tv,
  Video,
  Settings,
  LogOut,
  Trophy,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;
  const isGarageOrRoomUI =
    isMobile ||
    location.pathname === "/garage" ||
    location.pathname === "/rooms" ||
    location.pathname.startsWith("/room/");

  if (isGarageOrRoomUI) {
    return (
      <div
        id="game-ui-viewport"
        className="w-screen h-[100dvh] overflow-hidden bg-black relative m-0 p-0 rounded-none max-w-none shadow-none"
        style={{
          width: "100vw",
          height: "100dvh",
          position: "fixed",
          inset: 0,
          overflow: "hidden",
          background: "black",
          margin: 0,
          padding: 0,
          borderRadius: 0,
          maxWidth: "none",
        }}
      >
        {children}
      </div>
    );
  }

  const isBroadcasterUI = location.pathname.startsWith("/broadcaster");
  if (isBroadcasterUI) {
    return (
      <div className="min-h-screen bg-[#05070B] text-[#E2E8F0] font-sans antialiased overflow-x-hidden">{children}</div>
    );
  }

  const handleSignOut = async () => {
    setProfileDropdownOpen(false);
    setMobileMenuOpen(false);
    await logout();
    navigate("/login");
  };

  const getNavigationLinks = () => {
    if (!profile) return [];

    if (profile.role === "admin") {
      return [
        { path: "/admin", label: "Dashboard", icon: LayoutDashboard },
        { path: "/admin/maps", label: "Maps", icon: Map },
        { path: "/admin/cars", label: "Cars", icon: Car },
        { path: "/admin/rooms", label: "Rooms", icon: Settings },
        { path: "/admin/users", label: "Players", icon: Users },
        { path: "/admin/broadcasters", label: "Broadcasters", icon: Tv },
        { path: "/admin/live-broadcast", label: "Live Broadcast", icon: Radio },
        { path: "/admin/analytics", label: "Analytics", icon: BarChart3 },
        { path: "/admin/settings", label: "Settings", icon: Settings },
      ];
    } else if (profile.role === "broadcaster") {
      return [
        { path: "/broadcaster", label: "Spectator Hub", icon: Tv },
        { path: "/broadcaster/live", label: "Live Desk", icon: Radio },
        { path: "/broadcaster/camera", label: "Camera Rig", icon: Video },
        { path: "/broadcaster/overlay", label: "Overlays", icon: Settings },
      ];
    } else {
      return [
        { path: "/garage", label: "Garage", icon: Car },
        { path: "/rooms", label: "Room Lobby", icon: Users },
        { path: "/profile", label: "My Profile", icon: UserIcon },
        { path: "/leaderboard", label: "Leaderboard", icon: Trophy },
      ];
    }
  };

  const links = getNavigationLinks();

  const getRoleTheme = () => {
    if (!profile) return { text: "text-slate-400", bg: "bg-slate-900", border: "border-slate-800" };
    if (profile.role === "admin")
      return { text: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", label: "Admin" };
    if (profile.role === "broadcaster")
      return { text: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", label: "Broadcaster" };
    return { text: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20 border", label: "Racer" };
  };

  const theme = getRoleTheme();

  if (profile?.role === "admin") {
    return (
      <div className="min-h-screen bg-[#070b19] text-white flex flex-col lg:flex-row font-sans">
        {/* DESKTOP SIDEBAR */}
        <aside className="hidden lg:flex w-64 bg-slate-950 border-r border-slate-900/85 p-6 flex-col justify-between shrink-0 h-screen sticky top-0">
          <div className="space-y-8 overflow-y-auto pr-1">
            {/* Logo */}
            <NavLink to="/" className="flex items-center space-x-2.5 shrink-0">
              <Compass className="w-6 h-6 text-indigo-400 rotate-45 shrink-0" />
              <span className="font-sans font-black text-sm tracking-widest uppercase text-white">ASPHALT GRID</span>
            </NavLink>

            {/* Profile Block */}
            <div className="flex items-center space-x-3 bg-slate-900/40 p-3 rounded-2xl border border-slate-900">
              <img
                src={
                  profile?.photoURL ||
                  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                }
                alt={profile?.name || "Admin"}
                className="w-10 h-10 rounded-full object-cover border border-slate-800"
                referrerPolicy="no-referrer"
              />
              <div className="truncate">
                <p className="text-[11px] font-black uppercase text-white truncate">{profile?.name || "Admin"}</p>
                <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-rose-500/10 border border-rose-500/15 text-rose-400">
                  ADMIN PORTAL
                </span>
              </div>
            </div>

            {/* Navigation Links */}
            <nav className="space-y-1">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.path}
                    to={link.path}
                    end={link.path === "/admin"}
                    className={({ isActive }) =>
                      `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                        isActive
                          ? "bg-slate-900/60 border-slate-800 text-indigo-300 shadow-[0_4px_12px_rgba(99,102,241,0.1)]"
                          : "border-transparent text-slate-400 hover:text-white hover:bg-slate-900/40"
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* Disconnect */}
          <button
            onClick={handleSignOut}
            className="flex items-center space-x-2.5 w-full text-left px-3.5 py-2.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition font-black uppercase border border-transparent hover:border-red-500/10 shrink-0 mt-4"
          >
            <LogOut className="w-4 h-4" />
            <span>DISCONNECT</span>
          </button>
        </aside>

        {/* MOBILE TOPBAR (lg:hidden) */}
        <header className="sticky top-0 z-40 w-full bg-slate-950/85 backdrop-blur-md border-b border-slate-900/80 lg:hidden">
          <div className="px-4 sm:px-6 h-18 flex items-center justify-between">
            <NavLink to="/" className="flex items-center space-x-2.5">
              <Compass className="w-6 h-6 text-indigo-400 rotate-45 shrink-0" />
              <span className="font-sans font-black text-sm tracking-widest uppercase text-white">ASPHALT GRID</span>
            </NavLink>

            <div className="flex items-center space-x-3.5">
              <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${theme.bg} ${theme.text}`}>
                {theme.label}
              </span>
              <img
                src={
                  profile?.photoURL ||
                  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                }
                alt={profile?.name || "Racer Profile"}
                className="w-8 h-8 rounded-full object-cover border border-slate-800"
                referrerPolicy="no-referrer"
              />
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="p-2 bg-slate-900/60 border border-slate-800 text-slate-300 hover:text-white rounded-xl transition"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* MOBILE SLIDE-OUT MENU OVERLAY */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-950 flex flex-col p-6 lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-slate-900 pb-5">
                <div className="flex items-center space-x-2">
                  <Compass className="w-5 h-5 text-indigo-400 rotate-45" />
                  <span className="font-sans font-black text-xs tracking-widest uppercase">ASPHALT CHAMPIONS</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 bg-slate-900/80 border border-slate-805 text-slate-400 hover:text-white rounded-xl transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center space-x-4 py-6 border-b border-slate-900">
                <img
                  src={
                    profile?.photoURL ||
                    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                  }
                  alt={profile?.name}
                  className="w-12 h-12 rounded-full border border-slate-800 object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="text-left">
                  <h4 className="text-sm font-black text-white uppercase">{profile?.name}</h4>
                  <p className="text-[10px] text-slate-500 font-mono">{profile?.email}</p>
                  <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[8.5px] font-black uppercase border ${theme.bg} ${theme.text}`}>
                    {theme.label}
                  </span>
                </div>
              </div>

              <nav className="flex-1 py-8 space-y-2 overflow-y-auto">
                {links.map((link) => {
                  const Icon = link.icon;
                  return (
                    <NavLink
                      key={link.path}
                      to={link.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center space-x-3 px-4 py-3.5 rounded-xl text-xs font-black uppercase tracking-wider border ${
                          isActive
                            ? "bg-slate-900 border-slate-800 text-indigo-300"
                            : "border-transparent text-slate-400 hover:text-white"
                        }`
                      }
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{link.label}</span>
                    </NavLink>
                  );
                })}
              </nav>

              <div className="border-t border-slate-900 pt-5">
                <button
                  onClick={handleSignOut}
                  className="flex items-center justify-center space-x-2 w-full py-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 font-black text-xs tracking-widest rounded-xl transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>TERMINATE SESSION</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* MAIN CONTENT AREA */}
        <main className="flex-1 p-6 md:p-10 lg:h-screen lg:overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b19] text-white flex flex-col font-sans overflow-x-hidden">
      {/* HEADER / NAVIGATION BAR: STICKY TOP */}
      <header className="sticky top-0 z-40 w-full bg-slate-950/85 backdrop-blur-md border-b border-slate-900/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          {/* Logo Left */}
          <div className="flex items-center space-x-8">
            <NavLink to="/" className="flex items-center space-x-2.5">
              <Compass className="w-6 h-6 text-indigo-400 rotate-45 shrink-0" />
              <span className="font-sans font-black text-sm tracking-widest uppercase text-white">ASPHALT GRID</span>
            </NavLink>

            {/* Desktop Navigation Links */}
            <nav className="hidden lg:flex items-center space-x-1">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.path}
                    to={link.path}
                    end={link.path === "/admin" || link.path === "/broadcaster"}
                    className={({ isActive }) =>
                      `flex items-center space-x-2 px-3.5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all border ${
                        isActive
                          ? "bg-slate-900/60 border-slate-800 text-indigo-300 shadow-[0_4px_12px_rgba(99,102,241,0.1)]"
                          : "border-transparent text-slate-400 hover:text-white hover:bg-slate-900/40"
                      }`
                    }
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* Desktop/Laptop Right Actions: Profile Dropdown */}
          <div className="hidden lg:flex items-center space-x-4">
            <span
              className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${theme.bg} ${theme.text}`}
            >
              {theme.label}
            </span>

            <div className="relative">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center space-x-2 p-1 bg-slate-900/40 border border-slate-800 rounded-full hover:border-slate-700 transition"
              >
                <img
                  src={
                    profile?.photoURL ||
                    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                  }
                  alt={profile?.name || "Racer Profile"}
                  className="w-8 h-8 rounded-full object-cover border border-slate-800"
                  referrerPolicy="no-referrer"
                />
                <ChevronDown className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
              </button>

              <AnimatePresence>
                {profileDropdownOpen && (
                  <>
                    {/* Backdrop for easy dismiss clicks */}
                    <div className="fixed inset-0 z-30" onClick={() => setProfileDropdownOpen(false)} />

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 mt-2 w-56 bg-slate-950 border border-slate-900 rounded-2xl shadow-2xl p-2 z-40"
                    >
                      <div className="p-3 border-b border-slate-905">
                        <p className="text-[11px] font-black uppercase text-white truncate">
                          {profile?.name || "Racer"}
                        </p>
                        <p className="text-[9px] text-slate-500 font-mono truncate">{profile?.email || ""}</p>
                      </div>
                      <div className="p-1 mt-1">
                        <button
                          onClick={handleSignOut}
                          className="flex items-center space-x-2.5 w-full text-left px-3.5 py-2.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition font-black uppercase"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Disconnect</span>
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Mobile Navigation Interface (Avatar Right, Hamburger) */}
          <div className="lg:hidden flex items-center space-x-3.5">
            <span
              className={`hidden sm:inline-block px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${theme.bg} ${theme.text}`}
            >
              {theme.label}
            </span>
            <img
              src={
                profile?.photoURL ||
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
              }
              alt={profile?.name || "Racer Profile"}
              className="w-8 h-8 rounded-full object-cover border border-slate-800"
              referrerPolicy="no-referrer"
            />
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 bg-slate-900/60 border border-slate-800 text-slate-300 hover:text-white rounded-xl transition"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* MOBILE SLIDE-OUT FULL-SCREEN MENU */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950 flex flex-col p-6"
          >
            {/* Header section */}
            <div className="flex items-center justify-between border-b border-slate-900 pb-5">
              <div className="flex items-center space-x-2">
                <Compass className="w-5 h-5 text-indigo-400 rotate-45" />
                <span className="font-sans font-black text-xs tracking-widest uppercase">ASPHALT CHAMPIONS</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 bg-slate-900/80 border border-slate-805 text-slate-400 hover:text-white rounded-xl transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Profile block */}
            <div className="flex items-center space-x-4 py-6 border-b border-slate-900">
              <img
                src={
                  profile?.photoURL ||
                  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                }
                alt={profile?.name}
                className="w-12 h-12 rounded-full border border-slate-800 object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="text-left">
                <h4 className="text-sm font-black text-white uppercase">{profile?.name}</h4>
                <p className="text-[10px] text-slate-500 font-mono">{profile?.email}</p>
                <span
                  className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[8.5px] font-black uppercase border ${theme.bg} ${theme.text}`}
                >
                  {theme.label}
                </span>
              </div>
            </div>

            {/* Links section */}
            <nav className="flex-1 py-8 space-y-2 overflow-y-auto">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.path}
                    to={link.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center space-x-3 px-4 py-3.5 rounded-xl text-xs font-black uppercase tracking-wider border ${
                        isActive
                          ? "bg-slate-900 border-slate-800 text-indigo-300"
                          : "border-transparent text-slate-400 hover:text-white"
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            {/* Signout action */}
            <div className="border-t border-slate-900 pt-5">
              <button
                onClick={handleSignOut}
                className="flex items-center justify-center space-x-2 w-full py-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 font-black text-xs tracking-widest rounded-xl transition"
              >
                <LogOut className="w-4 h-4" />
                <span>TERMINATE SESSION</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">{children}</main>
    </div>
  );
};
