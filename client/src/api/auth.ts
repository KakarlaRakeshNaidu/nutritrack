import { apiRequest } from "./client";

export interface AuthUser { id: string; email: string }
interface AuthEnvelope { data: { user: AuthUser } }

export async function currentSession(signal?: AbortSignal): Promise<AuthUser> {
  return (await apiRequest<AuthEnvelope>("/auth/me", { signal })).data.user;
}
export async function login(email: string, password: string): Promise<AuthUser> {
  return (await apiRequest<AuthEnvelope>("/auth/login", { method: "POST", body: { email, password } })).data.user;
}
export async function signup(email: string, password: string): Promise<AuthUser> {
  return (await apiRequest<AuthEnvelope>("/auth/signup", { method: "POST", body: { email, password } })).data.user;
}
export async function logout(): Promise<void> {
  await apiRequest("/auth/logout", { method: "POST" });
}
