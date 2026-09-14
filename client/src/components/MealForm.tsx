import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useForm,
  type FieldError as HookFormFieldError,
  type FieldErrors,
  type FieldPath,
} from "react-hook-form";

import { ApiError } from "../api/client";
import type { Meal, MealPayload } from "../types";

import {
  CORE_NUTRIENTS,
  ENTRY_SOURCES,
  MEAL_TYPES,
  MICRONUTRIENTS,
  QUANTITY_UNITS,
} from "../utils/nutrition";
import {
  mealFormSchema,
  missingRequiredMealFields,
  mealPayload,
  mealToFormValues,
} from "../validation/meals";
import type {
  MealFormInput,
  MealFormOutput,
} from "../validation/meals";


const API_FIELDS = new Set([
  "food_name",
  "meal_type",
  "consumption_date",
  "consumed_quantity",
  "quantity_unit",
  "calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "entry_source",
  "is_estimate",
  ...MICRONUTRIENTS.map(({ name }) => "micronutrients." + name),
]);

interface MealFormProps {
  initialValues: MealFormInput;
  today: string;
  submitLabel: string;
  onSubmit: (meal: MealPayload) => Promise<Meal | null | void>;
  onDirtyChange?: (dirty: boolean) => void;
  disableSubmitUntilValid?: boolean;
  lockProvenance?: boolean;
  onMissingFieldsChange?: (fields: string[]) => void;
  onSubmittingChange?: (submitting: boolean) => void;
}

function isApiField(value: string): value is FieldPath<MealFormInput> {
  return API_FIELDS.has(value);
}

function errorAt(
  errors: FieldErrors<MealFormInput>,
  name: FieldPath<MealFormInput>,
): HookFormFieldError | undefined {
  const [root, nested] = name.split(".");
  if (root === "micronutrients" && nested) {
    return Reflect.get(errors.micronutrients ?? {}, nested) as
      | HookFormFieldError
      | undefined;
  }
  return errors[root as keyof MealFormInput] as HookFormFieldError | undefined;
}

function FieldError({
  id,
  error,
}: {
  id: string;
  error?: HookFormFieldError;
}) {
  return error ? (
    <span className="field-error" id={id} role="alert">
      {error.message}
    </span>
  ) : null;
}

