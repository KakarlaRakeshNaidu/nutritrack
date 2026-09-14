import type { MealListParameters, MealType } from "../types";
import { isValidDateOnly } from "../utils/dates";

const ALLOWED_PARAMETERS = new Set([
  "start_date",
  "end_date",
  "meal_type",
  "page",
  "page_size",
]);
const MEAL_TYPES = new Set<string>(["breakfast", "lunch", "dinner", "snacks"]);
const FILTER_KEYS = ["start_date", "end_date", "meal_type"] as const;

export type HistoryParseResult =
  | { value: Required<Pick<MealListParameters, "page" | "page_size">> &
        Omit<MealListParameters, "page" | "page_size">; error?: never }
  | { error: string; value?: never };

function isMealType(value: string): value is MealType {
  return MEAL_TYPES.has(value);
}

function positiveInteger(value: string, maximum: number): number | null {
  return /^\d+$/.test(value) &&
    BigInt(value) >= 1n &&
    BigInt(value) <= BigInt(maximum)
    ? Number(value)
    : null;
}

export function parseHistorySearch(searchParams: URLSearchParams): HistoryParseResult {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_PARAMETERS.has(key) || searchParams.getAll(key).length !== 1) {
      return { error: "The history URL contains unsupported filters." };
    }
  }

  const startDate = searchParams.get("start_date") || undefined;
  const endDate = searchParams.get("end_date") || undefined;
  const mealType = searchParams.get("meal_type") || undefined;
  const rawPage = searchParams.get("page");
  const rawPageSize = searchParams.get("page_size");

  if (
    (startDate && !isValidDateOnly(startDate)) ||
    (endDate && !isValidDateOnly(endDate)) ||
    (startDate && endDate && startDate > endDate) ||
    (mealType && !isMealType(mealType))
  ) {
    return { error: "The history URL contains invalid filters." };
  }

  const validatedMealType =
    mealType && isMealType(mealType) ? mealType : undefined;
  const page = rawPage === null ? 1 : positiveInteger(rawPage, 2_147_483_647);
  const pageSize = rawPageSize === null ? 20 : positiveInteger(rawPageSize, 100);
  if (page === null || pageSize === null) {
    return { error: "The history URL contains invalid paging values." };
  }

  return {
    value: {
      start_date: startDate,
      end_date: endDate,
      meal_type: validatedMealType,
      page,
      page_size: pageSize,
    },
  };
}

export function historySearch(parameters: MealListParameters): URLSearchParams {
  const search = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    if (parameters[key]) {
      search.set(key, parameters[key]);
    }
  }
  if (parameters.page && parameters.page !== 1) {
    search.set("page", String(parameters.page));
  }
  if (parameters.page_size && parameters.page_size !== 20) {
    search.set("page_size", String(parameters.page_size));
  }
  return search;
}
