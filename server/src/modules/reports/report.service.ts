import { mapDatabaseError } from "../../db/database-errors.js";
import { withTransaction } from "../../db/transaction.js";
import {
  getTodayInTimeZone,
  getWeekBounds,
} from "../../utils/calendar.js";
import { AppError } from "../../utils/errors.js";
import type { Clock, DatabaseExecutor, DatabasePool, TransactionClient } from "../../types.js";
import { findSingletonGoals } from "../goals/goal.repository.js";
import type { Goal } from "../goals/goal.repository.js";
import { findSingletonProfile } from "../profile/profile.repository.js";
import {
  buildBucketRanges,
  buildGoalComparison,
  serializeSummary,
  summarizeDailyRows,
} from "./report.calculations.js";
import type {
  GoalComparison,
  ReportAggregateRow,
  ReportBucket,
  SerializedSummary,
} from "./report.calculations.js";
import { aggregateNutritionByDate } from "./report.repository.js";

import type { ReportQuery } from "./report.schemas.js";

type PersistedProfile = Record<string, unknown> & {
  display_name: string;
  timezone: string;
};

interface ReportRepository {
  aggregateNutritionByDate(
    executor: DatabaseExecutor,
    range: { startDate: string; endDate: string },
  ): Promise<ReportAggregateRow[]>;
  findSingletonGoals(executor: DatabaseExecutor): Promise<Goal | null>;
  findSingletonProfile(
    executor: DatabaseExecutor,
  ): Promise<Record<string, unknown> | null>;
}

type TransactionRunner = <Result>(
  pool: DatabasePool,
  operation: (client: TransactionClient) => Promise<Result>,
  options: { mode: "readOnlySnapshot" },
) => Promise<Result>;

interface ReportServiceDependencies {
  pool: DatabasePool;
  clock?: Clock;
  transaction?: TransactionRunner;
  repository?: ReportRepository;
}

export interface NutritionReport {
  range: {
    start_date: string;
    end_date: string;
    group_by: ReportQuery["group_by"];
    timezone: string;
    today: string;
  };
  summary: SerializedSummary;
  goal_snapshot: Goal;
  goal_comparison: GoalComparison;
  items: Array<
    ReportBucket &
      SerializedSummary & {
        goal_comparison: GoalComparison;
      }
  >;
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
}

export interface ReportService {
  getNutritionReport(query: ReportQuery): Promise<NutritionReport>;
}

function invalidPersistentSingleton(): AppError {
  return new AppError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
}

function resolveRange(
  query: ReportQuery,
  today: string,
): { startDate: string; endDate: string } {
  if (query.start_date !== undefined && query.end_date !== undefined) {
    return {
      startDate: query.start_date,
      endDate: query.end_date,
    };
  }

  if (query.start_date !== undefined || query.end_date !== undefined) {
    throw new TypeError("Validated report range must contain both dates.");
  }

  const { weekStart, weekEnd } = getWeekBounds(today);
  return { startDate: weekStart, endDate: weekEnd };
}

function validProfile(
  profile: Record<string, unknown> | null,
): profile is PersistedProfile {
  return (
    profile !== null &&
    typeof profile.display_name === "string" &&
    profile.display_name.trim().length > 0 &&
    typeof profile.timezone === "string" &&
    profile.timezone.trim().length > 0
  );
}

export function createReportService(
  {
    pool,
    clock = () => new Date(),
    transaction = withTransaction,
    repository = {
      aggregateNutritionByDate,
      findSingletonGoals,
      findSingletonProfile,
    },
  }: ReportServiceDependencies,
): ReportService {
  return {
    async getNutritionReport(query: ReportQuery) {
      // One captured instant defines today for the entire response, even when
      // the request overlaps a timezone midnight during database work.
      const instant = clock();

      try {
        return await transaction(
          pool,
          async (client) => {
            // Profile, goals, and aggregates all use this exact transaction
            // client so no response can mix values from different snapshots.
            const profile = await repository.findSingletonProfile(client);
            if (!validProfile(profile)) {
              throw invalidPersistentSingleton();
            }

            let today: string;
            let resolved: { startDate: string; endDate: string };
            try {
              today = getTodayInTimeZone(instant, profile.timezone);
              resolved = resolveRange(query, today);
            } catch {
              throw invalidPersistentSingleton();
            }

            const goals = await repository.findSingletonGoals(client);
            if (!goals) {
              throw invalidPersistentSingleton();
            }

            const rows = await repository.aggregateNutritionByDate(client, {
              startDate: resolved.startDate,
              endDate: resolved.endDate,
            });
            const fullSummary = summarizeDailyRows(
              rows,
              resolved.startDate,
              resolved.endDate,
            );
            const buckets = buildBucketRanges({
              ...resolved,
              groupBy: query.group_by,
              today,
            });
            const offset = (query.page - 1) * query.page_size;
            const items = buckets
              .slice(offset, offset + query.page_size)
              .map((bucket) => {
                const bucketSummary = summarizeDailyRows(
                  rows,
                  bucket.covered_start,
                  bucket.covered_end,
                );
                return {
                  ...bucket,
                  ...serializeSummary(bucketSummary),
                  goal_comparison: buildGoalComparison({
                    rows,
                    goals,
                    startDate: bucket.covered_start,
                    endDate: bucket.covered_end,
                    today,
                  }),
                };
              });
            const totalItems = buckets.length;

            return {
              range: {
                start_date: resolved.startDate,
                end_date: resolved.endDate,
                group_by: query.group_by,
                timezone: profile.timezone,
                today,
              },
              summary: serializeSummary(fullSummary),
              goal_snapshot: goals,
              goal_comparison: buildGoalComparison({
                rows,
                goals,
                startDate: resolved.startDate,
                endDate: resolved.endDate,
                today,
              }),
              items,
              pagination: {
                page: query.page,
                page_size: query.page_size,
                total_items: totalItems,
                total_pages: Math.ceil(totalItems / query.page_size),
              },
            };
          },
          { mode: "readOnlySnapshot" },
        );
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
}
