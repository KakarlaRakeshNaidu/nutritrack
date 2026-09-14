import { mapDatabaseError } from "../../db/database-errors.js";
import { AppError } from "../../utils/errors.js";
import type { DatabaseExecutor } from "../../types.js";
import type { Goal } from "./goal.repository.js";
import type { GoalInput } from "./goal.schemas.js";
import {
  findSingletonGoals,
  replaceSingletonGoals,
} from "./goal.repository.js";

interface GoalRepository {
  findSingletonGoals(executor: DatabaseExecutor): Promise<Goal | null>;
  replaceSingletonGoals(
    executor: DatabaseExecutor,
    goals: GoalInput,
  ): Promise<Goal | null>;
}

export interface GoalService {
  getGoals(): Promise<Goal>;
  replaceGoals(goals: GoalInput): Promise<Goal>;
}

interface GoalServiceDependencies {
  pool: DatabaseExecutor;
  repository?: GoalRepository;
}

function missingGoalSingleton(): AppError {
  return new AppError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
}

async function databaseOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export function createGoalService(
  {
    pool,
    repository = {
      findSingletonGoals,
      replaceSingletonGoals,
    },
  }: GoalServiceDependencies,
): GoalService {
  return {
    async getGoals() {
      const goals = await databaseOperation(() =>
        repository.findSingletonGoals(pool),
      );
      if (!goals) {
        throw missingGoalSingleton();
      }
      return goals;
    },

    async replaceGoals(goals: GoalInput) {
      const replaced = await databaseOperation(() =>
        repository.replaceSingletonGoals(pool, goals),
      );
      if (!replaced) {
        throw missingGoalSingleton();
      }
      return replaced;
    },
  };
}
