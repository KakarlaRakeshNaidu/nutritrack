import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBucketRanges,
  buildGoalComparison,
  serializeSummary,
  summarizeDailyRows,
} from "../src/modules/reports/report.calculations.js";
import type {
  MicroReportField,
  ReportAggregateRow,
} from "../src/modules/reports/report.calculations.js";
import type { Goal } from "../src/modules/goals/goal.repository.js";

const MICRO_FIELDS: MicroReportField[] = [
  "sodium_mg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
  "vitamin_c_mg",
  "vitamin_d_mcg",
];

function dailyRow(
  consumptionDate: string,
  overrides: Partial<ReportAggregateRow> = {},
): ReportAggregateRow {
  const row: ReportAggregateRow = {
    consumption_date: consumptionDate,
    entry_count: "1",
    calories_kcal: "0.0000",
    protein_g: "0.0000",
    carbs_g: "0.0000",
    fat_g: "0.0000",
  };
  for (const field of MICRO_FIELDS) {
    row[field + "_known_total"] = null;
    row[field + "_known_count"] = "0";
  }
  return { ...row, ...overrides };
}

function goals(overrides: Partial<Goal> = {}): Goal {
  return {
    daily_calories_kcal: 2000,
    daily_protein_g: 100,
    daily_carbs_g: 250,
    daily_fat_g: 70,
    target_weight_kg: 75,
    updated_at: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

test("summary keeps known zero distinct from unknown micronutrients", () => {
  const rows = [
    dailyRow("2026-09-07", {
      entry_count: "4",
      calories_kcal: "250.0000",
      sodium_mg_known_total: "120.0000",
      sodium_mg_known_count: "3",
      calcium_mg_known_total: null,
      calcium_mg_known_count: "0",
      iron_mg_known_total: "0.0000",
      iron_mg_known_count: "4",
    }),
  ];
  const summary = serializeSummary(
    summarizeDailyRows(rows, "2026-09-07", "2026-09-07"),
  );

  assert.equal(summary.entry_count, 4);
  assert.equal(summary.logged_day_count, 1);
  assert.deepEqual(summary.micronutrients.sodium_mg, {
    unit: "mg",
    known_total: 120,
    known_count: 3,
    unknown_count: 1,
    entry_count: 4,
  });
  assert.deepEqual(summary.micronutrients.calcium_mg, {
    unit: "mg",
    known_total: null,
    known_count: 0,
    unknown_count: 4,
    entry_count: 4,
  });
  assert.equal(summary.micronutrients.iron_mg.known_total, 0);
  assert.equal(summary.micronutrients.vitamin_d_mcg.unit, "mcg");
});

test("summary is empty-safe and adds exact stored decimals without floating drift", () => {
  const empty = serializeSummary(
    summarizeDailyRows([], "2026-09-07", "2026-09-08"),
  );
  assert.equal(empty.calories_kcal, 0);
  assert.equal(empty.micronutrients.sodium_mg.known_total, null);
  assert.equal(empty.micronutrients.sodium_mg.entry_count, 0);

  const precise = serializeSummary(
    summarizeDailyRows(
      [
        dailyRow("2026-09-07", { calories_kcal: "0.1000" }),
        dailyRow("2026-09-08", { calories_kcal: "0.2000" }),
      ],
      "2026-09-07",
      "2026-09-08",
    ),
  );
  assert.equal(precise.calories_kcal, 0.3);

  const fourDecimals = serializeSummary(
    summarizeDailyRows(
      [
        dailyRow("2026-09-07", { calories_kcal: "0.1234" }),
        dailyRow("2026-09-08", { calories_kcal: "0.0001" }),
      ],
      "2026-09-07",
      "2026-09-08",
    ),
  );
  assert.equal(fourDecimals.calories_kcal, 0.1235);

  const large = serializeSummary(
    summarizeDailyRows(
      [
        dailyRow("2026-09-07", { calories_kcal: "750000.0000" }),
        dailyRow("2026-09-08", { calories_kcal: "750000.0000" }),
      ],
      "2026-09-07",
      "2026-09-08",
    ),
  );
  assert.equal(large.calories_kcal, 1_500_000);
});

test("day and week buckets include empty dates and clip canonical weeks", () => {
  const days = buildBucketRanges({
    startDate: "2026-09-07",
    endDate: "2026-09-13",
    groupBy: "day",
    today: "2026-09-12",
  });
  assert.equal(days.length, 7);
  assert.deepEqual(
    days.map((item) => item.temporal_state),
    ["past", "past", "past", "past", "past", "current", "future"],
  );

  const weeks = buildBucketRanges({
    startDate: "2026-09-10",
    endDate: "2026-09-15",
    groupBy: "week",
    today: "2026-09-12",
  });
  assert.deepEqual(weeks, [
    {
      period_start: "2026-09-07",
      period_end: "2026-09-13",
      covered_start: "2026-09-10",
      covered_end: "2026-09-13",
      calendar_day_count: 4,
      elapsed_day_count: 3,
      temporal_state: "current",
    },
    {
      period_start: "2026-09-14",
      period_end: "2026-09-20",
      covered_start: "2026-09-14",
      covered_end: "2026-09-15",
      calendar_day_count: 2,
      elapsed_day_count: 0,
      temporal_state: "future",
    },
  ]);
});

test("supported extreme day buckets are finite and overflowing canonical weeks fail safely", () => {
  for (const date of ["1900-01-01", "9999-12-31"]) {
    const buckets = buildBucketRanges({
      startDate: date,
      endDate: date,
      groupBy: "day",
      today: date,
    });
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].period_start, date);
  }
  assert.throws(
    () =>
      buildBucketRanges({
        startDate: "9999-12-31",
        endDate: "9999-12-31",
        groupBy: "week",
        today: "9999-12-31",
      }),
    /supported date range/,
  );
});

