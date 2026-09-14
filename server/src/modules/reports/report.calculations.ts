import {
  addCalendarDays,
  compareCalendarDates,
  getWeekBounds,
  inclusiveDayCount,
  isValidCalendarDate,
} from "../../utils/calendar.js";
import type { Goal } from "../goals/goal.repository.js";


export const CORE_REPORT_FIELDS = [
  "calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
] as const;

export const MICRO_REPORT_FIELDS = {
  sodium_mg: "mg",
  calcium_mg: "mg",
  iron_mg: "mg",
  potassium_mg: "mg",
  vitamin_c_mg: "mg",
  vitamin_d_mcg: "mcg",
} as const;
const MICRO_REPORT_FIELD_NAMES = [
  "sodium_mg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
  "vitamin_c_mg",
  "vitamin_d_mcg",
] as const;


const GOAL_FIELDS = {
  calories_kcal: "daily_calories_kcal",
  protein_g: "daily_protein_g",
  carbs_g: "daily_carbs_g",
  fat_g: "daily_fat_g",
} as const;

export type CoreReportField = (typeof CORE_REPORT_FIELDS)[number];
export type MicroReportField = keyof typeof MICRO_REPORT_FIELDS;
export type ReportGrouping = "day" | "week";

export interface ReportAggregateRow extends Record<string, unknown> {
  consumption_date: string;
  entry_count: unknown;
}

interface MicroAccumulator {
  knownTotal: bigint;
  knownCount: number;
}

export interface SummaryAccumulator {
  entryCount: number;
  loggedDayCount: number;
  core: Record<CoreReportField, bigint>;
  micros: Record<MicroReportField, MicroAccumulator>;
}

export interface SerializedMicroSummary {
  unit: string;
  known_total: number | null;
  known_count: number;
  unknown_count: number;
  entry_count: number;
}

export interface SerializedSummary {
  entry_count: number;
  logged_day_count: number;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  micronutrients: Record<MicroReportField, SerializedMicroSummary>;
}

export interface ElapsedRange {
  scopeStart: string | null;
  scopeEnd: string | null;
  dayCount: number;
}

export interface GoalMetric {
  actual: number;
  target: number | null;
  difference: number | null;
  percent: number | null;
}

export interface GoalComparison extends Record<CoreReportField, GoalMetric> {
  basis: "current_daily_targets";
  scope_start: string | null;
  scope_end: string | null;
  day_count: number;
}

export interface ReportBucket {
  period_start: string;
  period_end: string;
  covered_start: string;
  covered_end: string;
  calendar_day_count: number;
  elapsed_day_count: number;
  temporal_state: "past" | "current" | "future";
}


const DECIMAL_SCALE = 10_000n;
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const COUNT_PATTERN = /^\d+$/;

function scaledDecimal(value: unknown, label: string): bigint {
  const text = typeof value === "number" ? String(value) : value;
  const match = typeof text === "string" ? DECIMAL_PATTERN.exec(text) : null;
  if (!match || (match[3]?.length ?? 0) > 4) {
    throw new TypeError(label + " must be an exact decimal with at most four places.");
  }

  const fraction = (match[3] ?? "").padEnd(4, "0");
  const magnitude = BigInt(match[2]) * DECIMAL_SCALE + BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function decimalNumber(value: bigint, label: string): number {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / DECIMAL_SCALE;
  const fraction = String(magnitude % DECIMAL_SCALE)
    .padStart(4, "0")
    .replace(/0+$/, "");
  const text =
    (negative ? "-" : "") +
    String(whole) +
    (fraction.length > 0 ? "." + fraction : "");
  const number = Number(text);

  if (!Number.isFinite(number)) {
    throw new TypeError(label + " exceeds the finite JSON number range.");
  }
  return number;
}

function countNumber(value: unknown, label: string): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !COUNT_PATTERN.test(text)) {
    throw new TypeError(label + " must be a nonnegative integer.");
  }
  const count = Number(text);
  if (!Number.isSafeInteger(count)) {
    throw new TypeError(label + " exceeds the supported JSON integer range.");
  }
  return count;
}

