import type {
  ConnectionPool,
  TransactionClient,
} from "../types.js";

type TransactionMode = "write" | "readOnlySnapshot";
interface TransactionOptions {
  mode?: TransactionMode;
  markClientUnusable?: () => void;
}

const TRANSACTION_MODES = {
  write: "BEGIN",
  readOnlySnapshot: "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
} satisfies Record<TransactionMode, string>;

export async function runTransaction<Result>(
  client: TransactionClient,
  operation: (client: TransactionClient) => Promise<Result>,
  { mode = "write", markClientUnusable = () => {} }: TransactionOptions = {},
): Promise<Result> {
  const beginStatement = TRANSACTION_MODES[mode];

  if (!beginStatement) {
    throw new TypeError("Unsupported transaction mode.");
  }

  try {
    await client.query(beginStatement);
  } catch (error) {
    markClientUnusable();
    throw error;
  }

  try {
    // BEGIN, work, and COMMIT must share this exact checked-out client. Pool
    // queries could use different sessions and would not form one transaction.
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original operation/commit failure is the useful cause. Marking the
      // client unusable preserves it while ensuring the broken session is culled.
      markClientUnusable();
    }
    throw error;
  }
}

export async function withTransaction<Result>(
  pool: ConnectionPool,
  operation: (client: TransactionClient) => Promise<Result>,
  options: TransactionOptions = {},
): Promise<Result> {
  let client: TransactionClient | undefined;
  let unusable = false;

  try {
    client = await pool.connect();
    return await runTransaction(client, operation, {
      ...options,
      markClientUnusable() {
        unusable = true;
      },
    });
  } finally {
    // finally is mandatory: every successful checkout must be returned on every
    // success/failure path. Passing an error discards a session that could not
    // begin or roll back instead of putting it back into circulation.
    if (client) {
      client.release(
        unusable ? new Error("Discarding unusable transaction client.") : undefined,
      );
    }
  }
}
