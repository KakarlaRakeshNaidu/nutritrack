import assert from "node:assert/strict";
import test from "node:test";

import { mealListQuerySchema } from "../src/modules/meals/meal.schemas.js";
import { reportQuerySchema } from "../src/modules/reports/report.schemas.js";

test("report query defaults grouping and strict bucket paging", () => {
  assert.deepEqual(reportQuerySchema.parse({}), {
    group_by: "day",
    page: 1,
    page_size: 20,
  });
  assert.deepEqual(
    reportQuerySchema.parse({
      start_date: "2024-01-01",
      end_date: "2024-12-31",
      group_by: "week",
      page: "0002",
      page_size: "0100",
    }),
    {
      start_date: "2024-01-01",
      end_date: "2024-12-31",
      group_by: "week",
      page: 2,
      page_size: 100,
    },
  );
});

test("report query requires a valid paired range of at most 366 days", () => {
  for (const query of [
    { start_date: "2026-09-01" },
    { end_date: "2026-09-01" },
    { start_date: "2026-09-02", end_date: "2026-09-01" },
    { start_date: "2025-02-29", end_date: "2025-03-01" },
    { start_date: "2024-01-01", end_date: "2025-01-01" },
  ]) {
    assert.equal(reportQuerySchema.safeParse(query).success, false);
  }

  assert.equal(
    reportQuerySchema.safeParse({
      start_date: "2026-09-12",
      end_date: "2026-09-12",
    }).success,
    true,
  );
});

test("report query rejects unsupported grouping, meal filters, arrays, and paging forms", () => {
  for (const query of [
    { group_by: "month" },
    { meal_type: "breakfast" },
    { page: ["1", "2"] },
    { start_date: ["2026-09-01", "2026-09-02"], end_date: "2026-09-03" },
    { page: "" },
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "1e2" },
    { page_size: "101" },
    { extra: "value" },
  ]) {
    assert.equal(reportQuerySchema.safeParse(query).success, false);
  }
});

test("the report cap does not alter longer meal-history ranges", () => {
  assert.equal(
    mealListQuerySchema.safeParse({
      start_date: "2024-01-01",
      end_date: "2025-01-01",
    }).success,
    true,
  );
});
