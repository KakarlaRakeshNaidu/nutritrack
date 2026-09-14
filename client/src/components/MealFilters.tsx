import { useEffect, useState, type FormEvent } from "react";

import type { MealType } from "../types";
import { isValidDateOnly } from "../utils/dates";
import { MEAL_TYPES } from "../utils/nutrition";

export interface MealFilterDraft {
  start_date: string;
  end_date: string;
  meal_type: MealType | "";
}

interface MealFiltersProps {
  filters: Partial<MealFilterDraft>;
  onApply: (filters: MealFilterDraft) => void;
  onReset: () => void;
}

type MealFilterField = keyof MealFilterDraft;

export function MealFilters({ filters, onApply, onReset }: MealFiltersProps) {
  const [draft, setDraft] = useState<MealFilterDraft>({
    start_date: filters.start_date ?? "",
    end_date: filters.end_date ?? "",
    meal_type: filters.meal_type ?? "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft({
      start_date: filters.start_date ?? "",
      end_date: filters.end_date ?? "",
      meal_type: filters.meal_type ?? "",
    });
  }, [filters.start_date, filters.end_date, filters.meal_type]);

  function update<Field extends MealFilterField>(
    field: Field,
    value: MealFilterDraft[Field],
  ): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (
      (draft.start_date && !isValidDateOnly(draft.start_date)) ||
      (draft.end_date && !isValidDateOnly(draft.end_date))
    ) {
      setError("Enter real dates in YYYY-MM-DD format.");
      return;
    }
    if (
      draft.start_date &&
      draft.end_date &&
      draft.start_date > draft.end_date
    ) {
      setError("End date must be on or after start date.");
      return;
    }

    setError("");
    onApply(draft);
  }

  return (
    <form className="filter-card" onSubmit={submit} aria-label="Meal filters">
      <div className="filter-grid">
        <label>
          Start date
          <input
            type="date"
            value={draft.start_date}
            onChange={(event) => update("start_date", event.target.value)}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={draft.end_date}
            onChange={(event) => update("end_date", event.target.value)}
          />
        </label>
        <label>
          Meal type
          <select
            value={draft.meal_type}
            onChange={(event) =>
              update("meal_type", event.target.value as MealType | "")
            }
          >
            <option value="">All</option>
            {MEAL_TYPES.map((mealType) => (
              <option key={mealType.value} value={mealType.value}>
                {mealType.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="field-error filter-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="button primary" type="submit">
          Apply filters
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setError("");
            onReset();
          }}
        >
          Reset
        </button>
      </div>
    </form>
  );
}
