import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import { getGoals, updateGoals } from "../src/api/goals";
import { deleteMeal, listMeals } from "../src/api/meals";
import { Goals } from "../src/pages/Goals";
import type { Goals as GoalValues, Meal, MealListResponse } from "../src/types";
import { MealHistory } from "../src/pages/MealHistory";

vi.mock("../src/api/meals.js", () => ({
  deleteMeal: vi.fn(),
  listMeals: vi.fn(),
  getMeal: vi.fn(),
  createMeal: vi.fn(),
  updateMeal: vi.fn(),
}));

vi.mock("../src/api/goals.js", () => ({
  getGoals: vi.fn(),
  updateGoals: vi.fn(),
}));
const deleteMealMock = vi.mocked(deleteMeal);
const getGoalsMock = vi.mocked(getGoals);
const listMealsMock = vi.mocked(listMeals);
const updateGoalsMock = vi.mocked(updateGoals);

function meal(id: string, name = "History meal"): Meal {
  return {
    id,
    food_name: name,
    meal_type: "lunch",
    consumption_date: "2026-09-12",
    consumed_quantity: 1,
    quantity_unit: "serving",
    calories_kcal: 250,
    protein_g: 10,
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
    entry_source: "manual",
    is_estimate: false,
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function HistoryWithNavigation() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => navigate("/meals?meal_type=dinner")}
      >
        Switch query
      </button>
      <MealHistory />
      <LocationProbe />
    </>
  );
}

function renderHistory(entry: string, element: ReactElement = <MealHistory />) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/meals"
          element={
            <>
              {element}
              <LocationProbe />
            </>
          }
        />
        <Route path="/meals/new" element={<p>New meal route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function page(
  items: Meal[],
  current = 1,
  totalItems = items.length,
  totalPages = 1,
): MealListResponse {
  return {
    items,
    pagination: {
      page: current,
      page_size: 20,
      total_items: totalItems,
      total_pages: totalPages,
    },
  };
}

describe("meal history workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores URL state, preserves filters across pages, and resets page on apply", async () => {
    listMealsMock.mockImplementation(async (parameters = {}) =>
      page(
        [
          meal(
            String(parameters.page ?? 1),
            "Meal page " + (parameters.page ?? 1),
          ),
        ],
        parameters.page ?? 1,
        25,
        2,
      ),
    );
    renderHistory("/meals?meal_type=lunch&page=2");

    expect(await screen.findByText("Meal page 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() =>
      expect(listMealsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ meal_type: "lunch", page: 1 }),
        expect.any(Object),
      ),
    );

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Meal type"), {
      target: { value: "dinner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() =>
      expect(listMealsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          start_date: "2026-09-01",
          meal_type: "dinner",
          page: 1,
        }),
        expect.any(Object),
      ),
    );
    expect(screen.getByTestId("location").textContent).toContain(
      "start_date=2026-09-01",
    );
    expect(screen.getByTestId("location").textContent).not.toContain("page=");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listMealsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ meal_type: "dinner", page: 2 }),
        expect.any(Object),
      ),
    );
  });

  it("shows a reset path for invalid URLs without issuing a request", async () => {
    renderHistory("/meals?page=0&owner=1");
    expect(
      await screen.findByText(/history URL contains unsupported filters/i),
    ).toBeInTheDocument();
    expect(listMealsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(listMealsMock).toHaveBeenCalledTimes(1));
  });

  it("prevents a late old response from replacing newer filtered results", async () => {
    let resolveOld: (value: MealListResponse) => void = () => {};
    const oldResponse = new Promise<MealListResponse>((resolve) => {
      resolveOld = resolve;
    });
    listMealsMock
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(page([meal("new", "Fresh dinner")]));

    render(
      <MemoryRouter initialEntries={["/meals?meal_type=lunch"]}>
        <Routes>
          <Route path="/meals" element={<HistoryWithNavigation />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch query" }));
    expect(await screen.findByText("Fresh dinner")).toBeInTheDocument();

    resolveOld(page([meal("old", "Late lunch")]));
    await waitFor(() =>
      expect(screen.queryByText("Late lunch")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Fresh dinner")).toBeInTheDocument();
  });

  it("confirms deletion, handles 204, and moves an emptied last page", async () => {
    listMealsMock
      .mockResolvedValueOnce(page([meal("delete-me", "Last page meal")], 2, 21, 2))
      .mockResolvedValueOnce(page([], 2, 20, 1))
      .mockResolvedValueOnce(page([meal("remaining", "Remaining meal")], 1, 20, 1));
    deleteMealMock.mockResolvedValue(null);
    vi.mocked(window.confirm)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderHistory("/meals?page=2");

    expect(await screen.findByText("Last page meal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteMealMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteMealMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Remaining meal")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).not.toContain("page=2");
  });

  it("keeps the visible record when deletion fails", async () => {
    listMealsMock.mockResolvedValue(page([meal("kept", "Keep this meal")]));
    deleteMealMock.mockRejectedValue(
      new ApiError({ message: "Deletion could not be confirmed." }),
    );
    renderHistory("/meals");

    expect(await screen.findByText("Keep this meal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("Deletion could not be confirmed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Keep this meal")).toBeInTheDocument();
  });
});

describe("goals workflow", () => {
  it("sets, replaces, and clears the complete current configuration", async () => {
    const allNull: GoalValues = {
      daily_calories_kcal: null,
      daily_protein_g: null,
      daily_carbs_g: null,
      daily_fat_g: null,
      target_weight_kg: null,
    };
    getGoalsMock.mockResolvedValue({
      ...allNull,
      updated_at: "2026-09-13T00:00:00.000Z",
    });
    updateGoalsMock.mockImplementation(async (payload) => ({
      ...payload,
      updated_at: "2026-09-13T01:00:00.000Z",
    }));

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("No current targets are configured."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/daily calories/i), {
      target: { value: "2200" },
    });
    fireEvent.change(screen.getByLabelText(/daily protein/i), {
      target: { value: "0" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save current targets" }),
    );
    expect(
      await screen.findByText("Current targets saved."),
    ).toBeInTheDocument();
    expect(updateGoalsMock).toHaveBeenLastCalledWith({
      ...allNull,
      daily_calories_kcal: 2200,
      daily_protein_g: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear all fields" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save current targets" }),
    );
    await waitFor(() => expect(updateGoalsMock).toHaveBeenCalledTimes(2));
    expect(updateGoalsMock).toHaveBeenLastCalledWith(allNull);
    expect(
      await screen.findByText("All current targets cleared."),
    ).toBeInTheDocument();
  });
});
