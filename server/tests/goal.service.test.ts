import assert from "node:assert/strict";
import test from "node:test";

import { createGoalService } from "../src/modules/goals/goal.service.js";
import { AppError } from "../src/utils/errors.js";
import type { GoalInput } from "../src/modules/goals/goal.schemas.js";
import type { DatabaseExecutor } from "../src/types.js";

type GoalRepository = NonNullable<
  Parameters<typeof createGoalService>[0]["repository"]
>;

const EMPTY_GOALS: GoalInput = {
  daily_calories_kcal: null,
  daily_protein_g: null,
  daily_carbs_g: null,
  daily_fat_g: null,
  target_weight_kg: null,
};

function goalData() {
  return {
    daily_calories_kcal: 2200,
    daily_protein_g: 0,
    daily_carbs_g: null,
    daily_fat_g: 70,
    target_weight_kg: null,
    updated_at: "2026-09-13T10:00:00.000Z",
  };
}

function harness(repositoryOverrides: Partial<GoalRepository> = {}) {
  const calls: unknown[][] = [];
  const pool: DatabaseExecutor & { marker: string } = {
    marker: "shared-pool",
    async query() {
      return { rows: [] };
    },
  };
  const repository: GoalRepository = {
    async findSingletonGoals(executor) {
      calls.push(["find", executor]);
      return goalData();
    },
    async replaceSingletonGoals(executor, goals) {
      calls.push(["replace", executor, goals]);
      return { ...goals, updated_at: goalData().updated_at };
    },
    ...repositoryOverrides,
  };
  return {
    calls,
    pool,
    service: createGoalService({ pool, repository }),
  };
}

test("goal service reads and fully replaces through the supplied shared pool", async () => {
  const instance = harness();
  const input = {
    daily_calories_kcal: null,
    daily_protein_g: 0,
    daily_carbs_g: 0,
    daily_fat_g: null,
    target_weight_kg: null,
  };

  assert.equal((await instance.service.getGoals()).daily_protein_g, 0);
  assert.deepEqual(await instance.service.replaceGoals(input), {
    ...input,
    updated_at: goalData().updated_at,
  });
  assert.equal(instance.calls[0][1], instance.pool);
  assert.equal(instance.calls[1][1], instance.pool);
  assert.equal(instance.calls[1][2], input);
});

test("a missing migrated singleton fails safely for both reads and writes", async () => {
  const instance = harness({
    async findSingletonGoals() {
      return null;
    },
    async replaceSingletonGoals() {
      return null;
    },
  });
  await assert.rejects(
    instance.service.getGoals(),
    (error) => {
      assert(error instanceof AppError);
      return (
        error.status === 500 &&
        error.code === "INTERNAL_ERROR" &&
        error.message === "An unexpected error occurred."
      );
    },
  );
  await assert.rejects(
    instance.service.replaceGoals(EMPTY_GOALS),
    (error) => {
      assert(error instanceof AppError);
      return error.status === 500 && error.code === "INTERNAL_ERROR";
    },
  );
});

test("known database outages map to 503 and unexpected failures remain internal", async () => {
  for (const [code, expected] of [
    ["57014", "DATABASE_TIMEOUT"],
    ["ECONNRESET", "DATABASE_UNAVAILABLE"],
  ]) {
    const instance = harness({
      async findSingletonGoals() {
        throw Object.assign(new Error("private database detail"), { code });
      },
    });
    await assert.rejects(
      instance.service.getGoals(),
      (error) => {
        assert(error instanceof AppError);
        return error.status === 503 && error.code === expected;
      },
    );
  }

  const unexpected = harness({
    async replaceSingletonGoals() {
      throw new Error("private SQL detail");
    },
  });
  await assert.rejects(
    unexpected.service.replaceGoals(EMPTY_GOALS),
    /private SQL detail/,
  );
});
