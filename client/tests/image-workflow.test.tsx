import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import { createMeal } from "../src/api/meals";
import { extractNutrition } from "../src/api/nutrition";
import {
  ImagePicker,
  MAX_IMAGE_BYTES,
  validateImageFile,
} from "../src/components/ImagePicker";
import { getProfile } from "../src/api/profile";
import { MealFromImage } from "../src/pages/MealFromImage";
import type { ExtractionResult, Meal, MealPayload } from "../src/types";

vi.mock("../src/api/nutrition.js", () => ({ extractNutrition: vi.fn() }));
vi.mock("../src/api/meals.js", () => ({
  createMeal: vi.fn(),
  deleteMeal: vi.fn(),
  getMeal: vi.fn(),
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
}));
vi.mock("../src/api/profile.js", () => ({ getProfile: vi.fn() }));

const extractMock = vi.mocked(extractNutrition);
const createMealMock = vi.mocked(createMeal);
const profileMock = vi.mocked(getProfile);

function extraction(
  imageType: "nutrition_label" | "food_plate" = "nutrition_label",
): ExtractionResult {
  const estimate = imageType === "food_plate";
  return {
    provider: "gemini",
    image_type: imageType,
    is_estimate: estimate,
    source_basis: imageType === "nutrition_label" ? "per 100 g" : "one plate",
    assumptions: estimate ? ["one mixed plate", "visible portions"] : [],
    draft: {
      food_name: "Photo meal",
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
  };
}

function saved(payload: MealPayload): Meal {
  return {
    ...payload,
    id: "saved-photo-meal",
    created_at: "2026-09-14T12:00:00.000Z",
    updated_at: "2026-09-14T12:00:00.000Z",
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/meals/from-image"]}>
      <Routes>
        <Route path="/meals/from-image" element={<MealFromImage />} />
        <Route path="/meals/new" element={<p>Manual meal entry</p>} />
        <Route path="/meals" element={<p>Saved meal history</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function chooseFile(
  type = "image/png",
  name = "meal.png",
  contents = "image",
): File {
  const file = new File([contents], name, { type });
  fireEvent.change(screen.getByLabelText("Image file"), {
    target: { files: [file] },
  });
  return file;
}

async function analyze(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Analyze image" }));
  await screen.findByRole("heading", { name: "Review and complete the meal" });
}

beforeEach(() => {
  vi.clearAllMocks();
  profileMock.mockResolvedValue({
    display_name: "Tester",
    timezone: "UTC",
    today: "2026-09-14",
    week_start: "2026-09-14",
    week_end: "2026-09-20",
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:test-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("image file selection", () => {
  it("enforces formats, empty files, and the exact inclusive byte limit", () => {
    expect(validateImageFile(null)).toMatch(/select/i);
    expect(
      validateImageFile(new File([], "empty.png", { type: "image/png" })),
    ).toMatch(/empty/i);
    expect(
      validateImageFile(new File(["x"], "bad.gif", { type: "image/gif" })),
    ).toMatch(/JPEG, PNG, or WebP/i);

    const exact = new File(["x"], "exact.webp", { type: "image/webp" });
    Object.defineProperty(exact, "size", { value: MAX_IMAGE_BYTES });
    expect(validateImageFile(exact)).toBeNull();
    const large = new File(["x"], "large.jpg", { type: "image/jpeg" });
    Object.defineProperty(large, "size", { value: MAX_IMAGE_BYTES + 1 });
    expect(validateImageFile(large)).toMatch(/10,000,000/);
  });

  it("revokes preview URLs on replacement, removal, and unmount", () => {
    const onFileChange = vi.fn(() => true);
    const { rerender, unmount } = render(
      <ImagePicker
        mode="nutrition_label"
        file={new File(["a"], "a.png", { type: "image/png" })}
        onModeChange={() => true}
        onFileChange={onFileChange}
      />,
    );
    rerender(
      <ImagePicker
        mode="nutrition_label"
        file={new File(["b"], "b.png", { type: "image/png" })}
        onModeChange={() => true}
        onFileChange={onFileChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe("image meal workflow", () => {
  it("does not upload on selection and maps label null/zero values into the shared form", async () => {
    extractMock.mockResolvedValue(extraction());
    renderPage();
    const file = chooseFile();
    expect(extractMock).not.toHaveBeenCalled();

    await analyze();
    expect(extractMock).toHaveBeenCalledWith(
      file,
      "nutrition_label",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createMealMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Meal type")).toHaveValue("");
    expect(screen.getByLabelText(/protein/i)).toHaveValue(0);
    expect(screen.getByLabelText(/sodium/i)).toHaveValue(0);
    expect(screen.getByLabelText(/calcium/i)).toHaveValue(null);
    expect(screen.getByRole("button", { name: "Save meal" })).toBeDisabled();
    expect(
      screen.getByRole("complementary", { name: "Extraction guidance" }),
    ).toHaveTextContent(/Fields still needed: meal type/i);
  });

  it("supports plate mode and saves only one ordinary edited meal payload", async () => {
    extractMock.mockResolvedValue(extraction("food_plate"));
    createMealMock.mockImplementation(async (payload) => saved(payload));
    renderPage();
    fireEvent.change(screen.getByLabelText("Image mode"), {
      target: { value: "food_plate" },
    });
    chooseFile("image/webp", "plate.webp");
    await analyze();

    expect(screen.getByText("Plate photo")).toBeInTheDocument();
    expect(screen.getByText("Saved as an estimate.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Meal type"), {
      target: { value: "dinner" },
    });
    fireEvent.change(screen.getByLabelText(/consumed quantity/i), {
      target: { value: "200" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save meal" })).toBeEnabled(),
    );
    const saveButton = screen.getByRole("button", { name: "Save meal" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await screen.findByText("Saved meal history");
    expect(createMealMock).toHaveBeenCalledTimes(1);
    const payload = createMealMock.mock.calls[0]?.[0] as MealPayload;
    expect(payload).toMatchObject({
      meal_type: "dinner",
      consumed_quantity: 200,
      calories_kcal: 250,
      protein_g: 0,
      entry_source: "food_plate",
      is_estimate: true,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "calories_kcal",
      "carbs_g",
      "consumed_quantity",
      "consumption_date",
      "entry_source",
      "fat_g",
      "food_name",
      "is_estimate",
      "meal_type",
      "micronutrients",
      "protein_g",
      "quantity_unit",
    ]);
  });

  it("cancels pending analysis and ignores its stale result", async () => {
    let resolveAnalysis: (value: ExtractionResult) => void = () => {};
    extractMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = resolve;
      }),
    );
    renderPage();
    chooseFile();
    const button = screen.getByRole("button", { name: "Analyze image" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(extractMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }));
    resolveAnalysis(extraction());
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Review and complete the meal" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Ready to analyze when you choose.")).toBeInTheDocument();
  });

  it("confirms dirty replacement and retains edits when reanalysis fails", async () => {
    extractMock
      .mockResolvedValueOnce(extraction())
      .mockRejectedValueOnce(
        new ApiError({ status: 503, code: "AI_PROVIDERS_UNAVAILABLE", message: "Busy." }),
      );
    renderPage();
    chooseFile();
    await analyze();
    const name = screen.getByLabelText("Food name");
    fireEvent.change(name, { target: { value: "My corrected meal" } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Analyze image" }));
    expect(extractMock).toHaveBeenCalledTimes(1);

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Analyze image" }));
    expect(await screen.findByText("Busy.")).toBeInTheDocument();
    expect(name).toHaveValue("My corrected meal");
  });

  it("retains values after failed save and keeps manual entry available", async () => {
    extractMock.mockResolvedValue(extraction());
    createMealMock.mockRejectedValue(
      new ApiError({
        code: "NETWORK_ERROR",
        ambiguous: true,
        message: "Could not confirm the save. Check history before submitting again.",
      }),
    );
    renderPage();
    chooseFile();
    await analyze();
    fireEvent.change(screen.getByLabelText("Meal type"), {
      target: { value: "lunch" },
    });
    fireEvent.change(screen.getByLabelText("Food name"), {
      target: { value: "Keep my edit" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save meal" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));
    expect(
      await screen.findByText(/Could not confirm the save/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Food name")).toHaveValue("Keep my edit");
    expect(screen.getAllByRole("link", { name: "Enter manually" }).length).toBeGreaterThan(0);
  });
});
