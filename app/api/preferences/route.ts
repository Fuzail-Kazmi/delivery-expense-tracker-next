import { z } from "zod";
import { account, sessionId } from "@/lib/auth";
import { lockLedger, notices, recordCrossing } from "@/lib/store";
import { query, transaction } from "@/lib/database";
import { pushKeys, sendAlert } from "@/lib/push";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("theme"), theme: z.enum(["light", "dark"]) }),
  z.object({
    action: z.literal("threshold"),
    amount: z.number().min(0).max(999999999).multipleOf(0.01),
  }),
  z.object({ action: z.literal("read") }),
  z.object({
    action: z.literal("subscribe"),
    subscription: z.object({
      endpoint: z.string().url().max(4096),
      keys: z.object({
        auth: z.string().max(100),
        p256dh: z.string().max(250),
      }),
    }),
  }),
]);
export async function GET() {
  const user = await account();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  return Response.json({
    alerts: await notices(user.id),
    publicKey: (await pushKeys()).publicKey,
  });
}
export async function POST(req: Request) {
  const user = await account();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid setting." }, { status: 400 });
  const input = parsed.data;
  if (input.action === "theme")
    await query("UPDATE tracker.users SET theme=$1 WHERE id=$2", [
      input.theme,
      user.id,
    ]);
  if (input.action === "read")
    await query("UPDATE tracker.alerts SET seen=1 WHERE owner=$1", [user.id]);
  if (input.action === "threshold") {
    const alerts = await transaction(async (client) => {
      const limit = Math.round(input.amount * 100),
        old = await lockLedger(user.id, client);
      await query(
        "UPDATE tracker.users SET threshold=$1 WHERE id=$2",
        [limit, user.id],
        client,
      );
      if (old !== limit) return recordCrossing(user.id, 0, limit, client);
    });
    if (alerts) await sendAlert(user.id, alerts);
  }
  if (input.action === "subscribe") {
    const u = new URL(input.subscription.endpoint);
    if (
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password ||
      !/^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/.test(
        u.hostname,
      )
    )
      return Response.json(
        { error: "This push service is unsupported." },
        { status: 400 },
      );
    await query(
      "INSERT INTO tracker.subscriptions VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET owner=excluded.owner,session=excluded.session,subscription=excluded.subscription",
      [u.href, user.id, await sessionId(), JSON.stringify(input.subscription)],
    );
  }
  return Response.json({ alerts: await notices(user.id) });
}
