import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { login, signup } from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function returnPath(state: unknown): string {
  if (!state || typeof state !== "object" || !("returnTo" in state)) return "/";
  const value = (state as { returnTo?: unknown }).returnTo;
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { user, finishAuthentication } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const nextUser = mode === "signup" ? await signup(email, password) : await login(email, password);
      finishAuthentication(nextUser, returnPath(location.state));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "NETWORK_ERROR"
          ? mode === "signup"
            ? "The authentication service could not be reached. Before retrying signup, try signing in in case the account was created."
            : "The authentication service could not be reached. Check your connection and try again."
          : caught instanceof ApiError
            ? caught.message
            : "The request could not be completed.",
      );
      setBusy(false);
    }
  }

  return <main className="content-shell centered-page">
    <section className="form-card auth-card" aria-labelledby="auth-title">
      <p className="eyebrow">Private nutrition diary</p>
      <h1 id="auth-title">{mode === "signup" ? "Create account" : "Sign in"}</h1>
      <form onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}</button>
      </form>
      <p>{mode === "signup" ? <>Already registered? <Link to="/login">Sign in</Link></> : <>Need an account? <Link to="/signup">Create one</Link></>}</p>
    </section>
  </main>;
}
