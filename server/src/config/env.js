import { z } from "zod";

const NODE_ENV_VALUES = ["development", "test", "production"];
const CONFLICTING_SSL_OPTIONS = new Set([
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
]);

function integerEnvironmentValue({ defaultValue, minimum, maximum }) {
  return z.preprocess((value) => {
    if (value === undefined) {
      return defaultValue;
    }

    // Environment variables arrive as strings. Checking decimal syntax before
    // conversion prevents blanks, signs, fractions, and exponents from being
    // silently accepted by JavaScript number coercion.
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }

    return value;
  }, z.number().int().min(minimum).max(maximum));
}

const clientOriginSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    try {
      const url = new URL(value);
      const isHttp = url.protocol === "http:" || url.protocol === "https:";
      const hasOnlyRootPath = url.pathname === "/";
      const hasCredentials = url.username !== "" || url.password !== "";

      if (
        !isHttp ||
        !url.hostname ||
        !hasOnlyRootPath ||
        hasCredentials ||
        url.search ||
        url.hash ||
        value.includes(",") ||
        value.includes("*")
      ) {
        throw new Error("invalid origin");
      }

      // URL.origin consistently removes an optional trailing root slash.
      return url.origin;
    } catch {
      context.addIssue({
        code: "custom",
        message: "Must be one HTTP(S) origin without credentials or a path.",
      });
      return z.NEVER;
    }
  });

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    try {
      const url = new URL(value);
      const isPostgres =
        url.protocol === "postgres:" || url.protocol === "postgresql:";
      const databaseName = url.pathname.slice(1);
      const containsConflictingSslOption = [...url.searchParams.keys()].some(
        (key) => CONFLICTING_SSL_OPTIONS.has(key.toLowerCase()),
      );

      if (
        !isPostgres ||
        !url.hostname ||
        !databaseName ||
        databaseName.includes("/") ||
        containsConflictingSslOption
      ) {
        throw new Error("invalid database URL");
      }

      return value;
    } catch {
      context.addIssue({
        code: "custom",
        message: "Must be a PostgreSQL URI with a host and database name.",
      });
      return z.NEVER;
    }
  });

const coreEnvironmentSchema = z.strictObject({
  PORT: integerEnvironmentValue({
    defaultValue: 3000,
    minimum: 1,
    maximum: 65535,
  }),
  NODE_ENV: z.enum(NODE_ENV_VALUES).default("development"),
  CLIENT_ORIGIN: clientOriginSchema,
  TRUST_PROXY_HOPS: integerEnvironmentValue({
    defaultValue: 0,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  DATABASE_URL: databaseUrlSchema,
  PG_CA_CERT_PATH: z.string().trim().min(1),
});

export class EnvironmentValidationError extends Error {
  constructor(fields) {
    super(`Invalid configuration: ${fields.join(", ")}.`);
    this.name = "EnvironmentValidationError";
    this.fields = fields;
  }
}

function evaluateProviderPair(source, keyName, modelName) {
  const key = source[keyName];
  const model = source[modelName];

  if (key === undefined && model === undefined) {
    return { status: "disabled" };
  }

  const keyIsValid = typeof key === "string" && key.trim().length > 0;
  const modelIsValid = typeof model === "string" && model.trim().length > 0;

  if (!keyIsValid || !modelIsValid) {
    return {
      status: "configuration_error",
      fields: [keyName, modelName].filter((fieldName) => {
        const fieldValue = source[fieldName];
        return typeof fieldValue !== "string" || fieldValue.trim().length === 0;
      }),
    };
  }

  return {
    status: "configured",
    apiKey: key,
    model: model.trim(),
  };
}

export function loadEnv(source = process.env) {
  // Selecting only intended keys allows process.env to contain ordinary OS and
  // shell variables while retaining strict validation of application config.
  const result = coreEnvironmentSchema.safeParse({
    PORT: source.PORT,
    NODE_ENV: source.NODE_ENV,
    CLIENT_ORIGIN: source.CLIENT_ORIGIN,
    TRUST_PROXY_HOPS: source.TRUST_PROXY_HOPS,
    DATABASE_URL: source.DATABASE_URL,
    PG_CA_CERT_PATH: source.PG_CA_CERT_PATH,
  });

  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ].sort();
    throw new EnvironmentValidationError(fields);
  }

  return {
    ...result.data,
    providers: {
      gemini: evaluateProviderPair(source, "GEMINI_API_KEY", "GEMINI_MODEL"),
      grok: evaluateProviderPair(source, "XAI_API_KEY", "GROK_MODEL"),
    },
  };
}