function emptyAccumulator(): SummaryAccumulator {
  return {
    entryCount: 0,
    loggedDayCount: 0,
    core: {
      calories_kcal: 0n,
      protein_g: 0n,
      carbs_g: 0n,
      fat_g: 0n,
    },
    micros: {
      sodium_mg: { knownTotal: 0n, knownCount: 0 },
      calcium_mg: { knownTotal: 0n, knownCount: 0 },
      iron_mg: { knownTotal: 0n, knownCount: 0 },
      potassium_mg: { knownTotal: 0n, knownCount: 0 },
      vitamin_c_mg: { knownTotal: 0n, knownCount: 0 },
      vitamin_d_mcg: { knownTotal: 0n, knownCount: 0 },
    },
  };
}

function selectRows(
  rows: ReportAggregateRow[],
  startDate: string,
  endDate: string,
): ReportAggregateRow[] {
  return rows.filter(
    (row) =>
      row.consumption_date >= startDate && row.consumption_date <= endDate,
  );
}

export function summarizeDailyRows(
  rows: ReportAggregateRow[],
  startDate: string,
  endDate: string,
): SummaryAccumulator {
  const accumulator = emptyAccumulator();

  for (const row of selectRows(rows, startDate, endDate)) {
    if (!isValidCalendarDate(row.consumption_date)) {
      throw new TypeError("Persisted aggregate date is invalid.");
    }

    const entryCount = countNumber(row.entry_count, "Aggregate entry count");
    if (entryCount < 1) {
      throw new TypeError("A persisted daily aggregate must contain an entry.");
    }
    accumulator.entryCount += entryCount;
    accumulator.loggedDayCount += 1;

    for (const field of CORE_REPORT_FIELDS) {
      // Stored nutrition is already the consumed total. Each daily SUM is added
      // once; quantity is never applied again and per-meal rounding is avoided.
      accumulator.core[field] += scaledDecimal(
        row[field],
        "Aggregate " + field,
      );
    }

    for (const field of MICRO_REPORT_FIELD_NAMES) {
      const knownCount = countNumber(
        row[field + "_known_count"],
        "Aggregate " + field + " known count",
      );
      if (knownCount > entryCount) {
        throw new TypeError("Micronutrient coverage exceeds its entry count.");
      }
      const knownTotal = row[field + "_known_total"];
      if (knownCount === 0) {
        if (knownTotal !== null) {
          throw new TypeError("All-unknown micronutrient total must be null.");
        }
      } else {
        accumulator.micros[field].knownTotal += scaledDecimal(
          knownTotal,
          "Aggregate " + field + " known total",
        );
      }
      accumulator.micros[field].knownCount += knownCount;
    }
  }

  if (!Number.isSafeInteger(accumulator.entryCount)) {
    throw new TypeError("Aggregate entry count exceeds the supported JSON range.");
  }
  return accumulator;
}

export function serializeSummary(accumulator: SummaryAccumulator): SerializedSummary {
  const micronutrients = {} as Record<MicroReportField, SerializedMicroSummary>;

  for (const field of MICRO_REPORT_FIELD_NAMES) {
    const unit = MICRO_REPORT_FIELDS[field];
    const coverage = accumulator.micros[field];
    micronutrients[field] = {
      unit,
      known_total:
        coverage.knownCount === 0
          ? null
          : decimalNumber(coverage.knownTotal, field + " known total"),
      known_count: coverage.knownCount,
      unknown_count: accumulator.entryCount - coverage.knownCount,
      entry_count: accumulator.entryCount,
    };
  }

  return {
    entry_count: accumulator.entryCount,
    logged_day_count: accumulator.loggedDayCount,
    calories_kcal: decimalNumber(accumulator.core.calories_kcal, "calories_kcal"),
    protein_g: decimalNumber(accumulator.core.protein_g, "protein_g"),
    carbs_g: decimalNumber(accumulator.core.carbs_g, "carbs_g"),
    fat_g: decimalNumber(accumulator.core.fat_g, "fat_g"),
    micronutrients,
  };
}

export function elapsedRange(
  startDate: string,
  endDate: string,
  today: string,
): ElapsedRange {
  if (compareCalendarDates(startDate, today) > 0) {
    return { scopeStart: null, scopeEnd: null, dayCount: 0 };
  }

  const scopeEnd =
    compareCalendarDates(endDate, today) > 0 ? today : endDate;
  return {
    scopeStart: startDate,
    scopeEnd,
    dayCount: inclusiveDayCount(startDate, scopeEnd),
  };
}

