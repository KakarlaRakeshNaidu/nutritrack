import { afterEach, describe, expect, it, vi } from "vitest";

import { estimateNutrition, extractNutrition } from "../src/api/nutrition";

function result(imageType: "nutrition_label" | "food_plate") {
  const estimate = imageType === "food_plate";
  return {
    data: {
      provider: "gemini",
      image_type: imageType,
      is_estimate: estimate,
      source_basis: "one visible amount",
      assumptions: estimate ? ["one plate"] : [],
      draft: {
        food_name: "Test meal",
        meal_type: null,
        consumption_date: "2026-09-14",
        consumed_quantity: 100,
        quantity_unit: "g",
        calories_kcal: 250,
        protein_g: 0,
        carbs_g: 30,
        fat_g: 8,
        micronutrients: {
          sodium_mg: 0,
          calcium_mg: null,
          iron_mg: null,
          potassium_mg: null,
          vitamin_c_mg: null,
          vitamin_d_mcg: null,
        },
        entry_source: imageType,
        is_estimate: estimate,
      },
      missing_fields: ["meal_type"],
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("meal-basics estimation API", () => {
  const basics = {
    food_name: "Cooked brown rice",
    meal_type: "lunch" as const,
    consumption_date: "2026-09-14",
    consumed_quantity: 150,
    quantity_unit: "g" as const,
  };
  const response = {
    data: {
      provider: "gemini",
      status: "ok",
      nutrition: {
        calories_kcal: 180,
        protein_g: 0,
        carbs_g: 38,
        fat_g: 1.5,
        micronutrients: {
          sodium_mg: 0,
          calcium_mg: null,
          iron_mg: null,
          potassium_mg: null,
          vitamin_c_mg: null,
          vitamin_d_mcg: null,
        },
      },
      is_estimate: true,
      assumptions: [],
      clarification: null,
      missing_fields: [],
    },
  };

  it("sends one exact JSON request and validates the normalized response", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test/api/v1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(estimateNutrition(basics)).resolves.toMatchObject({
      provider: "gemini",
      is_estimate: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/nutrition/estimate");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(options.body))).toEqual(basics);

    const invalid = structuredClone(response);
    invalid.data.nutrition.calories_kcal = "180" as unknown as number;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalid), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(estimateNutrition(basics)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("aborts text estimation on timeout and preserves caller cancellation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      ),
    );
    const timedOut = estimateNutrition(basics, { timeoutMs: 5 });
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(5);
    await timeoutAssertion;

    vi.useRealTimers();
    const controller = new AbortController();
    const cancelled = estimateNutrition(basics, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("nutrition extraction API", () => {
  it.each(["nutrition_label", "food_plate"] as const)(
    "sends exactly image and image_type for %s without a manual multipart header",
    async (imageType) => {
      vi.stubEnv("VITE_API_BASE_URL", "http://api.test/api/v1");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(result(imageType)), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const file = new File(["image"], "meal.png", { type: "image/png" });

      await expect(extractNutrition(file, imageType)).resolves.toMatchObject({
        provider: "gemini",
        image_type: imageType,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://api.test/api/v1/nutrition/extract");
      expect(options.method).toBe("POST");
      expect(options.headers).toBeUndefined();
      expect(options.body).toBeInstanceOf(FormData);
      const entries = [...(options.body as FormData).entries()];
      expect(entries.map(([key]) => key)).toEqual(["image", "image_type"]);
      expect(entries[0]?.[1]).toBe(file);
      expect(entries[1]?.[1]).toBe(imageType);
    },
  );

  it("aborts the underlying fetch at the client timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      ),
    );
    const pending = extractNutrition(
      new File(["x"], "x.jpg", { type: "image/jpeg" }),
      "nutrition_label",
      { timeoutMs: 5 },
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      message: expect.stringContaining("60 seconds"),
    });
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
  });

  it("preserves caller cancellation and rejects inconsistent response provenance", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      ),
    );
    const cancelled = extractNutrition(
      new File(["x"], "x.webp", { type: "image/webp" }),
      "food_plate",
      { signal: controller.signal },
    );
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const invalid = result("nutrition_label");
    invalid.data.draft.entry_source = "food_plate";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalid), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(
      extractNutrition(
        new File(["x"], "x.png", { type: "image/png" }),
        "nutrition_label",
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
