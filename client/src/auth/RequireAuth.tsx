import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="content-shell centered-page"><p>Loading your session…</p></main>;
  if (!user) return <Navigate to="/login" replace state={{ returnTo: location.pathname + location.search }} />;
  return <Outlet />;
}
