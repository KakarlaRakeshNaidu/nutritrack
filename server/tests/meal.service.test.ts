import assert from "node:assert/strict";
import test from "node:test";

import { createMealService } from "../src/modules/meals/meal.service.js";
import { AppError } from "../src/utils/errors.js";
import type { Meal } from "../src/modules/meals/meal.repository.js";
import type { MealInput } from "../src/modules/meals/meal.schemas.js";
import type {
  DatabasePool,
  TransactionClient,
} from "../src/types.js";
import type { QueryConfig } from "pg";

type MealRepository = NonNullable<
  Parameters<typeof createMealService>[0]["repository"]
>;
type ProfileReader = NonNullable<
  Parameters<typeof createMealService>[0]["profileService"]
>;
type HarnessCall = string | [string, ...unknown[]];

interface HarnessOverrides {
  repository?: Partial<MealRepository>;
  profileService?: Partial<ProfileReader>;
}

const ID = "70a2071d-5cb8-4f15-b6f6-9ed632462bef";

function mealInput(overrides: Partial<MealInput> = {}): MealInput {
  return {
    food_name: "Example yogurt",
    meal_type: "breakfast",
    consumption_date: "2026-09-12",
    consumed_quantity: 150,
    quantity_unit: "g",
    calories_kcal: 180,
    protein_g: 9,
    carbs_g: 27,
    fat_g: 3,
    micronutrients: {
      sodium_mg: 0,
      calcium_mg: 120,
      iron_mg: null,
      potassium_mg: null,
      vitamin_c_mg: null,
      vitamin_d_mcg: null,
    },
    entry_source: "manual",
    is_estimate: false,
    ...overrides,
  };
}

function createHarness(overrides: HarnessOverrides = {}) {
  const calls: HarnessCall[] = [];
  const client: TransactionClient = {
    async query(statement: string | QueryConfig<unknown[]>) {
      calls.push(typeof statement === "string" ? statement : statement.text);
      return { rows: [] };
    },
    release() {
      calls.push("release");
    },
  };
  const pool: DatabasePool = {
    query: client.query,
    async connect() {
      calls.push("connect");
      return client;
    },
    async end() {},
  };
  const savedMeal: Meal = {
    id: ID,
    ...mealInput(),
    created_at: "2026-09-12T10:00:00.000Z",
    updated_at: "2026-09-12T10:00:00.000Z",
  };
  const repository: MealRepository = {
    createMealFilter(query) {
      calls.push(["filter", query]);
      return { clause: "", values: [] };
    },
    async countMeals(executor) {
      calls.push(["count", executor]);
      return "25";
    },
    async findMealsPage(executor, filter, paging) {
      calls.push(["page", executor, filter, paging]);
      return [savedMeal];
    },
    async insertMeal(executor, meal) {
      calls.push(["insert", executor, meal]);
      return savedMeal;
    },
    async findMealById(executor, id) {
      calls.push(["find", executor, id]);
      return savedMeal;
    },
    async replaceMeal(executor, id, meal) {
      calls.push(["replace", executor, id, meal]);
      return { ...savedMeal, ...meal, id };
    },
    async deleteMealById(executor, id) {
      calls.push(["delete", executor, id]);
      return true;
    },
    ...overrides.repository,
  };
  let profileCalls = 0;
  const profileService: ProfileReader = {
    async getProfile() {
      profileCalls += 1;
      return { today: "2026-09-12" };
    },
    ...overrides.profileService,
  };
  const service = createMealService({
    pool,
    profileService,
    repository,
  });

  return {
    calls,
    client,
    pool,
    profileCalls: () => profileCalls,
    repository,
    savedMeal,
    service,
  };
}

test("create and full update validate one profile-derived today and keep totals independent", async () => {
  const harness = createHarness();
  const created = await harness.service.createMeal(mealInput(), "00000000-0000-4000-8000-000000000099");
  const updated = await harness.service.updateMeal(
    ID,
    mealInput({ consumed_quantity: 300 }), "00000000-0000-4000-8000-000000000099"
  );

  assert.equal(created.calories_kcal, 180);
  assert.equal(updated.consumed_quantity, 300);
  assert.equal(updated.calories_kcal, 180);
  assert.equal(harness.profileCalls(), 2);
  const replaceCall = harness.calls.find(
    (call) => Array.isArray(call) && call[0] === "replace",
  );
  assert(Array.isArray(replaceCall));
  assert.equal((replaceCall[3] as MealInput).calories_kcal, 180);
});

