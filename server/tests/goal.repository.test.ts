import assert from "node:assert/strict";
import test from "node:test";
import type { QueryConfig } from "pg";
import type { GoalInput } from "../src/modules/goals/goal.schemas.js";

import {
  findSingletonGoals,
  mapGoalRow,
  replaceSingletonGoals,
} from "../src/modules/goals/goal.repository.js";

const UPDATED_AT = new Date("2026-09-13T10:00:00Z");

function goalInput(overrides: Partial<GoalInput> = {}): GoalInput {
  return {
    daily_calories_kcal: 2200.125,
    daily_protein_g: 0,
    daily_carbs_g: 250.5,
    daily_fat_g: null,
    target_weight_kg: 72.3456,
    ...overrides,
  };
}

function goalRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    daily_calories_kcal: "2200.1250",
    daily_protein_g: "0.0000",
    daily_carbs_g: "250.5000",
    daily_fat_g: null,
    target_weight_kg: "72.3456",
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

test("goal row mapping preserves nullable numerics, explicit zero, and UTC time", () => {
  assert.deepEqual(mapGoalRow(goalRow()), {
    ...goalInput(),
    updated_at: "2026-09-13T10:00:00.000Z",
  });
  assert.equal(mapGoalRow(null), null);
  assert.throws(
    () => mapGoalRow(goalRow({ daily_carbs_g: "not-numeric" })),
    /finite/,
  );
  assert.throws(
    () => mapGoalRow(goalRow({ updated_at: "not-a-time" })),
    /valid/,
  );
});

test("singleton read uses only the fixed parameterized identifier", async () => {
  let call: QueryConfig<unknown[]> | undefined;
  const executor = {
    async query(query: string | QueryConfig<unknown[]>) {
      assert.notEqual(typeof query, "string");
      call = query as QueryConfig<unknown[]>;
      return { rowCount: 1, rows: [goalRow()] };
    },
  };

  const goals = await findSingletonGoals(executor, "00000000-0000-4000-8000-000000000099");
  assert(goals);
  assert(call);
  assert.equal(goals.daily_protein_g, 0);
  assert.deepEqual(call.values, ["00000000-0000-4000-8000-000000000099"]);
  assert.match(call.text, /FROM goals WHERE user_id = \$1/);
  assert.doesNotMatch(call.text, /created_at|SELECT id/);
});

test("replacement is one atomic parameterized update with no upsert or precheck", async () => {
  const calls: QueryConfig<unknown[]>[] = [];
  const executor = {
    async query(query: string | QueryConfig<unknown[]>) {
      assert.notEqual(typeof query, "string");
      calls.push(query as QueryConfig<unknown[]>);
      return { rowCount: 1, rows: [goalRow()] };
    },
  };
  const input = goalInput();

  await replaceSingletonGoals(executor, input, "00000000-0000-4000-8000-000000000099");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [
    2200.125,
    0,
    250.5,
    null,
    72.3456,
    "00000000-0000-4000-8000-000000000099",
  ]);
  assert.match(calls[0].text, /^UPDATE goals SET/);
  assert.match(calls[0].text, /updated_at = now\(\) WHERE user_id = \$6 RETURNING/);
  assert.doesNotMatch(calls[0].text, /INSERT|ON CONFLICT|BEGIN/i);
});

test("missing singleton rows map to null without inserting a replacement", async () => {
  const executor = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  };
  assert.equal(await findSingletonGoals(executor, "00000000-0000-4000-8000-000000000099"), null);
  assert.equal(await replaceSingletonGoals(executor, goalInput(), "00000000-0000-4000-8000-000000000099"), null);
});
