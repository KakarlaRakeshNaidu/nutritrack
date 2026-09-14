import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";

import pg from "pg";

import type { PoolConfig } from "pg";

import type { AppConfig } from "../config/env.js";
import type { DatabaseExecutor, DatabasePool, Logger } from "../types.js";

interface TypeRegistry {
  setTypeParser(oid: number, parser: (value: string) => string): void;
}

interface ObservableDatabasePool extends DatabasePool {
  on(event: "error", listener: (error: Error) => void): unknown;
}

interface PoolConstructor {
  new (config: PoolConfig): ObservableDatabasePool;
}

type CertificateReader = (
  path: string,
  encoding: "utf8",
) => Promise<string>;

interface PoolDependencies {
  PoolClass?: PoolConstructor;
  typeRegistry?: TypeRegistry;
  readCertificate?: CertificateReader;
  logger?: Logger;
  statementTimeoutMillis?: number;
}

type DatabaseConfig = Pick<AppConfig, "DATABASE_URL" | "PG_CA_CERT_PATH">;

import { safeDatabaseCode } from "./database-errors.js";

const { Pool, types } = pg;
const POSTGRES_DATE_OID = 1082;
const CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export const API_STATEMENT_TIMEOUT_MS = 10_000;
export const MIGRATION_STATEMENT_TIMEOUT_MS = 60_000;

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export function configureDateParser(typeRegistry: TypeRegistry = types): void {
  // A diary DATE has no time or timezone. Returning the original text prevents
  // pg from shifting it through the Node process timezone.
  typeRegistry.setTypeParser(POSTGRES_DATE_OID, (value: string) => value);
}

export function validateCertificateMaterial(contents: unknown): void {
  const certificates =
    typeof contents === "string" ? contents.match(CERTIFICATE_PATTERN) : null;

  if (!certificates || certificates.length === 0) {
    throw new DatabaseConfigurationError(
      "The configured PostgreSQL CA certificate is invalid.",
    );
  }

  try {
    for (const certificate of certificates) {
      new X509Certificate(certificate);
    }
  } catch {
    throw new DatabaseConfigurationError(
      "The configured PostgreSQL CA certificate is invalid.",
    );
  }
}

export async function createDatabasePool(
  config: DatabaseConfig,
  {
    PoolClass = Pool as PoolConstructor,
    typeRegistry = types,
    readCertificate = (path, encoding) => readFile(path, encoding),
    logger = console,
    statementTimeoutMillis = API_STATEMENT_TIMEOUT_MS,
  }: PoolDependencies = {},
): Promise<ObservableDatabasePool> {
  let ca: string;

  try {
    ca = await readCertificate(config.PG_CA_CERT_PATH, "utf8");
  } catch {
    throw new DatabaseConfigurationError(
      "The configured PostgreSQL CA certificate could not be read.",
    );
  }

  validateCertificateMaterial(ca);
  configureDateParser(typeRegistry);

  const pool = new PoolClass({
    connectionString: config.DATABASE_URL,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: statementTimeoutMillis,
  });

  // Idle errors otherwise have no request to receive them. Diagnostics stay
  // bounded to an allowlisted code and never include URLs, SQL, or credentials.
  pool.on("error", (error: Error) => {
    logger.error(`database_pool_error code=${safeDatabaseCode(error)}`);
  });

  return pool;
}

export async function verifyDatabaseConnection(pool: DatabaseExecutor): Promise<void> {
  await pool.query("SELECT 1");
}