test("future writes fail before mutation while the current date remains valid", async () => {
  let writes = 0;
  const harness = createHarness({
    repository: {
      async insertMeal() {
        writes += 1;
        throw new Error("Unexpected future insert.");
      },
      async replaceMeal() {
        writes += 1;
        throw new Error("Unexpected future replacement.");
      },
    },
  });

  await assert.rejects(
    harness.service.createMeal(mealInput({ consumption_date: "2026-09-13" }), "00000000-0000-4000-8000-000000000099"),
    (error) => {
      assert(error instanceof AppError);
      return (
        error.status === 422 &&
        error.code === "VALIDATION_ERROR" &&
        error.details[0]?.field === "consumption_date"
      );
    },
  );
  await assert.rejects(
    harness.service.updateMeal(
      ID,
      mealInput({ consumption_date: "2026-09-13" }), "00000000-0000-4000-8000-000000000099"
    ),
    (error) => {
      assert(error instanceof AppError);
      return error.status === 422;
    },
  );
  assert.equal(writes, 0);
});

test("list count and page share one repeatable-read client and preserve true totals", async () => {
  const harness = createHarness();
  const result = await harness.service.listMeals({
    page: 2,
    page_size: 10,
  }, "00000000-0000-4000-8000-000000000099");

  assert.deepEqual(result.pagination, {
    page: 2,
    page_size: 10,
    total_items: 25,
    total_pages: 3,
  });
  assert.equal(result.items.length, 1);
  assert.deepEqual(harness.calls.slice(1, 3), ["connect", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"]);
  const countCall = harness.calls.find(
    (call) => Array.isArray(call) && call[0] === "count",
  );
  const pageCall = harness.calls.find(
    (call) => Array.isArray(call) && call[0] === "page",
  );
  assert(Array.isArray(countCall));
  assert(Array.isArray(pageCall));
  assert.equal(countCall[1], harness.client);
  assert.equal(pageCall[1], harness.client);
  assert.deepEqual(pageCall[3], { pageSize: 10, offset: 10 });
  assert.deepEqual(harness.calls.slice(-2), ["COMMIT", "release"]);
});

test("maximum valid page computes a safe non-32-bit offset", async () => {
  const harness = createHarness();
  await harness.service.listMeals({
    page: 2_147_483_647,
    page_size: 100,
  }, "00000000-0000-4000-8000-000000000099");
  const pageCall = harness.calls.find(
    (call) => Array.isArray(call) && call[0] === "page",
  );
  assert(Array.isArray(pageCall));
  const paging = pageCall[3] as { offset: number };
  assert.equal(paging.offset, 214_748_364_600);
  assert.equal(Number.isSafeInteger(paging.offset), true);
});

test("valid missing reads, updates, and repeated deletes return MEAL_NOT_FOUND", async () => {
  const harness = createHarness({
    repository: {
      async findMealById() {
        return null;
      },
      async replaceMeal() {
        return null;
      },
      async deleteMealById() {
        return false;
      },
    },
  });

  await assert.rejects(
    harness.service.getMeal(ID, "00000000-0000-4000-8000-000000000099"),
    (error) => {
      assert(error instanceof AppError);
      return error.status === 404 && error.code === "MEAL_NOT_FOUND";
    },
  );
  await assert.rejects(
    harness.service.updateMeal(ID, mealInput(), "00000000-0000-4000-8000-000000000099"),
    (error) => {
      assert(error instanceof AppError);
      return error.status === 404 && error.code === "MEAL_NOT_FOUND";
    },
  );
  await assert.rejects(
    harness.service.deleteMeal(ID, "00000000-0000-4000-8000-000000000099"),
    (error) => {
      assert(error instanceof AppError);
      return error.status === 404 && error.code === "MEAL_NOT_FOUND";
    },
  );
});

test("only known database availability and timeout errors become 503", async () => {
  for (const [code, expected] of [
    ["57014", "DATABASE_TIMEOUT"],
    ["ECONNRESET", "DATABASE_UNAVAILABLE"],
  ]) {
    const harness = createHarness({
      repository: {
        async findMealById() {
          throw Object.assign(new Error("private detail"), { code });
        },
      },
    });
    await assert.rejects(
      harness.service.getMeal(ID, "00000000-0000-4000-8000-000000000099"),
      (error) => {
        assert(error instanceof AppError);
        return error.status === 503 && error.code === expected;
      },
    );
  }

  const syntax = createHarness({
    repository: {
      async findMealById() {
        throw Object.assign(new Error("private detail"), { code: "42601" });
      },
    },
  });
  await assert.rejects(
    syntax.service.getMeal(ID, "00000000-0000-4000-8000-000000000099"),
    (error) => {
      assert(error && typeof error === "object" && "code" in error);
      return error.code === "42601";
    },
  );
});
