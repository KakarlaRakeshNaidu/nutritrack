import type { Profile } from "../types";
import { apiRequest } from "./client";

export async function getProfile(
  { signal }: { signal?: AbortSignal } = {},
): Promise<Profile> {
  const response = await apiRequest<{ data: Profile }>("/profile", { signal });
  return response.data;
}
