import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { deleteMeal, listMeals } from "../api/meals";
import { MealFilters } from "../components/MealFilters";
import type { MealFilterDraft } from "../components/MealFilters";
import { MealList } from "../components/MealList";
import { PaginationControls } from "../components/PaginationControls";
import {
  EmptyState,
  ErrorMessage,
  LoadingState,
  StatusMessage,
} from "../components/UiState";
import type { Meal, MealListResponse } from "../types";
import {
  historySearch,
  parseHistorySearch,
} from "../validation/history";

export function MealHistory() {
  const location = useLocation();
  const navigationState = location.state as { message?: unknown } | null;
  const [searchParams, setSearchParams] = useSearchParams();
  const searchText = searchParams.toString();
  const parsed = useMemo(
    () => parseHistorySearch(new URLSearchParams(searchText)),
    [searchText],
  );
  const requestSequence = useRef(0);
  const [result, setResult] = useState<MealListResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState(
    typeof navigationState?.message === "string" ? navigationState.message : "",
  );

  useEffect(() => {
    if (parsed.error) {
      requestSequence.current += 1;
      setLoading(false);
      setResult(null);
      setError(new Error(parsed.error));
      return undefined;
    }

    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);

    listMeals(parsed.value, { signal: controller.signal })
      .then((response) => {
        // A completed older request is ignored even when an environment cannot
        // abort the underlying fetch immediately.
        if (sequence === requestSequence.current) {
          setResult(response);
        }
      })
      .catch((requestError) => {
        if (
          (!(requestError instanceof Error) ||
            requestError.name !== "AbortError") &&
          sequence === requestSequence.current
        ) {
          setError(
            requestError instanceof Error
              ? requestError
              : new Error("The meal history could not be loaded."),
          );
        }
      })
      .finally(() => {
        if (sequence === requestSequence.current) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [parsed, reloadVersion]);

  function applyFilters(filters: MealFilterDraft): void {
    setStatus("");
    setSearchParams(
      historySearch({
        start_date: filters.start_date,
        end_date: filters.end_date,
        meal_type: filters.meal_type || undefined,
        page: 1,
        page_size: parsed.value?.page_size ?? 20,
      }),
    );
  }

  function resetFilters() {
    setStatus("");
    setSearchParams("");
  }

  function changePage(page: number): void {
    setStatus("");
    setSearchParams(
      historySearch({
        ...parsed.value,
        page,
      }),
    );
  }

  async function remove(meal: Meal): Promise<void> {
    if (!window.confirm('Delete "' + meal.food_name + '" from your diary?')) {
      return;
    }

    const sequence = ++requestSequence.current;
    setDeletingId(meal.id);
    setError(null);
    setStatus("");
    try {
      await deleteMeal(meal.id);
      if (!parsed.value) {
        return;
      }
      const parameters = parsed.value;
      const refreshed = await listMeals(parameters);
      const lastPage = Math.max(refreshed.pagination.total_pages, 1);
      if (parameters.page > lastPage) {
        changePage(lastPage);
      } else {
        if (sequence !== requestSequence.current) return;
        setResult(refreshed);
        setStatus("Meal deleted.");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError
          : new Error("The meal could not be deleted."),
      );
    } finally {
      setDeletingId(null);
    }
  }

  const pagination = result?.pagination;
  const outOfRange =
    pagination &&
    pagination.total_pages > 0 &&
    pagination.page > pagination.total_pages;

  return (
    <main className="content-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Persisted diary</p>
          <h1>Meal history</h1>
          <p>Filter and page through entries saved by the backend.</p>
        </div>
        <Link className="button primary" to="/meals/new">
          Add a meal
        </Link>
      </header>

      <MealFilters
        filters={parsed.value ?? {}}
        onApply={applyFilters}
        onReset={resetFilters}
      />
      <StatusMessage>{status}</StatusMessage>

      {loading && <LoadingState message="Loading meal history..." />}
      {!loading && error && (
        <ErrorMessage
          error={error}
          onRetry={
            parsed.error ? resetFilters : () => setReloadVersion((value) => value + 1)
          }
          title="Meal history unavailable"
        />
      )}
      {!loading && !error && result && result.items.length === 0 && !outOfRange && (
        <EmptyState
          title="No meals found"
          action={
            <Link className="button primary" to="/meals/new">
              Add a meal
            </Link>
          }
        >
          {result.pagination.total_items === 0
            ? "No saved meals match these filters."
            : "This page has no entries."}
        </EmptyState>
      )}
      {!loading && !error && pagination && outOfRange && (
        <EmptyState
          title="This page is beyond the available results"
          action={
            <button
              className="button secondary"
              type="button"
              onClick={() => changePage(pagination.total_pages)}
            >
              Go to last page
            </button>
          }
        >
          Choose an available page or reset the filters.
        </EmptyState>
      )}
      {!loading && result && result.items.length > 0 && (
        <MealList
          meals={result.items}
          deletingId={deletingId}
          onDelete={remove}
        />
      )}
      {!loading && pagination && (
        <PaginationControls
          pagination={pagination}
          onPageChange={changePage}
        />
      )}
    </main>
  );
}