test("goal comparison uses current targets across elapsed dates including unlogged days", () => {
  const comparison = buildGoalComparison({
    rows: [dailyRow("2026-09-07", { calories_kcal: "250.0000" })],
    goals: goals({
      daily_protein_g: 0,
      daily_carbs_g: null,
      daily_fat_g: 1_000_000,
    }),
    startDate: "2026-09-07",
    endDate: "2026-09-13",
    today: "2026-09-12",
  });

  assert.equal(comparison.day_count, 6);
  assert.deepEqual(comparison.calories_kcal, {
    actual: 250,
    target: 12_000,
    difference: -11_750,
    percent: 2.08,
  });
  assert.deepEqual(comparison.protein_g, {
    actual: 0,
    target: 0,
    difference: 0,
    percent: null,
  });
  assert.deepEqual(comparison.carbs_g, {
    actual: 0,
    target: null,
    difference: null,
    percent: null,
  });
  assert.equal(comparison.fat_g.target, 6_000_000);
});

test("future comparisons have zero actuals and no targets while percentages are not clamped", () => {
  const future = buildGoalComparison({
    rows: [],
    goals: goals(),
    startDate: "2026-09-13",
    endDate: "2026-09-14",
    today: "2026-09-12",
  });
  assert.equal(future.day_count, 0);
  assert.equal(future.calories_kcal.actual, 0);
  assert.equal(future.calories_kcal.target, null);

  const above = buildGoalComparison({
    rows: [dailyRow("2026-09-12", { calories_kcal: "2500.0000" })],
    goals: goals(),
    startDate: "2026-09-12",
    endDate: "2026-09-12",
    today: "2026-09-12",
  });
  assert.equal(above.calories_kcal.percent, 125);
});

test("comparison percentage refuses a non-finite JSON result", () => {
  const huge = "1" + "0".repeat(306) + ".0000";
  assert.throws(
    () =>
      buildGoalComparison({
        rows: [dailyRow("2026-09-12", { calories_kcal: huge })],
        goals: goals({ daily_calories_kcal: 0.0001 }),
        startDate: "2026-09-12",
        endDate: "2026-09-12",
        today: "2026-09-12",
      }),
    /finite JSON number range/,
  );
});
