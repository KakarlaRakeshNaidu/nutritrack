import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useForm,
  type FieldError as HookFormFieldError,
  type FieldErrors,
  type FieldPath,
} from "react-hook-form";

import { ApiError } from "../api/client";
import { estimateNutrition } from "../api/nutrition";
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
  mealBasicsPayload,
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
  enableNutritionEstimate?: boolean;
}

const BASIC_FIELDS: Array<FieldPath<MealFormInput>> = [
  "food_name",
  "meal_type",
  "consumption_date",
  "consumed_quantity",
  "quantity_unit",
];

function valueKey(values: Partial<MealFormInput>, fields: string[]): string {
  return JSON.stringify(
    fields.map((field) => {
      const [root, nested] = field.split(".");
      const value = nested
        ? Reflect.get(Reflect.get(values, root) ?? {}, nested)
        : Reflect.get(values, root);
      return value ?? null;
    }),
  );
}

function basicsKey(values: Partial<MealFormInput>): string {
  return valueKey(values, BASIC_FIELDS);
}

function nutritionKey(values: Partial<MealFormInput>): string {
  return valueKey(values, [
    "calories_kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    ...MICRONUTRIENTS.map(({ name }) => "micronutrients." + name),
  ]);
}

function hasNutritionInput(values: Partial<MealFormInput>): boolean {
  return JSON.parse(nutritionKey(values)).some(
    (value: unknown) => value !== null && value !== "",
  );
}

