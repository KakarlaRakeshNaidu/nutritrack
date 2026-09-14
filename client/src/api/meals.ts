import type { Meal, MealListParameters, MealListResponse, MealPayload } from "../types";
import { apiRequest, queryString } from "./client";

export async function listMeals(
  parameters: MealListParameters = {},
  { signal }: { signal?: AbortSignal } = {},
): Promise<MealListResponse> {
  return apiRequest<MealListResponse>(
    "/meals" + queryString(parameters),
    { signal },
  );
}

export async function getMeal(
  id: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Meal> {
  const response = await apiRequest<{ data: Meal }>("/meals/" + encodeURIComponent(id), {
    signal,
  });
  return response.data;
}

export async function createMeal(meal: MealPayload): Promise<Meal> {
  const response = await apiRequest<{ data: Meal }>("/meals", {
    method: "POST",
    body: meal,
  });
  return response.data;
}

export async function updateMeal(id: string, meal: MealPayload): Promise<Meal> {
  const response = await apiRequest<{ data: Meal }>("/meals/" + encodeURIComponent(id), {
    method: "PUT",
    body: meal,
  });
  return response.data;
}

export function deleteMeal(id: string): Promise<null> {
  return apiRequest<null>("/meals/" + encodeURIComponent(id), {
    method: "DELETE",
  });
}
