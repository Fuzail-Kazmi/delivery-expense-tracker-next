import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  const marked = await client.query(
    "INSERT INTO delivery_expense.config VALUES('legacy_public_import_v1','done') ON CONFLICT DO NOTHING RETURNING key",
  );
  if (marked.rowCount) {
    const results =
      await client.query(`INSERT INTO delivery_expense.entries(owner,type,date,cents,qty,method,notes)
 SELECT u.id,r.type,r.date,r.cents,r.qty,r.method,r.notes FROM (
 SELECT 'delivery' AS type,id,delivery_date AS date,round(bottle_unit_price*100)::bigint AS cents,bottle_quantity AS qty,'' AS method,notes,created_at FROM public.deliveries
 UNION ALL SELECT 'payment',id,payment_date,round(amount_paid*100)::bigint,1,payment_method,notes,created_at FROM public.payments
 UNION ALL SELECT 'price',id,effective_date,round(bottle_price*100)::bigint,1,'',notes,created_at FROM public.bottle_prices
 ) r JOIN delivery_expense.users u ON u.admin ORDER BY r.date,r.created_at,r.type,r.id`);
    console.log("Imported original Neon records:", results.rowCount);
  } else console.log("Legacy records were previously imported.");
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
