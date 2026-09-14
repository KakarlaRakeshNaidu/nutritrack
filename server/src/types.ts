import type { QueryConfig } from "pg";

export interface Logger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type Clock = () => Date;

export interface QueryResultLike<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface DatabaseExecutor {
  query(
    query: string | QueryConfig<unknown[]>,
    values?: unknown[],
  ): Promise<QueryResultLike>;
}

export interface TransactionClient extends DatabaseExecutor {
  release(error?: Error): void;
}

export interface ConnectionPool {
  connect(): Promise<TransactionClient>;
}

export interface DatabasePool extends DatabaseExecutor, ConnectionPool {
  end(): Promise<void>;
}
