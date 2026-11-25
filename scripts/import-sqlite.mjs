import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import pg from "pg";
if (!process.argv[2])
  throw Error("Specify the path to an existing tracker.sqlite file.");
const source = new DatabaseSync(resolve(process.argv[2]), { readOnly: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  source.exec("BEGIN");
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('delivery_expense_import'))",
  );
  const marker = await client.query(
    "INSERT INTO delivery_expense.config VALUES('sqlite_import_v1','done') ON CONFLICT DO NOTHING RETURNING key",
  );
  if (marker.rowCount) {
    if (
      (await client.query("SELECT 1 FROM delivery_expense.entries LIMIT 1"))
        .rowCount
    )
      throw Error("Import requires an empty destination ledger.");
    let count = 0;
    for (const user of source
      .prepare("SELECT * FROM users ORDER BY id")
      .all()) {
      let id;
      if (user.email === "admin@sfk.com") {
        const admin = await client.query(
          "UPDATE delivery_expense.users SET theme=$1,threshold=$2,recovery=$3 WHERE admin RETURNING id",
          [user.theme, user.threshold, user.recovery],
        );
        id = admin.rows[0].id;
      } else {
        id = (
          await client.query(
            "INSERT INTO delivery_expense.users(email,password,recovery,theme,threshold) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [
              user.email,
              user.password,
              user.recovery,
              user.theme,
              user.threshold,
            ],
          )
        ).rows[0].id;
      }
      const entries = source
        .prepare(
          "SELECT type,date,cents,qty,method,notes FROM entries WHERE owner=? ORDER BY id",
        )
        .all(user.id);
      await client.query(
        "INSERT INTO delivery_expense.entries(owner,type,date,cents,qty,method,notes) SELECT $1,r.* FROM jsonb_to_recordset($2) AS r(type text,date date,cents bigint,qty integer,method text,notes text)",
        [id, JSON.stringify(entries)],
      );
      count += entries.length;
      const alerts = source
        .prepare("SELECT date,cents,seen FROM alerts WHERE owner=? ORDER BY id")
        .all(user.id);
      await client.query(
        "INSERT INTO delivery_expense.alerts(owner,date,cents,seen) SELECT $1,r.* FROM jsonb_to_recordset($2) AS r(date date,cents bigint,seen integer)",
        [id, JSON.stringify(alerts)],
      );
    }
    console.log("Copied ledger entries:", count);
  } else console.log("SQLite snapshot was previously imported.");
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  source.close();
  await client.end();
}
