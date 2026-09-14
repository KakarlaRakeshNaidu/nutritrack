import { z } from "zod";

import type {
  ReportGrouping,
  ReportRequestParameters,
} from "../types";
import { isValidDateOnly } from "../utils/dates";

const CORE_FIELDS = [
  "calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
] as const;
const MICRO_FIELDS = [
  "sodium_mg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
  "vitamin_c_mg",
  "vitamin_d_mcg",
] as const;
const finiteNumber = z.number().finite();
const dateOnly = z.string().refine(isValidDateOnly);
const microSummarySchema = z.strictObject({
  unit: z.enum(["mg", "mcg"]),
  known_total: finiteNumber.nullable(),
  known_count: z.number().int().nonnegative(),
  unknown_count: z.number().int().nonnegative(),
  entry_count: z.number().int().nonnegative(),
});
const micronutrientsShape = Object.fromEntries(
  MICRO_FIELDS.map((field) => [field, microSummarySchema]),
) as Record<(typeof MICRO_FIELDS)[number], typeof microSummarySchema>;
const summaryShape = {
  entry_count: z.number().int().nonnegative(),
  logged_day_count: z.number().int().nonnegative(),
  calories_kcal: finiteNumber,
  protein_g: finiteNumber,
  carbs_g: finiteNumber,
  fat_g: finiteNumber,
  micronutrients: z.strictObject(micronutrientsShape),
};
const goalMetricSchema = z.strictObject({
  actual: finiteNumber,
  target: finiteNumber.nullable(),
  difference: finiteNumber.nullable(),
  percent: finiteNumber.nullable(),
});
const goalMetricShape = Object.fromEntries(
  CORE_FIELDS.map((field) => [field, goalMetricSchema]),
) as Record<(typeof CORE_FIELDS)[number], typeof goalMetricSchema>;
const goalComparisonSchema = z.strictObject({
  basis: z.literal("current_daily_targets"),
  scope_start: dateOnly.nullable(),
  scope_end: dateOnly.nullable(),
  day_count: z.number().int().nonnegative(),
  ...goalMetricShape,
});
const goalSnapshotSchema = z.strictObject({
  daily_calories_kcal: finiteNumber.nullable(),
  daily_protein_g: finiteNumber.nullable(),
  daily_carbs_g: finiteNumber.nullable(),
  daily_fat_g: finiteNumber.nullable(),
  target_weight_kg: finiteNumber.nullable(),
  updated_at: z.string(),
});
const bucketShape = {
  period_start: dateOnly,
  period_end: dateOnly,
  covered_start: dateOnly,
  covered_end: dateOnly,
  calendar_day_count: z.number().int().positive(),
  elapsed_day_count: z.number().int().nonnegative(),
  temporal_state: z.enum(["past", "current", "future"]),
};

export const nutritionReportSchema = z.strictObject({
  range: z.strictObject({
    start_date: dateOnly,
    end_date: dateOnly,
    group_by: z.enum(["day", "week"]),
    timezone: z.string().min(1),
    today: dateOnly,
  }),
  summary: z.strictObject(summaryShape),
  goal_snapshot: goalSnapshotSchema,
  goal_comparison: goalComparisonSchema,
  items: z.array(
    z.strictObject({
      ...bucketShape,
      ...summaryShape,
      goal_comparison: goalComparisonSchema,
    }),
  ),
  pagination: z.strictObject({
    page: z.number().int().positive(),
    page_size: z.number().int().positive().max(100),
    total_items: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
  }),
});

export const REPORT_PAGE_SIZES = [20, 50, 100] as const;

export interface ReportDraft {
  start_date: string;
  end_date: string;
  group_by: string;
  page_size: string;
}

export interface ParsedReportSearch {
  value: ReportRequestParameters | null;
  draft: ReportDraft;
  error: string;
}

const ALLOWED_KEYS = new Set([
  "start_date",
  "end_date",
  "group_by",
  "page",
  "page_size",
]);
const POSITIVE_INTEGER = /^[1-9]\d*$/;

