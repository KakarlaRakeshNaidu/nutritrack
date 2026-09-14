import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { ApiError } from "../api/client";
import type { Goals } from "../types";
import { GOAL_FIELDS } from "../utils/nutrition";
import {
  emptyGoalForm,
  goalFormSchema,
  goalPayload,
  goalsToFormValues,
} from "../validation/goals";
import type {
  GoalFormInput,
  GoalFormOutput,
} from "../validation/goals";

interface GoalFormProps {
  initialValues: GoalFormInput;
  onSubmit: (goals: Goals) => Promise<Goals>;
  onDirtyChange?: (dirty: boolean) => void;
}

function isGoalName(value: string): value is keyof GoalFormInput {
  return GOAL_NAMES.has(value as keyof GoalFormInput);
}


const GOAL_NAMES = new Set(GOAL_FIELDS.map(({ name }) => name));

export function GoalForm({ initialValues, onSubmit, onDirtyChange }: GoalFormProps) {
  const submittingRef = useRef(false);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<GoalFormInput, unknown, GoalFormOutput>({
    defaultValues: initialValues,
    resolver: zodResolver(goalFormSchema),
  });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) {
      reset(initialValues);
    }
  }, [initialValues, isDirty, reset]);

  const submit = handleSubmit(async (parsed) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setFormError("");
    try {
      const saved = await onSubmit(goalPayload(parsed));
      reset(goalsToFormValues(saved));
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError("The goals could not be saved.");
        return;
      }
      let mapped = false;
      for (const detail of error.details) {
        const field = String(detail.field ?? "").replace(/^body\./, "");
        if (isGoalName(field)) {
          setError(field, {
            type: "server",
            message: detail.message || "Check this value.",
          });
          mapped = true;
        }
      }
      if (!mapped) {
        setFormError(error.message);
      }
    } finally {
      submittingRef.current = false;
    }
  });

  return (
    <form className="form-card goal-form" onSubmit={submit} noValidate>
      <p className="section-note">
        These are your current daily targets. Leave a field blank to keep that
        target unset.
      </p>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="form-grid">
        {GOAL_FIELDS.map((field) => {
          const error = errors[field.name];
          const errorId = field.name + "-error";
          return (
            <label className="form-field" key={field.name}>
              <span>
                {field.label} <span className="unit">({field.unit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                {...register(field.name)}
              />
              {error && (
                <span className="field-error" id={errorId} role="alert">
                  {error.message}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="form-actions split-actions">
        <button
          className="button secondary"
          type="button"
          disabled={isSubmitting}
          onClick={() =>
            reset(emptyGoalForm(), {
              keepDefaultValues: true,
              keepDirty: true,
            })
          }
        >
          Clear all fields
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Save current targets"}
        </button>
      </div>
    </form>
  );
}
