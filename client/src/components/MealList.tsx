import { Link } from "react-router-dom";

import type { EntrySource, Meal } from "../types";
import { displayDateOnly } from "../utils/dates";
import { ENTRY_SOURCES, MICRONUTRIENTS } from "../utils/nutrition";

function displayAmount(value: number | null, unit: string): string {
  return value === null ? "Unknown" : value + " " + unit;
}

function sourceLabel(value: EntrySource): string {
  return ENTRY_SOURCES.find((source) => source.value === value)?.label ?? value;
}

export function MealList({
  meals,
  deletingId,
  onDelete,
}: {
  meals: Meal[];
  deletingId: string | null;
  onDelete: (meal: Meal) => void;
}) {
  return (
    <div className="meal-list" aria-label="Saved meals">
      {meals.map((meal) => (
        <article className="meal-card" key={meal.id}>
          <div className="meal-card-heading">
            <div>
              <p className="meal-meta">
                <time dateTime={meal.consumption_date}>
                  {displayDateOnly(meal.consumption_date)}
                </time>
                <span>{meal.meal_type}</span>
              </p>
              <h2>{meal.food_name}</h2>
              <p>
                {meal.consumed_quantity} {meal.quantity_unit}
              </p>
            </div>
            {meal.is_estimate && (
              <span className="estimate-badge">Estimated values</span>
            )}
          </div>

          <dl className="nutrition-summary">
            <div>
              <dt>Calories</dt>
              <dd>{meal.calories_kcal} kcal</dd>
            </div>
            <div>
              <dt>Protein</dt>
              <dd>{meal.protein_g} g</dd>
            </div>
            <div>
              <dt>Carbohydrates</dt>
              <dd>{meal.carbs_g} g</dd>
            </div>
            <div>
              <dt>Fat</dt>
              <dd>{meal.fat_g} g</dd>
            </div>
          </dl>

          <details>
            <summary>Micronutrients and source</summary>
            <dl className="detail-list">
              {MICRONUTRIENTS.map((nutrient) => (
                <div key={nutrient.name}>
                  <dt>{nutrient.label}</dt>
                  <dd>
                    {displayAmount(
                      meal.micronutrients[nutrient.name],
                      nutrient.unit,
                    )}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Source</dt>
                <dd>{sourceLabel(meal.entry_source)}</dd>
              </div>
              <div>
                <dt>Estimate</dt>
                <dd>{meal.is_estimate ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </details>

          <div className="button-row">
            <Link className="button secondary" to={"/meals/" + meal.id + "/edit"}>
              Edit
            </Link>
            <button
              className="button danger"
              type="button"
              disabled={deletingId === meal.id}
              onClick={() => onDelete(meal)}
            >
              {deletingId === meal.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
