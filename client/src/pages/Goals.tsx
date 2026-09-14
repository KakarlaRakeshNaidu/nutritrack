import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getGoals, updateGoals } from "../api/goals";
import { GoalForm } from "../components/GoalForm";
import {
  ErrorMessage,
  LoadingState,
  StatusMessage,
} from "../components/UiState";
import type { Goals as GoalValues, PersistedGoals } from "../types";
import { emptyGoalForm, goalsToFormValues } from "../validation/goals";

const GOAL_FIELDS = [
  "daily_calories_kcal",
  "daily_protein_g",
  "daily_carbs_g",
  "daily_fat_g",
  "target_weight_kg",
] as const;

function areAllGoalsUnset(goals: GoalValues): boolean {
  return GOAL_FIELDS.every((field) => goals[field] === null);
}

export function Goals() {
  const [goals, setGoals] = useState<PersistedGoals | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const dirtyRef = useRef(false);
  const requestSequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setError(null);
    try {
      const response = await getGoals({ signal });
      if (sequence === requestSequence.current) {
        setGoals(response);
      }
    } catch (requestError) {
      if (
        (!(requestError instanceof Error) ||
          requestError.name !== "AbortError") &&
        sequence === requestSequence.current
      ) {
        setError(
          requestError instanceof Error
            ? requestError
            : new Error("The goals could not be loaded."),
        );
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    let controller: AbortController | undefined;
    function refresh() {
      if (dirtyRef.current) {
        return;
      }
      controller?.abort();
      controller = new AbortController();
      load(controller.signal);
    }
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      controller?.abort();
    };
  }, [load]);

  const initialValues = useMemo(
    () => (goals ? goalsToFormValues(goals) : emptyGoalForm()),
    [goals],
  );

  async function save(payload: GoalValues): Promise<PersistedGoals> {
    const saved = await updateGoals(payload);
    setGoals(saved);
    setStatus(
      areAllGoalsUnset(saved)
        ? "All current targets cleared."
        : "Current targets saved.",
    );
    return saved;
  }

  return (
    <main className="content-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Current configuration</p>
          <h1>Nutrition goals</h1>
          <p>Set only the daily targets that are useful to you.</p>
        </div>
      </header>

      {loading && <LoadingState message="Loading current goals..." />}
      {!loading && error && !goals && (
        <ErrorMessage
          error={error}
          onRetry={() => {
            setLoading(true);
            load();
          }}
          title="Goals unavailable"
        />
      )}
      {!loading && goals && (
        <>
          {areAllGoalsUnset(goals) && (
            <StatusMessage tone="neutral">
              No current targets are configured.
            </StatusMessage>
          )}
          <StatusMessage>{status}</StatusMessage>
          {error && (
            <ErrorMessage error={error} title="Could not refresh goals" />
          )}
          <GoalForm
            initialValues={initialValues}
            onDirtyChange={(dirty) => {
              dirtyRef.current = dirty;
            }}
            onSubmit={save}
          />
        </>
      )}
    </main>
  );
}
