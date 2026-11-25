import pg from "pg";
import { randomBytes, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { generateVAPIDKeys } from "web-push";
const schema = process.env.TRACKER_SCHEMA || "delivery_expense";
if (!/^delivery_expense(?:_test_[a-f0-9]{32})?$/.test(schema))
  throw Error("Invalid schema");
if (!process.env.ADMIN_PASSWORD || !process.env.DATABASE_URL)
  throw Error("Configure DATABASE_URL and ADMIN_PASSWORD before migration.");
const sql = (
  await readFile(new URL("../db/schema.sql", import.meta.url), "utf8")
).replace(/\btracker\b/g, schema);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [schema]);
  await client.query(sql);
  for (const [key, value] of [
    ["jwt", randomBytes(48).toString("hex")],
    ["vapid", JSON.stringify(generateVAPIDKeys())],
  ]) {
    await client.query(
      `INSERT INTO ${schema}.config VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [key, value],
    );
  }
  const salt = randomBytes(16).toString("hex");
  await client.query(
    `INSERT INTO ${schema}.users(email,password,admin) SELECT $1,$2,true WHERE NOT EXISTS(SELECT 1 FROM ${schema}.users WHERE admin) ON CONFLICT(email) DO UPDATE SET admin=true`,
    [
      "admin@sfk.com",
      salt +
        "." +
        scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString("hex"),
    ],
  );
  await client.query(
    `UPDATE ${schema}.users SET username=CASE WHEN admin THEN 'admin' ELSE 'user_'||id::text END WHERE username IS NULL AND NOT EXISTS(SELECT 1 FROM ${schema}.config WHERE key='legacy_usernames_v1')`,
  );
  await client.query(
    `INSERT INTO ${schema}.config VALUES('legacy_usernames_v1','done') ON CONFLICT DO NOTHING`,
  );
  await client.query("COMMIT");
  console.log("Ledger schema ready:", schema);
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
