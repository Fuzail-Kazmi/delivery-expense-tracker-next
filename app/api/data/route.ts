import { z } from "zod";
import { account } from "@/lib/auth";
import { lockLedger, due, notices, recordCrossing, today } from "@/lib/store";
import { query, transaction } from "@/lib/database";
import { sendAlert } from "@/lib/push";

const amount = z.number().positive().max(9999999).multipleOf(0.01);
const common = {
  id: z.number().int().positive().optional(),
  notes: z.string().max(500).default(""),
  date: z.iso.date(),
};
const pastDate = z.iso
  .date()
  .refine((date) => date <= today(), "Use today or an earlier date.");
const recordSchema = z.discriminatedUnion("type", [
  z.object({
    ...common,
    date: pastDate,
    type: z.literal("delivery"),
    price: amount,
    qty: z.number().int().min(1).max(10000),
  }),
  z.object({
    ...common,
    date: pastDate,
    type: z.literal("payment"),
    amount,
    method: z.enum(["Cash", "Easypaisa", "JazzCash", "Bank Transfer"]),
  }),
  z.object({ ...common, type: z.literal("price"), price: amount }),
]);
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
export async function GET() {
  const user = await account();
  if (!user) return fail("Please sign in.", 401);
  const entries = (
    await query(
      "SELECT id,date::text,notes,type,qty,method,cents::float8/100 AS unit FROM tracker.entries WHERE owner=$1 ORDER BY date,id",
      [user.id],
    )
  ).rows;
  return Response.json({
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
    alerts: await notices(user.id),
  });
}
async function mutate(req: Request) {
  const user = await account();
  if (!user) return fail("Please sign in.", 401);
  const body = await req.json().catch(() => null);
  const input =
    req.method === "DELETE"
      ? deletion.safeParse(body)
      : recordSchema.safeParse(body);
  if (!input.success) return fail(input.error.issues[0].message, 400);
  const data = input.data;
  const result = await transaction(async (client) => {
    const limit = await lockLedger(user.id, client);
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
    const alert = await recordCrossing(user.id, before, limit, client);
    return { record, alert, alerts: await notices(user.id, client) };
  });
  if (!result) return fail("Record not found.", 404);
  if (result.alert) await sendAlert(user.id, result.alert);
  return Response.json(result, { status: req.method === "POST" ? 201 : 200 });
}
export { mutate as POST, mutate as PUT, mutate as DELETE };
