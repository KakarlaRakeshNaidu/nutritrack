import assert from "node:assert/strict";
import test from "node:test";

import type { QueryConfig } from "pg";
import { aggregateNutritionByDate } from "../src/modules/reports/report.repository.js";

test("daily report aggregation is one bounded parameterized query without raw meal paging", async () => {
  let call: QueryConfig<unknown[]> | undefined;
  const rows = [{ consumption_date: "2026-09-12" }];
  const executor = {
    async query(query: string | QueryConfig<unknown[]>) {
      assert.notEqual(typeof query, "string");
      call = query as QueryConfig<unknown[]>;
      return { rows };
    },
  };

  assert.equal(
    await aggregateNutritionByDate(executor, {
      startDate: "2026-09-01",
      endDate: "2026-09-12",
    }, "00000000-0000-4000-8000-000000000099"),
    rows,
  );
  assert(call);
  assert.deepEqual(call.values, ["00000000-0000-4000-8000-000000000099", "2026-09-01", "2026-09-12"]);
  assert.match(
    call.text,
    /WHERE user_id = \$1 AND consumption_date >= \$2 AND consumption_date <= \$3/,
  );
  assert.match(call.text, /GROUP BY consumption_date/);
  assert.match(call.text, /sum\(sodium_mg\).*count\(sodium_mg\)/s);
  assert.doesNotMatch(call.text, /LIMIT|OFFSET|meal_type/i);
});
