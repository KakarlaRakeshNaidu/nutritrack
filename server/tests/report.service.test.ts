import assert from "node:assert/strict";
import test from "node:test";

import { reportQuerySchema } from "../src/modules/reports/report.schemas.js";
import { createReportService } from "../src/modules/reports/report.service.js";
import { AppError } from "../src/utils/errors.js";
import type {
  ReportAggregateRow,
} from "../src/modules/reports/report.calculations.js";
import type {
  DatabasePool,
  TransactionClient,
} from "../src/types.js";

type ReportDependencies = Parameters<typeof createReportService>[0];
type ReportRepository = NonNullable<ReportDependencies["repository"]>;
type TransactionRunner = NonNullable<ReportDependencies["transaction"]>;

interface HarnessOverrides {
  repository?: Partial<ReportRepository>;
  service?: Partial<ReportDependencies>;
}

function row(
  date: string,
  calories = "0.0000",
  entryCount = "1",
): ReportAggregateRow {
  const result: ReportAggregateRow = {
    consumption_date: date,
    entry_count: entryCount,
    calories_kcal: calories,
    protein_g: "0.0000",
    carbs_g: "0.0000",
    fat_g: "0.0000",
  };
  for (const field of [
    "sodium_mg",
    "calcium_mg",
    "iron_mg",
    "potassium_mg",
    "vitamin_c_mg",
    "vitamin_d_mcg",
  ]) {
    result[field + "_known_total"] = null;
    result[field + "_known_count"] = "0";
  }
  return result;
}

function harness(overrides: HarnessOverrides = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const client: TransactionClient & { marker: string } = {
    marker: "checked-out-client",
    async query() {
      return { rows: [] };
    },
    release() {},
  };
  const pool: DatabasePool & { marker: string } = {
    marker: "shared-pool",
    query: client.query,
    async connect() {
      return client;
    },
    async end() {},
  };
  const repository: ReportRepository = {
    async findSingletonProfile(executor) {
      calls.push(["profile", executor]);
      return { display_name: "Rakesh", timezone: "Asia/Kolkata" };
    },
    async findSingletonGoals(executor) {
      calls.push(["goals", executor]);
      return {
        daily_calories_kcal: 2000,
        daily_protein_g: 0,
        daily_carbs_g: null,
        daily_fat_g: 70,
        target_weight_kg: 75,
        updated_at: "2026-09-12T00:00:00.000Z",
      };
    },
    async aggregateNutritionByDate(executor, range) {
      calls.push(["aggregate", executor, range]);
      return [row("2026-09-07", "250.0000", "25")];
    },
    ...overrides.repository,
  };
  const transaction: TransactionRunner = async <Result>(
    suppliedPool: DatabasePool,
    operation: (checkedOutClient: TransactionClient) => Promise<Result>,
    options: { mode: "readOnlySnapshot" },
  ): Promise<Result> => {
    calls.push(["transaction", suppliedPool, options]);
    return operation(client);
  };
  return {
    calls,
    client,
    pool,
    service: createReportService({
      pool,
      repository,
      transaction,
      clock: () => new Date("2026-09-12T12:00:00.000Z"),
      ...overrides.service,
    }),
  };
}

test("service uses one read-only snapshot and paginates complete day buckets", async () => {
  const instance = harness();
  const response = await instance.service.getNutritionReport(
    reportQuerySchema.parse({
      start_date: "2026-09-07",
      end_date: "2026-09-13",
      page: "2",
      page_size: "2",
    }),
  );

  assert.deepEqual(response.pagination, {
    page: 2,
    page_size: 2,
    total_items: 7,
    total_pages: 4,
  });
  assert.deepEqual(
    response.items.map((item) => item.period_start),
    ["2026-09-09", "2026-09-10"],
  );
  assert.equal(response.summary.entry_count, 25);
  assert.equal(response.summary.calories_kcal, 250);
  assert.equal(response.goal_comparison.calories_kcal.target, 12_000);
  assert.equal(response.goal_comparison.calories_kcal.difference, -11_750);
  assert.equal(response.goal_comparison.calories_kcal.percent, 2.08);
  assert.equal(response.goal_snapshot.target_weight_kg, 75);

  const transactionCall = instance.calls.find(
    ([name]) => name === "transaction",
  );
  assert(transactionCall);
  assert.equal(transactionCall[1], instance.pool);
  assert.deepEqual(transactionCall[2], { mode: "readOnlySnapshot" });
  for (const call of instance.calls.filter(([name]) =>
    ["profile", "goals", "aggregate"].includes(name),
  )) {
    assert.equal(call[1], instance.client);
  }
  assert.deepEqual(
    instance.calls
      .filter(([name]) => name !== "transaction")
      .map(([name]) => name),
    ["profile", "goals", "aggregate"],
  );
});

