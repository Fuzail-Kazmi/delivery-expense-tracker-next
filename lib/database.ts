import { Pool, type PoolClient, type QueryResultRow } from "pg";

const schema = process.env.TRACKER_SCHEMA || "delivery_expense";
if (!/^delivery_expense(?:_test_[a-f0-9]{32})?$/.test(schema))
  throw Error("Invalid ledger schema");
let pool: Pool | undefined;
function database() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required.");
  return (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 10000,
  }));
}
// Qualify tables explicitly. Transaction pooling cannot retain a session search_path.
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  client?: PoolClient,
) {
  return (client || database()).query<T>(
    sql.replaceAll("tracker.", schema + "."),
    values,
  );
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
