import { z } from "zod";
import { account } from "@/lib/auth";
import { digest, lockLedger, due, notices, recordCrossing } from "@/lib/store";
import { query, transaction } from "@/lib/database";
import { sendAlert } from "@/lib/push";

import { recordSchema } from "@/lib/entry-input";
const deletion = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(["delivery", "payment", "price"]),
        id: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(10000),
});
const fail = (error: string, status: number) =>
  Response.json({ error }, { status });
export async function GET(req: Request) {
  const user = await account();
  if (!user) return fail("Please sign in.", 401);
  const requestedOwner = req.headers.get("X-Ledger-Owner");
  if (requestedOwner && requestedOwner !== String(user.id))
    return fail("Sign in to the account that saved these records.", 403);
  const [result, alerts] = await Promise.all([
    query(
      "SELECT id,date::text,notes,type,qty,method,cents::float8/100 AS unit FROM tracker.entries WHERE owner=$1 ORDER BY date,id",
      [user.id],
    ),
    notices(user.id),
  ]);
  const entries = result.rows;
  return Response.json({
    user,
    deliveries: entries
      .filter((r) => r.type === "delivery")
      .map(({ id, date, notes, qty, unit }) => ({
        id,
        date,
        notes,
        qty,
        price: unit,
      })),
    payments: entries
      .filter((r) => r.type === "payment")
      .map(({ id, date, notes, method, unit }) => ({
        id,
        date,
        notes,
        method,
        amount: unit,
      })),
    prices: entries
      .filter((r) => r.type === "price")
      .map(({ id, date, notes, unit }) => ({ id, date, notes, price: unit })),
    alerts,
  });
}
async function mutate(req: Request) {
  const user = await account();
  if (!user) return fail("Please sign in.", 401);
  const requestedOwner = req.headers.get("X-Ledger-Owner");
  if (requestedOwner && requestedOwner !== String(user.id))
    return fail("Sign in to the account that saved these records.", 403);
  const key = req.headers.get("Idempotency-Key");
  if (
    key &&
    (req.method !== "POST" ||
      !requestedOwner ||
      !z.uuid().safeParse(key).success)
  )
    return fail("Invalid sync request.", 400);
  const body = await req.json().catch(() => null);
  const input =
    req.method === "DELETE"
      ? deletion.safeParse(body)
      : recordSchema.safeParse(body);
  if (!input.success) return fail(input.error.issues[0].message, 400);
  const data = input.data;
  const result = await transaction(async (client) => {
    const limit = await lockLedger(user.id, client);
    if (key) {
      const previous = await query(
        "SELECT entry_id,fingerprint FROM tracker.entry_receipts WHERE owner=$1 AND key=$2",
        [user.id, key],
        client,
      );
      if (previous.rowCount) {
        if (previous.rows[0].fingerprint !== digest(JSON.stringify(data)))
          return { conflict: true } as const;
        return {
          record: { ...data, id: previous.rows[0].entry_id },
          alerts: await notices(user.id, client),
          alert: undefined,
        };
      }
    }
    const before = limit ? await due(user.id, client) : 0;
    let record;
    if ("items" in data) {
      await query(
        "DELETE FROM tracker.entries AS e USING jsonb_to_recordset($1::jsonb) AS selected(id int,type text) WHERE e.owner=$2 AND e.id=selected.id AND e.type=selected.type",
        [JSON.stringify(data.items), user.id],
        client,
      );
    } else {
      const values = [
        data.date,
        Math.round((data.type === "payment" ? data.amount : data.price) * 100),
        data.type === "delivery" ? data.qty : 1,
        data.type === "payment" ? data.method : "",
        data.notes,
        user.id,
        data.type,
      ];
      const saved =
        req.method === "PUT"
          ? await query(
              "UPDATE tracker.entries SET date=$1,cents=$2,qty=$3,method=$4,notes=$5 WHERE owner=$6 AND type=$7 AND id=$8 RETURNING id",
              [...values, data.id ?? null],
              client,
            )
          : await query(
              "INSERT INTO tracker.entries(date,cents,qty,method,notes,owner,type) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
              values,
              client,
            );
      if (!saved.rowCount) return null;
      record = { ...data, id: saved.rows[0].id };
    }
    if (key && record)
      await query(
        "INSERT INTO tracker.entry_receipts(owner,key,entry_id,fingerprint) VALUES($1,$2,$3,$4)",
        [user.id, key, record.id, digest(JSON.stringify(data))],
        client,
      );
    const alert = await recordCrossing(user.id, before, limit, client);
    return { record, alert, alerts: await notices(user.id, client) };
  });
  if (!result) return fail("Record not found.", 404);
  if ("conflict" in result)
    return fail("This sync key belongs to a different entry.", 409);
  if (result.alert) await sendAlert(user.id, result.alert);
  return Response.json(result, { status: req.method === "POST" ? 201 : 200 });
}
export { mutate as POST, mutate as PUT, mutate as DELETE };
