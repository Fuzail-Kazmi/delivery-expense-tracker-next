import pg from "pg";
import { randomBytes, createHash } from "node:crypto";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const key = randomBytes(20).toString("hex");
  const result = await client.query(
    "UPDATE delivery_expense.users SET recovery=$1 WHERE email=$2",
    [createHash("sha256").update(key).digest("hex"), "admin@sfk.com"],
  );
  if (!result.rowCount) throw Error("Initialize the admin account first.");
  console.log("Store this new single-use recovery key privately.\n" + key);
} finally {
  await client.end();
}