test("summary and comparison stay full-range across grouping and out-of-range pages", async () => {
  const instance = harness();
  const common = {
    start_date: "2026-09-07",
    end_date: "2026-09-13",
  };
  const day = await instance.service.getNutritionReport(
    reportQuerySchema.parse({ ...common, page_size: "2" }),
  );
  const week = await instance.service.getNutritionReport(
    reportQuerySchema.parse({ ...common, group_by: "week" }),
  );
  const emptyPage = await instance.service.getNutritionReport(
    reportQuerySchema.parse({ ...common, page: "99", page_size: "2" }),
  );

  assert.deepEqual(week.summary, day.summary);
  assert.deepEqual(week.goal_comparison, day.goal_comparison);
  assert.deepEqual(emptyPage.summary, day.summary);
  assert.deepEqual(emptyPage.goal_comparison, day.goal_comparison);
  assert.deepEqual(emptyPage.items, []);
  assert.equal(week.items.length, 1);
});

test("default range is the persisted timezone's Monday through Sunday", async () => {
  const instance = harness();
  const response = await instance.service.getNutritionReport(
    reportQuerySchema.parse({}),
  );
  assert.deepEqual(response.range, {
    start_date: "2026-09-07",
    end_date: "2026-09-13",
    group_by: "day",
    timezone: "Asia/Kolkata",
    today: "2026-09-12",
  });
  const aggregate = instance.calls.find(([name]) => name === "aggregate");
  assert(aggregate);
  assert.deepEqual(aggregate[2], {
    startDate: "2026-09-07",
    endDate: "2026-09-13",
  });
});

test("one instant resolves different UTC and Kolkata calendar weeks at midnight", async () => {
  const instant = () => new Date("2026-09-13T20:00:00.000Z");
  const kolkata = harness({ service: { clock: instant } });
  const utc = harness({
    service: { clock: instant },
    repository: {
      async findSingletonProfile() {
        return { display_name: "Rakesh", timezone: "UTC" };
      },
    },
  });

  const kolkataReport = await kolkata.service.getNutritionReport(
    reportQuerySchema.parse({}),
  );
  const utcReport = await utc.service.getNutritionReport(
    reportQuerySchema.parse({}),
  );
  assert.equal(kolkataReport.range.today, "2026-09-14");
  assert.equal(kolkataReport.range.start_date, "2026-09-14");
  assert.equal(utcReport.range.today, "2026-09-13");
  assert.equal(utcReport.range.start_date, "2026-09-07");
});

test("missing singletons and invalid timezone fail safely", async () => {
  for (const repository of [
    { async findSingletonProfile() { return null; } },
    {
      async findSingletonProfile() {
        return { display_name: "Rakesh", timezone: "Invalid/Zone" };
      },
    },
    { async findSingletonGoals() { return null; } },
  ]) {
    const instance = harness({ repository });
    await assert.rejects(
      instance.service.getNutritionReport(reportQuerySchema.parse({})),
      (error) => {
        assert(error instanceof AppError);
        return (
          error.status === 500 &&
          error.code === "INTERNAL_ERROR" &&
          error.message === "An unexpected error occurred."
        );
      },
    );
  }
});

test("known database failures map to stable service errors", async () => {
  const instance = harness({
    repository: {
      async aggregateNutritionByDate() {
        throw Object.assign(new Error("private SQL detail"), {
          code: "57014",
        });
      },
    },
  });
  await assert.rejects(
    instance.service.getNutritionReport(reportQuerySchema.parse({})),
    (error) => {
      assert(error instanceof AppError);
      return error.status === 503 && error.code === "DATABASE_TIMEOUT";
    },
  );
});