export function MealForm({
  initialValues,
  today,
  submitLabel,
  onSubmit,
  onDirtyChange,
  disableSubmitUntilValid = false,
  lockProvenance = false,
  onMissingFieldsChange,
  onSubmittingChange,
}: MealFormProps) {
  const schema = useMemo(() => mealFormSchema(today), [today]);
  const submittingRef = useRef(false);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isDirty, isSubmitting, isValid },
  } = useForm<MealFormInput, unknown, MealFormOutput>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
    mode: disableSubmitUntilValid ? "onChange" : "onSubmit",
  });

  const rawValues = watch();
  const missingFields = missingRequiredMealFields(rawValues);
  const missingKey = missingFields.join(",");

  useEffect(() => {
    onMissingFieldsChange?.(missingFields);
  }, [missingKey, onMissingFieldsChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) {
      reset(initialValues);
    }
  }, [initialValues, isDirty, reset]);

  function mapRequestError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError("The meal could not be saved.");
      return;
    }
    let mapped = false;
    for (const detail of error.details) {
      const field = String(detail.field ?? "").replace(/^body\./, "");
      if (isApiField(field)) {
        setError(field, {
          type: "server",
          message: detail.message || "Check this value.",
        });
        mapped = true;
      }
    }
    if (!mapped) {
      setFormError(error.message || "The meal could not be saved.");
    }
  }

  const submit = handleSubmit(async (parsed) => {
    // The ref closes the small interval before React applies disabled state, so
    // a rapid second activation cannot issue a duplicate mutation.
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setFormError("");
    try {
      const saved = await onSubmit(mealPayload(parsed));
      if (saved) {
        reset(mealToFormValues(saved));
      }
    } catch (error) {
      mapRequestError(error);
    } finally {
      submittingRef.current = false;
    }
  });

  function numericField(
    name: FieldPath<MealFormInput>,
    label: string,
    unit: string,
    optional = false,
  ) {
    const error = errorAt(errors, name);
    const errorId = name.replace(".", "-") + "-error";
    return (
      <label className="form-field" key={name}>
        <span>
          {label} <span className="unit">({unit})</span>
          {optional && <span className="optional"> optional</span>}
        </span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...register(name)}
        />
        <FieldError id={errorId} error={error} />
      </label>
    );
  }

  return (
    <form className="form-card meal-form" onSubmit={submit} noValidate>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}

      <section className="form-section" aria-labelledby="meal-basics-heading">
        <div className="section-heading">
          <p className="eyebrow">Entry details</p>
          <h2 id="meal-basics-heading">Meal basics</h2>
        </div>
        <div className="form-grid">
          <label className="form-field span-two">
            <span>Food name</span>
            <input
              type="text"
              maxLength={200}
              aria-invalid={Boolean(errors.food_name)}
              aria-describedby={
                errors.food_name ? "food-name-error" : undefined
              }
              {...register("food_name")}
            />
            <FieldError id="food-name-error" error={errors.food_name} />
          </label>
          <label className="form-field">
            <span>Meal type</span>
            <select {...register("meal_type")}>
              <option value="">Select meal type</option>
              {MEAL_TYPES.map((mealType) => (
                <option key={mealType.value} value={mealType.value}>
                  {mealType.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Consumption date</span>
            <input
              type="date"
              max={today}
              aria-invalid={Boolean(errors.consumption_date)}
              aria-describedby={
                errors.consumption_date
                  ? "consumption-date-error"
                  : "date-context"
              }
              {...register("consumption_date")}
            />
            <span className="field-help" id="date-context">
              Today in your profile timezone is {today}.
            </span>
            <FieldError
              id="consumption-date-error"
              error={errors.consumption_date}
            />
          </label>
          {numericField(
            "consumed_quantity",
            "Consumed quantity",
            "selected unit",
          )}
          <label className="form-field">
            <span>Quantity unit</span>
            <select {...register("quantity_unit")}>
              <option value="">Select quantity unit</option>
              {QUANTITY_UNITS.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby="core-heading">
        <div className="section-heading">
          <p className="eyebrow">Consumed totals</p>
          <h2 id="core-heading">Core nutrition</h2>
          <p className="section-note">
            Nutrition values are totals for the consumed amount. Review these
            totals when changing quantity.
          </p>
        </div>
        <div className="form-grid nutrition-grid">
          {CORE_NUTRIENTS.map((nutrient) =>
            numericField(nutrient.name, nutrient.label, nutrient.unit),
          )}
        </div>
      </section>

      <section className="form-section" aria-labelledby="micro-heading">
        <div className="section-heading">
          <p className="eyebrow">Optional when unknown</p>
          <h2 id="micro-heading">Micronutrients</h2>
        </div>
        <div className="form-grid nutrition-grid">
          {MICRONUTRIENTS.map((nutrient) =>
            numericField(
              `micronutrients.${nutrient.name}`,
              nutrient.label,
              nutrient.unit,
              true,
            ),
          )}
        </div>
      </section>

      <section className="form-section" aria-labelledby="source-heading">
        <div className="section-heading">
          <p className="eyebrow">Record context</p>
          <h2 id="source-heading">Source and estimate</h2>
        </div>
        <div className="form-grid">
          {lockProvenance ? (
            <div className="provenance-summary">
              <strong>
                {rawValues.entry_source === "food_plate"
                  ? "Plate photo"
                  : "Nutrition label photo"}
              </strong>
              <span>
                {rawValues.is_estimate
                  ? "Saved as an estimate."
                  : "Saved as label-derived nutrition."}
              </span>
              <input type="hidden" {...register("entry_source")} />
              <input type="hidden" {...register("is_estimate")} />
            </div>
          ) : (
            <>
              <label className="form-field">
                <span>Nutrition source</span>
                <select {...register("entry_source")}>
                  {ENTRY_SOURCES.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  aria-invalid={Boolean(errors.is_estimate)}
                  aria-describedby={
                    errors.is_estimate ? "estimate-error" : undefined
                  }
                  {...register("is_estimate")}
                />
                <span>These nutrition values are an estimate</span>
              </label>
              <FieldError id="estimate-error" error={errors.is_estimate} />
            </>
          )}
        </div>
      </section>

      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={isSubmitting || (disableSubmitUntilValid && !isValid)}
        >
          {isSubmitting ? "Saving..." : submitLabel}
        </button>
        {disableSubmitUntilValid && !isValid && (
          <p className="field-help" role="status">
            Complete the required meal fields before saving.
            {missingFields.length > 0
              ? " Still needed: " +
                missingFields.join(", ").replaceAll("_", " ") +
                "."
              : ""}
          </p>
        )}
      </div>
    </form>
  );
}
