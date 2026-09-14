import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { createMeal, getMeal, updateMeal } from "../api/meals";
import { getProfile } from "../api/profile";
import { MealForm } from "../components/MealForm";
import { ErrorMessage, LoadingState } from "../components/UiState";
import type { Meal, MealPayload, Profile } from "../types";
import {
  emptyMealForm,
  mealToFormValues,
} from "../validation/meals";

export function MealEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meal, setMeal] = useState<Meal | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const [mealError, setMealError] = useState<Error | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setProfileError(null);
    setMealError(null);

    async function load() {
      const tasks = [
        getProfile({ signal: controller.signal })
          .then(setProfile)
          .catch((error: unknown) => {
            if (!(error instanceof Error) || error.name !== "AbortError") {
              setProfileError(
                error instanceof Error
                  ? error
                  : new Error("The profile could not be loaded."),
              );
            }
          }),
      ];
      if (id !== undefined) {
        tasks.push(
          getMeal(id, { signal: controller.signal })
            .then(setMeal)
            .catch((error: unknown) => {
              if (!(error instanceof Error) || error.name !== "AbortError") {
                setMealError(
                  error instanceof Error
                    ? error
                    : new Error("The meal could not be loaded."),
                );
              }
            }),
        );
      }
      await Promise.all(tasks);
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [editing, id, loadVersion]);

  useEffect(() => {
    let controller: AbortController | undefined;
    async function refreshDateContext() {
      controller?.abort();
      controller = new AbortController();
      try {
        const refreshed = await getProfile({ signal: controller.signal });
        setProfile(refreshed);
        setProfileError(null);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "AbortError") {
          setProfileError(
            error instanceof Error
              ? error
              : new Error("The profile could not be refreshed."),
          );
        }
      }
    }
    window.addEventListener("focus", refreshDateContext);
    return () => {
      window.removeEventListener("focus", refreshDateContext);
      controller?.abort();
    };
  }, []);

  const initialValues = useMemo(() => {
    if (editing && meal) {
      return mealToFormValues(meal);
    }
    return emptyMealForm(profile?.today);
  }, [editing, meal, profile?.today]);

  async function save(payload: MealPayload): Promise<Meal> {
    // Refresh the authoritative date immediately before the write. The form's
    // existing dirty values are not reset when this context changes.
    const latestProfile = await getProfile();
    setProfile(latestProfile);
    setProfileError(null);
    if (payload.consumption_date > latestProfile.today) {
      throw new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Please correct the highlighted fields.",
        details: [
          {
            field: "consumption_date",
            message: "Consumption date cannot be after today.",
          },
        ],
      });
    }

    const saved =
      id === undefined
        ? await createMeal(payload)
        : await updateMeal(id, payload);
    navigate("/meals", {
      state: {
        message: editing
          ? "Meal changes saved."
          : "Meal saved to your history.",
      },
    });
    return saved;
  }

  const missingMeal = mealError instanceof ApiError && mealError.status === 404;
  const retry = () => setLoadVersion((value) => value + 1);

  return (
    <main className="content-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">{editing ? "Update entry" : "New entry"}</p>
          <h1>{editing ? "Edit meal" : "Add a meal"}</h1>
          <p>
            Record nutrition totals for the amount you actually consumed.
          </p>
        </div>
        <Link className="text-link" to="/meals">
          Back to history
        </Link>
      </header>

      {loading && <LoadingState message="Loading meal form..." />}
      {!loading && missingMeal && (
        <ErrorMessage
          error={{ message: "This meal no longer exists." }}
          title="Meal not found"
        />
      )}
      {!loading && !missingMeal && mealError && (
        <ErrorMessage error={mealError} onRetry={retry} title="Meal unavailable" />
      )}
      {!loading && profileError && !profile && (
        <ErrorMessage
          error={profileError}
          onRetry={retry}
          title="Date context unavailable"
        />
      )}
      {!loading &&
        profile &&
        !mealError &&
        (!editing || meal) && (
          <>
            {profileError && (
              <ErrorMessage
                error={profileError}
                title="Could not refresh date context"
              />
            )}
            <MealForm
              initialValues={initialValues}
              today={profile.today}
              submitLabel={editing ? "Save meal changes" : "Save meal"}
              onSubmit={save}
            />
          </>
        )}
    </main>
  );
}
