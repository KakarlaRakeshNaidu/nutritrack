import type {
  GoalMetric,
  NutritionReport,
  ReportBucket,
  ReportGoalComparison,
  ReportMicroSummary,
  ReportSummary,
} from "../src/types";
import { addCalendarDays } from "../src/validation/reports";

function micro(
  unit: "mg" | "mcg",
  knownTotal: number | null,
  knownCount: number,
  entryCount: number,
): ReportMicroSummary {
  return {
    unit,
    known_total: knownTotal,
    known_count: knownCount,
    unknown_count: entryCount - knownCount,
    entry_count: entryCount,
  };
}

export function summaryFixture(
  overrides: Partial<ReportSummary> = {},
): ReportSummary {
  return {
    entry_count: 25,
    logged_day_count: 1,
    calories_kcal: 250,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    micronutrients: {
      sodium_mg: micro("mg", 120, 3, 4),
      calcium_mg: micro("mg", null, 0, 4),
      iron_mg: micro("mg", 0, 4, 4),
      potassium_mg: micro("mg", null, 0, 4),
      vitamin_c_mg: micro("mg", null, 0, 4),
      vitamin_d_mcg: micro("mcg", null, 0, 4),
    },
    ...overrides,
  };
}

function metric(
  actual: number,
  target: number | null,
  difference: number | null,
  percent: number | null,
): GoalMetric {
  return { actual, target, difference, percent };
}

export function comparisonFixture(
  overrides: Partial<ReportGoalComparison> = {},
): ReportGoalComparison {
  return {
    basis: "current_daily_targets",
    scope_start: "2026-09-07",
    scope_end: "2026-09-12",
    day_count: 6,
    calories_kcal: metric(250, 12_000, -11_750, 2.08),
    protein_g: metric(10, 600, -590, 1.67),
    carbs_g: metric(20, null, null, null),
    fat_g: metric(5, 420, -415, 1.19),
    ...overrides,
  };
}

export function bucketFixture(
  date: string,
  overrides: Partial<ReportBucket> = {},
): ReportBucket {
  const temporal =
    date > "2026-09-12" ? "future" : date < "2026-09-12" ? "past" : "current";
  const summary = summaryFixture({
    entry_count: date === "2026-09-07" ? 25 : 0,
    logged_day_count: date === "2026-09-07" ? 1 : 0,
    calories_kcal: date === "2026-09-07" ? 250 : 0,
    protein_g: date === "2026-09-07" ? 10 : 0,
    carbs_g: date === "2026-09-07" ? 20 : 0,
    fat_g: date === "2026-09-07" ? 5 : 0,
  });
  return {
    period_start: date,
    period_end: date,
    covered_start: date,
    covered_end: date,
    calendar_day_count: 1,
    elapsed_day_count: temporal === "future" ? 0 : 1,
    temporal_state: temporal,
    ...summary,
    goal_comparison: comparisonFixture({
      scope_start: temporal === "future" ? null : date,
      scope_end: temporal === "future" ? null : date,
      day_count: temporal === "future" ? 0 : 1,
    }),
    ...overrides,
  };
}

export function reportFixture(
  overrides: Partial<NutritionReport> = {},
): NutritionReport {
  const items = Array.from({ length: 7 }, (_, index) =>
    bucketFixture(addCalendarDays("2026-09-07", index)),
  );
  return {
    range: {
      start_date: "2026-09-07",
      end_date: "2026-09-13",
      group_by: "day",
      timezone: "Asia/Kolkata",
      today: "2026-09-12",
    },
    summary: summaryFixture(),
    goal_snapshot: {
      daily_calories_kcal: 2000,
      daily_protein_g: 100,
      daily_carbs_g: null,
      daily_fat_g: 70,
      target_weight_kg: 75,
      updated_at: "2026-09-12T00:00:00.000Z",
    },
    goal_comparison: comparisonFixture(),
    items,
    pagination: {
      page: 1,
      page_size: 20,
      total_items: 7,
      total_pages: 1,
    },
    ...overrides,
  };
}
