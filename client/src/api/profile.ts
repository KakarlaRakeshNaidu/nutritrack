import type { Profile } from "../types";
import { apiRequest } from "./client";

export async function getProfile(
  { signal }: { signal?: AbortSignal } = {},
): Promise<Profile> {
  const response = await apiRequest<{ data: Profile }>("/profile", { signal });
  return response.data;
}

export async function updateProfileDisplayName(displayName: string): Promise<Profile> {
  const response = await apiRequest<{ data: Profile }>("/profile", {
    method: "PUT",
    body: { display_name: displayName },
  });
  return response.data;
}
