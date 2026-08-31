/* eslint-disable react-refresh/only-export-components */
// Auth state and route guards.
//
// The server is the security boundary — every endpoint checks the role on the
// token. These guards are for navigation, so a caregiver never lands on a
// doctor screen that would only 403 at them. Do not mistake them for
// protection: they run in the browser.
//
// The caregiver PIN in db.js stays, but it is now a convenience lock (it stops
// a patient wandering into the dashboard on a shared device), not the boundary.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { clearToken, getMe, getToken } from "./api";

const AuthContext = createContext(null);

const HOME_FOR_ROLE = {
  patient: "/patient",
  caregiver: "/caregiver",
  doctor: "/doctor",
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!getToken()) {
        if (!cancelled) setStatus("ready");
        return;
      }
      try {
        const me = await getMe();
        if (!cancelled) setUser(me);
      } catch {
        // Expired or invalid token — drop it rather than looping on 401s.
        clearToken();
      } finally {
        if (!cancelled) setStatus("ready");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: Boolean(user),
      setUser,
      signOut: () => {
        clearToken();
        setUser(null);
      },
    }),
    [user, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

export function homeForRole(role) {
  return HOME_FOR_ROLE[role] ?? "/login";
}

/**
 * Route wrapper. Renders children only for the listed roles.
 *
 * Sends an authenticated user with the wrong role to their own home rather
 * than to the login screen — being logged in as the wrong person is a
 * different problem from not being logged in, and bouncing them to /login
 * would look like their session broke.
 */
export function RequireRole({ roles, children }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <div className="min-h-screen bg-background" />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  return children;
}