export function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = Date.UTC(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(5, 7)) - 1,
    Number(startDate.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(endDate.slice(0, 4)),
    Number(endDate.slice(5, 7)) - 1,
    Number(endDate.slice(8, 10)),
  );
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function addCalendarDays(value: string, days: number): string {
  if (!isValidDateOnly(value)) {
    throw new TypeError("A valid calendar date is required.");
  }
  const date = new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)) + days,
    ),
  );
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function weekBounds(value: string): {
  start_date: string;
  end_date: string;
} {
  if (!isValidDateOnly(value)) {
    throw new TypeError("A valid calendar date is required.");
  }
  const date = new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)),
    ),
  );
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startDate = addCalendarDays(value, mondayOffset);
  return {
    start_date: startDate,
    end_date: addCalendarDays(startDate, 6),
  };
}

function firstValue(search: URLSearchParams, key: string): string {
  return search.get(key) ?? "";
}

function reportDraft(search: URLSearchParams): ReportDraft {
  return {
    start_date: firstValue(search, "start_date"),
    end_date: firstValue(search, "end_date"),
    group_by: firstValue(search, "group_by") || "day",
    page_size: firstValue(search, "page_size") || "20",
  };
}

function parsePositiveInteger(
  value: string,
  label: string,
  maximum: number,
): { value?: number; error?: string } {
  if (!POSITIVE_INTEGER.test(value)) {
    return { error: label + " must be a positive whole number." };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    return { error: label + " must be no greater than " + maximum + "." };
  }
  return { value: parsed };
}

export function validateReportDraft(
  draft: ReportDraft,
): { value: ReportRequestParameters | null; error: string } {
  const start = draft.start_date.trim();
  const end = draft.end_date.trim();
  if (Boolean(start) !== Boolean(end)) {
    return {
      value: null,
      error: "Start date and end date must be supplied together.",
    };
  }
  if (start && (!isValidDateOnly(start) || !isValidDateOnly(end))) {
    return { value: null, error: "Enter real dates in YYYY-MM-DD format." };
  }
  if (start && start > end) {
    return { value: null, error: "End date must be on or after start date." };
  }
  if (start && inclusiveDayCount(start, end) > 366) {
    return {
      value: null,
      error: "Report ranges may contain at most 366 inclusive dates.",
    };
  }
  if (draft.group_by !== "day" && draft.group_by !== "week") {
    return { value: null, error: "Grouping must be Day or Week." };
  }
  const pageSize = parsePositiveInteger(draft.page_size, "Page size", 100);
  if (pageSize.error || pageSize.value === undefined) {
    return { value: null, error: pageSize.error ?? "Page size is invalid." };
  }
  return {
    value: {
      ...(start ? { start_date: start, end_date: end } : {}),
      group_by: draft.group_by,
      page: 1,
      page_size: pageSize.value,
    },
    error: "",
  };
}

export function parseReportSearch(search: URLSearchParams): ParsedReportSearch {
  const draft = reportDraft(search);
  for (const key of search.keys()) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        value: null,
        draft,
        error: "Unsupported report parameter: " + key + ".",
      };
    }
    if (search.getAll(key).length !== 1) {
      return {
        value: null,
        draft,
        error: "Report parameters may be supplied only once.",
      };
    }
    if (firstValue(search, key).trim() === "") {
      return {
        value: null,
        draft,
        error: "Report parameters cannot be blank.",
      };
    }
  }

  const validated = validateReportDraft(draft);
  if (!validated.value) {
    return { value: null, draft, error: validated.error };
  }
  const pageText = firstValue(search, "page") || "1";
  const page = parsePositiveInteger(pageText, "Page", 2_147_483_647);
  if (page.error || page.value === undefined) {
    return { value: null, draft, error: page.error ?? "Page is invalid." };
  }
  return {
    value: { ...validated.value, page: page.value },
    draft,
    error: "",
  };
}

export function reportSearch(parameters: ReportRequestParameters): URLSearchParams {
  const search = new URLSearchParams();
  if (parameters.start_date && parameters.end_date) {
    search.set("start_date", parameters.start_date);
    search.set("end_date", parameters.end_date);
  }
  search.set("group_by", parameters.group_by ?? "day");
  search.set("page", String(parameters.page ?? 1));
  search.set("page_size", String(parameters.page_size ?? 20));
  return search;
}

export function isReportGrouping(value: string): value is ReportGrouping {
  return value === "day" || value === "week";
}
