import { AppError } from "../utils/errors.js";

const DATABASE_UNAVAILABLE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

export function safeDatabaseCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return DATABASE_UNAVAILABLE_CODES.has(error.code) || error.code === "57014"
      ? error.code
      : "UNEXPECTED";
  }

  return "UNEXPECTED";
}

export function mapDatabaseError(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "57014"
  ) {
    return new AppError({
      status: 503,
      code: "DATABASE_TIMEOUT",
      message: "The database operation timed out. Please try again.",
    });
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" && DATABASE_UNAVAILABLE_CODES.has(error.code)
  ) {
    return new AppError({
      status: 503,
      code: "DATABASE_UNAVAILABLE",
      message: "The database is temporarily unavailable. Please try again.",
    });
  }

  return error;
}
