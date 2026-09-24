import type { DatabaseExecutor } from "../../types.js";

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
}

function mapUser(row: Record<string, unknown> | undefined): AuthUser | null {
  if (!row || typeof row.id !== "string" || typeof row.email_normalized !== "string" || typeof row.password_hash !== "string") return null;
  return { id: row.id, email: row.email_normalized, passwordHash: row.password_hash };
}

export async function findLoginUser(executor: DatabaseExecutor, email: string): Promise<AuthUser | null> {
  const result = await executor.query({
    text: "SELECT id, email_normalized, password_hash FROM nutritrack_users WHERE email_normalized = $1 AND is_legacy = false",
    values: [email],
  });
  return mapUser(result.rows[0]);
}

export async function insertUser(executor: DatabaseExecutor, email: string, passwordHash: string): Promise<AuthUser> {
  const result = await executor.query({
    text: "INSERT INTO nutritrack_users (email_normalized, password_hash) VALUES ($1, $2) RETURNING id, email_normalized, password_hash",
    values: [email, passwordHash],
  });
  const user = mapUser(result.rows[0]);
  if (!user) throw new TypeError("Created user row is invalid.");
  await executor.query({
    text: "INSERT INTO tracker_profile (user_id, display_name, timezone) VALUES ($1, $2, $3)",
    values: [user.id, email.split("@")[0].slice(0, 100) || "Personal user", "Asia/Kolkata"],
  });
  await executor.query({ text: "INSERT INTO goals (user_id) VALUES ($1)", values: [user.id] });
  return user;
}

export async function insertSession(executor: DatabaseExecutor, input: {
  id: string; userId: string; tokenHash: string; expiresAt: Date;
}): Promise<void> {
  await executor.query({
    text: "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    values: [input.id, input.userId, input.tokenHash, input.expiresAt],
  });
}

export async function findActiveSession(executor: DatabaseExecutor, input: {
  id: string; userId: string; tokenHash: string;
}): Promise<boolean> {
  const result = await executor.query({
    text: "SELECT 1 FROM auth_sessions WHERE id = $1 AND user_id = $2 AND token_hash = $3 AND revoked_at IS NULL AND expires_at > now()",
    values: [input.id, input.userId, input.tokenHash],
  });
  return result.rowCount === 1;
}

export async function revokeSession(executor: DatabaseExecutor, tokenHash: string): Promise<void> {
  await executor.query({
    text: "UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    values: [tokenHash],
  });
}
