import { mapDatabaseError } from "../../db/database-errors.js";
import { AppError } from "../../utils/errors.js";
import type { Clock, DatabaseExecutor } from "../../types.js";
import {
  getTodayInTimeZone,
  getWeekBounds,
} from "../../utils/calendar.js";
import { findSingletonProfile } from "./profile.repository.js";

export interface Profile {
  display_name: string;
  timezone: string;
  today: string;
  week_start: string;
  week_end: string;
}

export interface ProfileService {
  getProfile(): Promise<Profile>;
}

interface ProfileServiceDependencies {
  pool: DatabaseExecutor;
  clock?: Clock;
  findProfile?: (
    pool: DatabaseExecutor,
  ) => Promise<Record<string, unknown> | null>;
}

function invalidPersistedProfile(): AppError {
  return new AppError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
}

export function createProfileService(
  {
    pool,
    clock = () => new Date(),
    findProfile = findSingletonProfile,
  }: ProfileServiceDependencies,
): ProfileService {
  return {
    async getProfile() {
      let profile: Record<string, unknown> | null;

      try {
        profile = await findProfile(pool);
      } catch (error) {
        throw mapDatabaseError(error);
      }

      if (
        !profile ||
        typeof profile.display_name !== "string" ||
        profile.display_name.trim().length === 0 ||
        typeof profile.timezone !== "string" ||
        profile.timezone.trim().length === 0
      ) {
        throw invalidPersistedProfile();
      }

      try {
        // Capture one instant and use the persisted timezone for the complete
        // response, avoiding inconsistent dates across a midnight boundary.
        const now = clock();
        const today = getTodayInTimeZone(now, profile.timezone);
        const { weekStart, weekEnd } = getWeekBounds(today);

        return {
          display_name: profile.display_name,
          timezone: profile.timezone,
          today,
          week_start: weekStart,
          week_end: weekEnd,
        };
      } catch {
        throw invalidPersistedProfile();
      }
    },
  };
}
