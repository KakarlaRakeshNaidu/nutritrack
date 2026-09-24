import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { getProfile, updateProfileDisplayName } from "../api/profile";
import { useAuth } from "../auth/AuthContext";
import { ErrorMessage, LoadingState, StatusMessage } from "../components/UiState";
import type { Profile as ProfileData } from "../types";

function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.slice(0, 2) ?? "NT").toUpperCase();
}

export function Profile() {
  const { user, setDisplayName, logout } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getProfile({ signal: controller.signal })
      .then((loaded) => {
        setProfile(loaded);
        setName(loaded.display_name);
      })
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError(requestError instanceof Error ? requestError : new Error("Your profile could not be loaded."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const initials = useMemo(() => profileInitials(profile?.display_name ?? user?.email ?? "NutriTrack"), [profile?.display_name, user?.email]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setStatus("");
    try {
      const saved = await updateProfileDisplayName(name);
      setProfile(saved);
      setName(saved.display_name);
      setDisplayName(saved.display_name);
      setStatus("Profile name saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : new Error("Your profile could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <main className="content-shell profile-page">
      {loading && <LoadingState message="Loading your profile..." />}
      {!loading && error && !profile && <ErrorMessage error={error} title="Profile unavailable" />}
      {!loading && profile && (
        <>
          <section className="profile-summary" aria-labelledby="profile-title">
            <div className="profile-avatar" aria-hidden="true">{initials}</div>
            <div className="profile-summary-copy">
              <p className="eyebrow">Account settings</p>
              <h1 id="profile-title">Profile settings</h1>
              <p>{profile.display_name}</p>
              <span>{user?.email}</span>
            </div>
            <span className="account-status"><span aria-hidden="true" /> Active account</span>
          </section>

          <StatusMessage>{status}</StatusMessage>
          {error && <ErrorMessage error={error} title="Could not save profile" />}

          <div className="profile-settings-grid">
            <section className="settings-card" aria-labelledby="personal-info-title">
              <header className="settings-card-header">
                <div>
                  <p className="eyebrow">Personal information</p>
                  <h2 id="personal-info-title">Your details</h2>
                </div>
                <p>Manage how your identity appears throughout NutriTrack.</p>
              </header>

              <form className="profile-form" onSubmit={save}>
                <label className="form-field">
                  <span>Display name</span>
                  <input
                    name="display_name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={100}
                    autoComplete="name"
                  />
                </label>

                <div className="profile-detail-field">
                  <span className="profile-detail-label">Email address</span>
                  <strong>{user?.email}</strong>
                  <small>This is your sign-in email. Email verification and email changes are not currently available.</small>
                </div>

                <div className="profile-detail-row">
                  <div className="profile-detail-field">
                    <span className="profile-detail-label">Timezone</span>
                    <strong>{profile.timezone}</strong>
                    <small>Used for diary dates, reports, and today's date.</small>
                  </div>
                  <div className="profile-detail-field">
                    <span className="profile-detail-label">Current local date</span>
                    <strong>{profile.today}</strong>
                    <small>Calculated using your saved timezone.</small>
                  </div>
                </div>

                <div className="form-actions">
                  <button className="button primary" type="submit" disabled={saving || name.trim().length === 0 || name.trim() === profile.display_name}>
                    {saving ? "Saving&" : "Save changes"}
                  </button>
                </div>
              </form>
            </section>

            <aside className="settings-card account-actions-card" aria-labelledby="account-actions-title">
              <header className="settings-card-header">
                <div>
                  <p className="eyebrow">Account</p>
                  <h2 id="account-actions-title">Account actions</h2>
                </div>
              </header>
              <div className="signout-panel">
                <div>
                  <strong>Sign out of NutriTrack</strong>
                  <p>End this browser session. Your saved meals and goals remain secure in your account.</p>
                </div>
                <button className="button danger" type="button" disabled={signingOut} onClick={() => void signOut()}>
                  {signingOut ? "Signing out&" : "Sign out"}
                </button>
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
