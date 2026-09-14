import type { Goals, PersistedGoals } from "../types";
import { apiRequest } from "./client";

export async function getGoals(
  { signal }: { signal?: AbortSignal } = {},
): Promise<PersistedGoals> {
  const response = await apiRequest<{ data: PersistedGoals }>("/goals", {
    signal,
  });
  return response.data;
}

export async function updateGoals(goals: Goals): Promise<PersistedGoals> {
  const response = await apiRequest<{ data: PersistedGoals }>("/goals", {
    method: "PUT",
    body: goals,
  });
  return response.data;
}