function formEstimateNumber(value: number | null): string {
  return value === null ? "" : String(value);
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
  enableNutritionEstimate = false,
}: MealFormProps) {
  const schema = useMemo(() => mealFormSchema(today), [today]);
  const submittingRef = useRef(false);
  const [formError, setFormError] = useState("");
  const [estimatePending, setEstimatePending] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [estimateStatus, setEstimateStatus] = useState("");
  const [estimateAssumptions, setEstimateAssumptions] = useState<string[]>([]);
  const [clarification, setClarification] = useState<string | null>(null);
  const [estimatedBasis, setEstimatedBasis] = useState<string | null>(null);
  const [basisChanged, setBasisChanged] = useState(false);
  const estimateController = useRef<AbortController | null>(null);
  const estimateSequence = useRef(0);
  const requestedBasis = useRef<string | null>(null);
  const previousBasis = useRef<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    getValues,
    trigger,
    watch,
    formState: { errors, isDirty, isSubmitting, isValid },
  } = useForm<MealFormInput, unknown, MealFormOutput>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
    mode: disableSubmitUntilValid ? "onChange" : "onSubmit",
  });

  const rawValues = watch();
  const currentBasisKey = basicsKey(rawValues);
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
    if (previousBasis.current === null) {
      previousBasis.current = currentBasisKey;
    } else if (previousBasis.current !== currentBasisKey) {
      previousBasis.current = currentBasisKey;
      if (estimateController.current) {
        // A changed request basis invalidates both the fetch and its sequence,
        // preventing a late response from replacing current nutrition.
        estimateSequence.current += 1;
        estimateController.current.abort();
        estimateController.current = null;
        requestedBasis.current = null;
        setEstimatePending(false);
        setEstimateStatus("Estimation canceled because meal basics changed.");
      }
    }
    setBasisChanged(
      estimatedBasis !== null && estimatedBasis !== currentBasisKey,
    );
  }, [currentBasisKey, estimatedBasis]);

  useEffect(
    () => () => {
      estimateSequence.current += 1;
      estimateController.current?.abort();
    },
    [],
  );

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
    if (submittingRef.current || estimatePending) {
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

  function cancelEstimate(): void {
    estimateSequence.current += 1;
    estimateController.current?.abort();
    estimateController.current = null;
    requestedBasis.current = null;
    setEstimatePending(false);
    setEstimateError("");
    setEstimateStatus("Nutrition estimation canceled.");
  }

  async function estimateFromBasics(): Promise<void> {
    if (estimatePending || isSubmitting) return;
    const values = getValues();
    let basics;
    try {
      basics = mealBasicsPayload(values, today);
    } catch {
      await trigger(BASIC_FIELDS);
      setEstimateError("Complete valid meal basics before estimating nutrition.");
      return;
    }
    if (
      hasNutritionInput(values) &&
      !window.confirm(
        "Replace the current nutrition values with a new AI estimate?",
      )
    ) {
      return;
    }

    const basis = basicsKey(values);
    const nutritionBeforeRequest = nutritionKey(values);
    const sequence = ++estimateSequence.current;
    const controller = new AbortController();
    estimateController.current?.abort();
    estimateController.current = controller;
    requestedBasis.current = basis;
    setEstimatePending(true);
    setEstimateError("");
    setEstimateStatus("");
    setClarification(null);

    try {
      const result = await estimateNutrition(basics, {
        signal: controller.signal,
      });
      if (
        sequence !== estimateSequence.current ||
        controller.signal.aborted ||
        requestedBasis.current !== basicsKey(getValues())
      ) {
        return;
      }
      if (nutritionBeforeRequest !== nutritionKey(getValues())) {
        setEstimateStatus(
          "Nutrition changed while estimation was pending, so the estimate was not applied.",
        );
        return;
      }
      setEstimateAssumptions(result.assumptions);
      setClarification(result.clarification);
      if (result.status === "needs_clarification") {
        setEstimateStatus("More meal detail is needed before estimating.");
        return;
      }

      const options = { shouldDirty: true, shouldValidate: true };
      setValue(
        "calories_kcal",
        formEstimateNumber(result.nutrition.calories_kcal),
        options,
      );
      setValue(
        "protein_g",
        formEstimateNumber(result.nutrition.protein_g),
        options,
      );
      setValue(
        "carbs_g",
        formEstimateNumber(result.nutrition.carbs_g),
        options,
      );
      setValue("fat_g", formEstimateNumber(result.nutrition.fat_g), options);
      for (const { name } of MICRONUTRIENTS) {
        setValue(
          `micronutrients.${name}`,
          formEstimateNumber(result.nutrition.micronutrients[name]),
          options,
        );
      }
      setValue("entry_source", "manual", options);
      setValue("is_estimate", true, options);
      setEstimatedBasis(basis);
      setBasisChanged(false);
      setEstimateStatus(
        result.missing_fields.length > 0
          ? "AI estimate applied. Complete or review the remaining blank nutrition fields."
          : "AI estimate applied. Review every nutrition value before saving.",
      );
    } catch (error) {
      if (
        sequence === estimateSequence.current &&
        !controller.signal.aborted
      ) {
        setEstimateError(
          error instanceof ApiError
            ? error.message
            : "Nutrition could not be estimated. Enter values manually or try again.",
        );
      }
    } finally {
      if (sequence === estimateSequence.current) {
        estimateController.current = null;
        requestedBasis.current = null;
        setEstimatePending(false);
      }
    }
  }

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
        {enableNutritionEstimate && (
          <div className="estimate-panel" aria-label="AI nutrition estimation">
            <p className="section-note">
              A specific description such as “cooked brown rice” improves the
              estimate. Gemini suggestions remain editable and are not saved
              automatically.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                type="button"
                disabled={estimatePending || isSubmitting}
                onClick={() => void estimateFromBasics()}
              >
                {estimatePending
                  ? "Estimating nutrition..."
                  : estimatedBasis
                    ? "Re-estimate nutrition"
                    : "Estimate nutrition"}
              </button>
              {estimatePending && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={cancelEstimate}
                >
                  Cancel estimation
                </button>
              )}
            </div>
            {estimatePending && (
              <p role="status">Estimating totals for the entered quantity…</p>
            )}
            {estimateError && <p className="form-error" role="alert">{estimateError}</p>}
            {estimateStatus && <p role="status">{estimateStatus}</p>}
            {clarification && (
              <p className="form-error" role="alert">
                <strong>Clarification needed:</strong> {clarification}
              </p>
            )}
            {estimatedBasis && !basisChanged && (
              <p><strong>AI-estimated from meal details.</strong></p>
            )}
            {basisChanged && (
              <p className="status-message neutral" role="status">
                Meal basics changed after estimation. Preserve and review the
                nutrition values, or choose Re-estimate nutrition.
              </p>
            )}
            {estimateAssumptions.length > 0 && (
              <div>
                <strong>Estimation assumptions</strong>
                <ul>
                  {estimateAssumptions.map((assumption, index) => (
                    <li key={index}>{assumption}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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
          {lockProvenance || estimatedBasis !== null ? (
            <div className="provenance-summary">
              <strong>
                {estimatedBasis !== null
                  ? "Manual meal details"
                  : rawValues.entry_source === "food_plate"
                  ? "Plate photo"
                  : "Nutrition label photo"}
              </strong>
              <span>
                {estimatedBasis !== null
                  ? "Manual identifies the entry method; these values remain an AI estimate."
                  : rawValues.is_estimate
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
          disabled={
            isSubmitting ||
            estimatePending ||
            (disableSubmitUntilValid && !isValid)
          }
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