function roundedPercentage(actual: bigint, target: bigint): number {
  // The scaled units cancel. Multiplying by 10,000 produces percentage
  // hundredths directly, allowing deterministic half-up rounding via BigInt.
  const numerator = actual * 10_000n;
  let hundredths = numerator / target;
  if ((numerator % target) * 2n >= target) {
    hundredths += 1n;
  }
  const percentage = Number(hundredths) / 100;
  if (!Number.isFinite(percentage)) {
    throw new TypeError(
      "Calculated percentage exceeds the finite JSON number range.",
    );
  }
  return percentage;
}

export function buildGoalComparison(
  {
    rows,
    goals,
    startDate,
    endDate,
    today,
  }: {
    rows: ReportAggregateRow[];
    goals: Goal;
    startDate: string;
    endDate: string;
    today: string;
  },
): GoalComparison {
  const { scopeStart, scopeEnd, dayCount } = elapsedRange(
    startDate,
    endDate,
    today,
  );
  const actuals =
    scopeStart === null || scopeEnd === null
      ? emptyAccumulator()
      : summarizeDailyRows(rows, scopeStart, scopeEnd);
  const comparison = {
    basis: "current_daily_targets",
    scope_start: scopeStart,
    scope_end: scopeEnd,
    day_count: dayCount,
  } as GoalComparison;

  for (const field of CORE_REPORT_FIELDS) {
    const actualExact = actuals.core[field];
    const dailyTarget = goals[GOAL_FIELDS[field]];
    let targetExact: bigint | null = null;

    // Current-only goals intentionally apply to every elapsed calendar date,
    // including dates without entries. They are not historical goal versions.
    if (dailyTarget !== null && dayCount > 0) {
      targetExact =
        scaledDecimal(dailyTarget, "Current " + field + " goal") *
        BigInt(dayCount);
    }

    comparison[field] = {
      actual: decimalNumber(actualExact, field + " actual"),
      target:
        targetExact === null
          ? null
          : decimalNumber(targetExact, field + " target"),
      difference:
        targetExact === null
          ? null
          : decimalNumber(
              actualExact - targetExact,
              field + " difference",
            ),
      percent:
        targetExact !== null && targetExact > 0n
          ? roundedPercentage(actualExact, targetExact)
          : null,
    };
  }

  return comparison;
}

export function buildBucketRanges(
  {
    startDate,
    endDate,
    groupBy,
    today,
  }: {
    startDate: string;
    endDate: string;
    groupBy: ReportGrouping;
    today: string;
  },
): ReportBucket[] {
  const buckets: ReportBucket[] = [];

  if (groupBy === "day") {
    let date = startDate;
    while (true) {
      const elapsed = elapsedRange(date, date, today);
      buckets.push({
        period_start: date,
        period_end: date,
        covered_start: date,
        covered_end: date,
        calendar_day_count: 1,
        elapsed_day_count: elapsed.dayCount,
        temporal_state:
          date > today ? "future" : date < today ? "past" : "current",
      });
      if (date === endDate) {
        break;
      }
      date = addCalendarDays(date, 1);
    }
    return buckets;
  }

  let { weekStart } = getWeekBounds(startDate);
  while (true) {
    const { weekEnd } = getWeekBounds(weekStart);
    // Canonical week labels remain Monday/Sunday while calculations use only
    // the intersection with the requested range.
    const coveredStart = weekStart < startDate ? startDate : weekStart;
    const coveredEnd = weekEnd > endDate ? endDate : weekEnd;
    const elapsed = elapsedRange(coveredStart, coveredEnd, today);
    buckets.push({
      period_start: weekStart,
      period_end: weekEnd,
      covered_start: coveredStart,
      covered_end: coveredEnd,
      calendar_day_count: inclusiveDayCount(coveredStart, coveredEnd),
      elapsed_day_count: elapsed.dayCount,
      temporal_state:
        coveredStart > today
          ? "future"
          : coveredEnd < today
            ? "past"
            : "current",
    });
    if (coveredEnd === endDate) {
      break;
    }
    weekStart = addCalendarDays(weekStart, 7);
  }

  return buckets;
}
