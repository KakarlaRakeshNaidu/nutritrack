import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { estimateNutrition } from "../src/api/nutrition";
import { MealForm } from "../src/components/MealForm";
import type {
  MealPayload,
  NutritionEstimateResult,
} from "../src/types";
import { emptyMealForm } from "../src/validation/meals";

vi.mock("../src/api/nutrition.js", () => ({
  estimateNutrition: vi.fn(),
  extractNutrition: vi.fn(),
}));

const estimateMock = vi.mocked(estimateNutrition);

function estimate(
  overrides: Partial<NutritionEstimateResult> = {},
): NutritionEstimateResult {
  return {
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
        iron_mg: 0.6,
        potassium_mg: null,
        vitamin_c_mg: null,
        vitamin_d_mcg: null,
      },
    },
    is_estimate: true,
    assumptions: ["Cooked without added fat."],
    clarification: null,
    missing_fields: [],
    ...overrides,
  };
}

function renderForm(
  onSubmit = vi.fn(async (payload: MealPayload) => {
    void payload;
    return null;
  }),
) {
  render(
    <MealForm
      initialValues={emptyMealForm("2026-09-14")}
      today="2026-09-14"
      submitLabel="Save meal"
      onSubmit={onSubmit}
      enableNutritionEstimate
    />,
  );
  return onSubmit;
}

function fillBasics(foodName = "Cooked brown rice"): void {
  fireEvent.change(screen.getByLabelText(/food name/i), {
    target: { value: foodName },
  });
  fireEvent.change(screen.getByLabelText(/consumed quantity/i), {
    target: { value: "150" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("meal-basics nutrition estimation", () => {
  it("waits for explicit click, preserves basics, prefills null/zero, and saves only the meal payload", async () => {
    estimateMock.mockResolvedValue(estimate());
    const onSubmit = renderForm(
      vi.fn(async (payload: MealPayload) => {
        void payload;
        return null;
      }),
    );
    fillBasics();
    expect(estimateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Estimate nutrition" }));
    await screen.findByText("AI-estimated from meal details.");
    expect(estimateMock).toHaveBeenCalledWith(
      {
        food_name: "Cooked brown rice",
        meal_type: "breakfast",
        consumption_date: "2026-09-14",
        consumed_quantity: 150,
        quantity_unit: "g",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByLabelText(/food name/i)).toHaveValue("Cooked brown rice");
    expect(screen.getByLabelText(/calories/i)).toHaveValue(180);
    expect(screen.getByLabelText(/protein/i)).toHaveValue(0);
    expect(screen.getByLabelText(/sodium/i)).toHaveValue(0);
    expect(screen.getByLabelText(/calcium/i)).toHaveValue(null);
    expect(screen.getByText("Cooked without added fat.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0] as MealPayload;
    expect(payload).toMatchObject({
      food_name: "Cooked brown rice",
      consumed_quantity: 150,
      calories_kcal: 180,
      protein_g: 0,
      entry_source: "manual",
      is_estimate: true,
    });
    expect(payload).not.toHaveProperty("provider");
    expect(payload).not.toHaveProperty("assumptions");
    expect(payload).not.toHaveProperty("clarification");
    expect(payload).not.toHaveProperty("missing_fields");
  });

  it("validates basics and confirms before replacing existing nutrition", async () => {
    estimateMock.mockResolvedValue(estimate());
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Estimate nutrition" }));
    expect(
      await screen.findByText(/Complete valid meal basics/i),
    ).toBeInTheDocument();
    expect(estimateMock).not.toHaveBeenCalled();

    fillBasics();
    fireEvent.change(screen.getByLabelText(/calories/i), {
      target: { value: "99" },
    });
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Estimate nutrition" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(estimateMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/calories/i)).toHaveValue(99);
  });

  it("shows clarification without applying nutrition", async () => {
    estimateMock.mockResolvedValue(
      estimate({
        status: "needs_clarification",
        nutrition: {
          calories_kcal: null,
          protein_g: null,
          carbs_g: null,
          fat_g: null,
          micronutrients: {
            sodium_mg: null,
            calcium_mg: null,
            iron_mg: null,
            potassium_mg: null,
            vitamin_c_mg: null,
            vitamin_d_mcg: null,
          },
        },
        assumptions: [],
        clarification: "Which ingredients and serving size are in the curry?",
        missing_fields: [
          "calories_kcal",
          "protein_g",
          "carbs_g",
          "fat_g",
        ],
      }),
    );
    renderForm();
    fillBasics("Curry");
    fireEvent.click(screen.getByRole("button", { name: "Estimate nutrition" }));
    expect(
      await screen.findByText(/Which ingredients and serving size/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/calories/i)).toHaveValue(null);
    expect(screen.getByLabelText(/food name/i)).toHaveValue("Curry");
  });

  it("aborts on basis changes and never overwrites nutrition edited while pending", async () => {
    let resolveFirst: (value: NutritionEstimateResult) => void = () => {};
    estimateMock.mockImplementationOnce(
      (_basics, { signal } = {}) =>
        new Promise((resolve, reject) => {
          resolveFirst = resolve;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    renderForm();
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Estimate nutrition" }));
    await screen.findByRole("button", { name: "Cancel estimation" });
    fireEvent.change(screen.getByLabelText(/food name/i), {
      target: { value: "Steamed brown rice" },
    });
    resolveFirst(estimate());
    await screen.findByText(/canceled because meal basics changed/i);
    expect(screen.getByLabelText(/calories/i)).toHaveValue(null);

    let resolveSecond: (value: NutritionEstimateResult) => void = () => {};
    estimateMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSecond = resolve; }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Estimate nutrition" }));
    fireEvent.change(screen.getByLabelText(/calories/i), {
      target: { value: "77" },
    });
    resolveSecond(estimate());
    await screen.findByText(/Nutrition changed while estimation was pending/i);
    expect(screen.getByLabelText(/calories/i)).toHaveValue(77);
  });

  it("retains totals after basis changes, marks review, and supports cancellation/failure", async () => {
    estimateMock.mockResolvedValueOnce(estimate());
    renderForm();
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Estimate nutrition" }));
    await screen.findByText("AI-estimated from meal details.");
    fireEvent.change(screen.getByLabelText(/consumed quantity/i), {
      target: { value: "300" },
    });
    expect(
      await screen.findByText(/Meal basics changed after estimation/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/calories/i)).toHaveValue(180);

    estimateMock.mockImplementationOnce(
      (_basics, { signal } = {}) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Re-estimate nutrition" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel estimation" }));
    expect(await screen.findByText(/estimation canceled/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/calories/i)).toHaveValue(180);

    estimateMock.mockRejectedValueOnce(new Error("unavailable"));
    fireEvent.click(
      screen.getByRole("button", { name: "Re-estimate nutrition" }),
    );
    expect(
      await screen.findByText(/Nutrition could not be estimated/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/calories/i)).toHaveValue(180);
  });
});
