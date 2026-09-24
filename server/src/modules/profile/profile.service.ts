import { mapDatabaseError } from "../../db/database-errors.js";
import { AppError } from "../../utils/errors.js";
import type { Clock, DatabaseExecutor } from "../../types.js";
import { getTodayInTimeZone, getWeekBounds } from "../../utils/calendar.js";
import {
  findSingletonProfile,
  updateProfileDisplayName,
} from "./profile.repository.js";
import type { ProfileUpdateInput } from "./profile.schemas.js";

export interface Profile {
  display_name: string;
  timezone: string;
  today: string;
  week_start: string;
  week_end: string;
}

export interface ProfileService {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(input: ProfileUpdateInput, userId: string): Promise<Profile>;
}

interface ProfileServiceDependencies {
  pool: DatabaseExecutor;
  clock?: Clock;
}

function invalidPersistedProfile(): AppError {
  return new AppError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
}

function mapProfile(profile: Record<string, unknown> | null, now: Date): Profile {
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
}

export function createProfileService({
  pool,
  clock = () => new Date(),
}: ProfileServiceDependencies): ProfileService {
  return {
    async getProfile(userId) {
      try {
        return mapProfile(await findSingletonProfile(pool, userId), clock());
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw mapDatabaseError(error);
      }
    },

    async updateProfile(input, userId) {
      try {
        return mapProfile(
          await updateProfileDisplayName(pool, userId, input.display_name),
          clock(),
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw mapDatabaseError(error);
      }
    },
  };
}
