import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import type {
  Goals,
  Meal,
  MealPayload,
  PersistedGoals,
} from "../src/types";
import { GoalForm } from "../src/components/GoalForm";
import { MealForm } from "../src/components/MealForm";
import {
  emptyMealForm,
  mealToFormValues,
} from "../src/validation/meals";
import { goalsToFormValues } from "../src/validation/goals";

function meal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "70a2071d-5cb8-4f15-b6f6-9ed632462bef",
    food_name: "Existing plate",
    meal_type: "dinner",
    consumption_date: "2026-09-12",
    consumed_quantity: 150,
    quantity_unit: "g",
    calories_kcal: 180,
    protein_g: 9,
    carbs_g: 27,
    fat_g: 3,
    micronutrients: {
      sodium_mg: 0,
      calcium_mg: null,
      iron_mg: null,
      potassium_mg: null,
      vitamin_c_mg: null,
      vitamin_d_mcg: null,
    },
    entry_source: "food_plate",
    is_estimate: true,
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T01:00:00.000Z",
    ...overrides,
  };
}

function fillRequiredMeal(): void {
  fireEvent.change(screen.getByLabelText(/food name/i), {
    target: { value: "Test yogurt" },
  });
  fireEvent.change(screen.getByLabelText(/consumed quantity/i), {
    target: { value: "150" },
  });
  fireEvent.change(screen.getByLabelText(/calories/i), {
    target: { value: "180" },
  });
  fireEvent.change(screen.getByLabelText(/protein/i), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText(/carbohydrates/i), {
    target: { value: "27.5" },
  });
  fireEvent.change(screen.getByLabelText(/^fat/i), {
    target: { value: "3" },
  });
}

describe("MealForm", () => {
  it("submits a complete manual payload with blank micros null and zero retained", async () => {
    const onSubmit = vi.fn(async (payload: MealPayload): Promise<Meal> => ({
      ...meal(),
      ...payload,
      id: "saved-id",
    }));
    render(
      <MealForm
        initialValues={emptyMealForm("2026-09-12")}
        today="2026-09-12"
        submitLabel="Save meal"
        onSubmit={onSubmit}
      />,
    );

    fillRequiredMeal();
    fireEvent.change(screen.getByLabelText(/sodium/i), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      food_name: "Test yogurt",
      consumed_quantity: 150,
      calories_kcal: 180,
      protein_g: 0,
      entry_source: "manual",
      is_estimate: false,
      micronutrients: {
        sodium_mg: 0,
        calcium_mg: null,
      },
    });
    expect(Object.keys(onSubmit.mock.calls[0][0].micronutrients)).toHaveLength(6);
  });

  it("keeps edited totals independent and retains loaded provenance", async () => {
    const onSubmit = vi.fn(
      async (payload: MealPayload): Promise<Meal> => ({ ...meal(), ...payload }),
    );
    render(
      <MealForm
        initialValues={mealToFormValues(meal())}
        today="2026-09-12"
        submitLabel="Save meal changes"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText(/consumed quantity/i), {
      target: { value: "300" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save meal changes" }),
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      consumed_quantity: 300,
      calories_kcal: 180,
      entry_source: "food_plate",
      is_estimate: true,
    });
  });

  it("preserves inputs and maps backend field errors", async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Please correct the highlighted fields.",
        details: [
          {
            field: "micronutrients.sodium_mg",
            message: "Sodium is invalid.",
          },
        ],
      }),
    );
    render(
      <MealForm
        initialValues={mealToFormValues(meal())}
        today="2026-09-12"
        submitLabel="Save meal changes"
        onSubmit={onSubmit}
      />,
    );
    const sodium = screen.getByLabelText(/sodium/i);
    fireEvent.change(sodium, { target: { value: "12" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save meal changes" }),
    );

    expect(await screen.findByText("Sodium is invalid.")).toBeInTheDocument();
    expect(sodium).toHaveValue(12);
  });

  it("prevents rapid duplicate submission while one save is pending", async () => {
    let finish: (value: Meal) => void = () => {};
    const pending = new Promise<Meal>((resolve) => {
      finish = resolve;
    });
    const onSubmit = vi.fn((): Promise<Meal> => pending);
    render(
      <MealForm
        initialValues={mealToFormValues(meal({ entry_source: "manual", is_estimate: false }))}
        today="2026-09-12"
        submitLabel="Save meal"
        onSubmit={onSubmit}
      />,
    );
    const button = screen.getByRole("button", { name: "Save meal" });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    finish(meal());
  });
});

describe("GoalForm", () => {
  it("sets goals with explicit zero and all other blank values as null", async () => {
    const initial = goalsToFormValues({
      daily_calories_kcal: null,
      daily_protein_g: null,
      daily_carbs_g: null,
      daily_fat_g: null,
      target_weight_kg: null,
    });
    const onSubmit = vi.fn(
      async (payload: Goals): Promise<PersistedGoals> => ({
      ...payload,
      updated_at: "2026-09-13T00:00:00.000Z",
      }),
    );
    render(<GoalForm initialValues={initial} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/daily protein/i), {
      target: { value: "0" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save current targets" }),
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      daily_calories_kcal: null,
      daily_protein_g: 0,
      daily_carbs_g: null,
      daily_fat_g: null,
      target_weight_kg: null,
    });
  });

  it("clears every target and preserves failed edits", async () => {
    const initial = goalsToFormValues({
      daily_calories_kcal: 2200,
      daily_protein_g: 100,
      daily_carbs_g: 250,
      daily_fat_g: 70,
      target_weight_kg: 72,
    });
    const clearSubmit = vi.fn(
      async (payload: Goals): Promise<PersistedGoals> => ({
      ...payload,
      updated_at: "2026-09-13T00:00:00.000Z",
      }),
    );
    const { unmount } = render(
      <GoalForm initialValues={initial} onSubmit={clearSubmit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all fields" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save current targets" }),
    );
    await waitFor(() => expect(clearSubmit).toHaveBeenCalledTimes(1));
    expect(Object.values(clearSubmit.mock.calls[0][0])).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);

    unmount();
    const failing = vi.fn<() => Promise<Goals>>().mockRejectedValue(
      new ApiError({
        code: "NETWORK_ERROR",
        ambiguous: true,
        message: "Could not confirm the save. Check history before submitting again.",
      }),
    );
    render(<GoalForm initialValues={initial} onSubmit={failing} />);
    const calories = screen.getByLabelText(/daily calories/i);
    fireEvent.change(calories, { target: { value: "2300" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save current targets" }),
    );
    expect(
      await screen.findByText(
        "Could not confirm the save. Check history before submitting again.",
      ),
    ).toBeInTheDocument();
    expect(calories).toHaveValue(2300);
  });
});
