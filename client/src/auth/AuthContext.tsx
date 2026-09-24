import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { currentSession, logout as requestLogout, type AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import { getProfile } from "../api/profile";

interface AuthState {
  user: AuthUser | null;
  displayName: string | null;
  loading: boolean;
  finishAuthentication(user: AuthUser, returnTo: string): void;
  setDisplayName(displayName: string): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function safeReturnPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSession() {
      try {
        const sessionUser = await currentSession(controller.signal);
        if (controller.signal.aborted) return;
        setUser(sessionUser);
        try {
          const profile = await getProfile({ signal: controller.signal });
          if (!controller.signal.aborted) setDisplayName(profile.display_name);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.error("Profile name lookup failed.");
          }
        }
      } catch (error) {
        if (
          !(error instanceof ApiError && error.status === 401) &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          console.error("Session lookup failed.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadSession();
    const expired = () => {
      setUser(null);
      setDisplayName(null);
    };
    window.addEventListener("nutritrack:unauthorized", expired);
    return () => {
      controller.abort();
      window.removeEventListener("nutritrack:unauthorized", expired);
    };
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    displayName,
    loading,
    finishAuthentication(nextUser, returnTo) {
      setUser(nextUser);
      setDisplayName(null);
      navigate(safeReturnPath(returnTo), { replace: true });
    },
    setDisplayName,
    async logout() {
      try {
        await requestLogout();
      } finally {
        setUser(null);
        setDisplayName(null);
        navigate("/login", { replace: true });
      }
    },
  }), [user, displayName, loading, navigate]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing.");
  return value;
}
