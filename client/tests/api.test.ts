import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest } from "../src/api/client";
import type { MealPayload } from "../src/types";
import {
  createMeal,
  deleteMeal,
  getMeal,
  listMeals,
  updateMeal,
} from "../src/api/meals";

function response(
  payload: unknown,
  {
    status = 200,
    contentType = "application/json",
  }: { status?: number; contentType?: string } = {},
): Response {
  return new Response(
    payload === null || typeof payload === "string"
      ? payload
      : JSON.stringify(payload),
    {
      status,
      headers: {
        "Content-Type": contentType,
        "X-Request-ID": "request-123",
      },
    },
  );
}

describe("frontend API boundary", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.example.test/api/v1/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("constructs list and resource URLs without changing pagination metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [],
          pagination: {
            page: 2,
            page_size: 20,
            total_items: 25,
            total_pages: 2,
          },
        }),
      )
      .mockResolvedValueOnce(response({ data: { id: "meal-id" } }));
    vi.stubGlobal("fetch", fetchMock);

    const listed = await listMeals({
      start_date: "2026-09-01",
      meal_type: "lunch",
      page: 2,
      page_size: 20,
    });
    const meal = await getMeal("meal/id");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api.example.test/api/v1/meals?start_date=2026-09-01&meal_type=lunch&page=2&page_size=20",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://api.example.test/api/v1/meals/meal%2Fid",
    );
    expect(listed.pagination).toEqual({
      page: 2,
      page_size: 20,
      total_items: 25,
      total_pages: 2,
    });
    expect(meal).toEqual({ id: "meal-id" });
  });

  it("sets JSON once for create/update and does not retry mutations", async () => {
    const meal: MealPayload = {
      food_name: "Toast",
      meal_type: "breakfast",
      consumption_date: "2026-09-12",
      consumed_quantity: 1,
      quantity_unit: "serving",
      calories_kcal: 120,
      protein_g: 4,
      carbs_g: 20,
      fat_g: 3,
      micronutrients: {
        sodium_mg: null,
        calcium_mg: null,
        iron_mg: null,
        potassium_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      },
      entry_source: "manual",
      is_estimate: false,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { id: "created" } }))
      .mockResolvedValueOnce(response({ data: { id: "updated" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createMeal(meal);
    await updateMeal("abc", meal);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toContain("/meals");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(options.body).toBe(JSON.stringify(meal));
    }
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
  });

  it("accepts 204 without JSON parsing", async () => {
    const noContent = new Response(null, { status: 204 });
    const jsonSpy = vi.spyOn(noContent, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(noContent));

    await expect(deleteMeal("abc")).resolves.toBeNull();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("exposes the safe backend error envelope and request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Correct the fields.",
              details: [{ field: "calories_kcal", message: "Too large." }],
              request_id: "request-body-id",
            },
          },
          { status: 422 },
        ),
      ),
    );

    await expect(createMeal({
      food_name: "Invalid",
      meal_type: "lunch",
      consumption_date: "2026-09-12",
      consumed_quantity: 1,
      quantity_unit: "serving",
      calories_kcal: 1,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
      micronutrients: {
        sodium_mg: null,
        calcium_mg: null,
        iron_mg: null,
        potassium_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      },
      entry_source: "manual",
      is_estimate: false,
    })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "Correct the fields.",
      details: [{ field: "calories_kcal", message: "Too large." }],
      requestId: "request-body-id",
    });
  });

  it("handles proxy and network failures safely without mutation retries", async () => {
    const proxyFetch = vi
      .fn()
      .mockResolvedValue(response("<html>bad gateway</html>", {
        status: 502,
        contentType: "text/html",
      }));
    vi.stubGlobal("fetch", proxyFetch);
    await expect(listMeals()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      message: "The server returned an unexpected response.",
    });

    const networkFetch = vi.fn().mockRejectedValue(new TypeError("private"));
    vi.stubGlobal("fetch", networkFetch);
    await expect(createMeal({
      food_name: "Network test",
      meal_type: "lunch",
      consumption_date: "2026-09-12",
      consumed_quantity: 1,
      quantity_unit: "serving",
      calories_kcal: 1,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
      micronutrients: {
        sodium_mg: null,
        calcium_mg: null,
        iron_mg: null,
        potassium_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      },
      entry_source: "manual",
      is_estimate: false,
    })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      ambiguous: true,
      message: "Could not confirm the save. Check history before submitting again.",
    });
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it("preserves AbortError for stale read cancellation", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(apiRequest("/meals")).rejects.toBe(abort);
    expect(ApiError).toBeTypeOf("function");
  });
});
