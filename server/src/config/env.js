import { z } from "zod";

const portSchema = z.preprocess((value) => {
  if (value === undefined) {
    return 3000;
  }

  // Environment variables arrive as strings. Requiring decimal digits first
  // prevents blanks, signs, fractions, and exponent notation from being coerced.
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}, z.number().int().min(1).max(65535));

const envSchema = z.object({
  PORT: portSchema,
});

export function loadEnv(source = process.env) {
  const result = envSchema.safeParse({ PORT: source.PORT });

  if (!result.success) {
    // Keep startup errors useful without echoing raw environment values, which
    // could expose sensitive configuration as this module grows in later phases.
    throw new Error("Invalid PORT: use an integer from 1 through 65535.");
  }

  return result.data;
}
