import { mapDatabaseError } from "../../db/database-errors.js";
import { withTransaction } from "../../db/transaction.js";
import { AppError } from "../../utils/errors.js";
import { isConsumptionDateAllowed } from "../../utils/calendar.js";
import { createProfileService } from "../profile/profile.service.js";
import type { Clock, DatabaseExecutor, DatabasePool } from "../../types.js";
import {
  countMeals,
  createMealFilter,
  deleteMealById,
  findMealById,
  findMealsPage,
  insertMeal,
  replaceMeal,
} from "./meal.repository.js";
import type { Meal, MealFilter } from "./meal.repository.js";
import type { MealInput, MealListQuery } from "./meal.schemas.js";

interface ProfileReader {
  getProfile(userId: string): Promise<{ today: string }>;
}

interface MealRepository {
  countMeals(executor: DatabaseExecutor, filter: MealFilter): Promise<unknown>;
  createMealFilter(query: MealListQuery, userId: string): MealFilter;
  deleteMealById(executor: DatabaseExecutor, id: string, userId: string): Promise<boolean>;
  findMealById(executor: DatabaseExecutor, id: string, userId: string): Promise<Meal | null>;
  findMealsPage(
    executor: DatabaseExecutor,
    filter: MealFilter,
    options: { pageSize: number; offset: number },
  ): Promise<Meal[]>;
  insertMeal(executor: DatabaseExecutor, meal: MealInput, userId: string): Promise<Meal>;
  replaceMeal(
    executor: DatabaseExecutor,
    id: string,
    meal: MealInput,
    userId: string,
  ): Promise<Meal | null>;
}

export interface MealListResult {
  items: Meal[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
}

export interface MealService {
  createMeal(meal: MealInput, userId: string): Promise<Meal>;
  getMeal(id: string, userId: string): Promise<Meal>;
  listMeals(query: MealListQuery, userId: string): Promise<MealListResult>;
  updateMeal(id: string, meal: MealInput, userId: string): Promise<Meal>;
  deleteMeal(id: string, userId: string): Promise<void>;
}

interface MealServiceDependencies {
  pool: DatabasePool;
  clock?: Clock;
  profileService?: ProfileReader;
  repository?: MealRepository;
}


function mealNotFound(): AppError {
  return new AppError({
    status: 404,
    code: "MEAL_NOT_FOUND",
    message: "The requested meal does not exist.",
  });
}

function futureConsumptionDate(): AppError {
  return new AppError({
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Please correct the highlighted fields.",
    details: [
      {
        field: "consumption_date",
        message: "Consumption date cannot be after today.",
      },
    ],
  });
}

async function databaseOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export function createMealService(
  {
    pool,
    clock = () => new Date(),
    profileService = createProfileService({ pool, clock }),
    repository = {
      countMeals,
      createMealFilter,
      deleteMealById,
      findMealById,
      findMealsPage,
      insertMeal,
      replaceMeal,
    },
  }: MealServiceDependencies,
): MealService {
  async function validateWriteDate(meal: MealInput, userId: string): Promise<void> {
    // The profile service captures one clock instant and applies the persisted
    // IANA timezone. Both POST and PUT compare against that one derived today.
    const { today } = await profileService.getProfile(userId);
    if (!isConsumptionDateAllowed(meal.consumption_date, today)) {
      throw futureConsumptionDate();
    }
  }

  return {
    async createMeal(meal: MealInput, userId: string) {
      await validateWriteDate(meal, userId);
      return databaseOperation(() => repository.insertMeal(pool, meal, userId));
    },

    async getMeal(id: string, userId: string) {
      const meal = await databaseOperation(() =>
        repository.findMealById(pool, id, userId),
      );
      if (!meal) {
        throw mealNotFound();
      }
      return meal;
    },

    async listMeals(query: MealListQuery, userId: string) {
      const filter = repository.createMealFilter(query, userId);
      const offset = (query.page - 1) * query.page_size;

      return databaseOperation(() =>
        withTransaction(
          pool,
          async (client) => {
            // Separate count and page queries share this repeatable-read
            // snapshot, so pagination metadata and rows describe one state.
            const countText = await repository.countMeals(client, filter);
            const totalItems = Number(countText);
            if (!Number.isSafeInteger(totalItems) || totalItems < 0) {
              throw new TypeError("Meal count exceeds the supported JSON range.");
            }

            const items = await repository.findMealsPage(client, filter, {
              pageSize: query.page_size,
              offset,
            });

            return {
              items,
              pagination: {
                page: query.page,
                page_size: query.page_size,
                total_items: totalItems,
                total_pages:
                  totalItems === 0
                    ? 0
                    : Math.ceil(totalItems / query.page_size),
              },
            };
          },
          { mode: "readOnlySnapshot" },
        ),
      );
    },

    async updateMeal(id: string, meal: MealInput, userId: string) {
      await validateWriteDate(meal, userId);
      const updated = await databaseOperation(() =>
        repository.replaceMeal(pool, id, meal, userId),
      );
      if (!updated) {
        throw mealNotFound();
      }
      return updated;
    },

    async deleteMeal(id: string, userId: string) {
      const deleted = await databaseOperation(() =>
        repository.deleteMealById(pool, id, userId),
      );
      if (!deleted) {
        throw mealNotFound();
      }
    },
  };
}
