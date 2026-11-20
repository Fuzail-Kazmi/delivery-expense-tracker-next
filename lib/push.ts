import * as webpush from "web-push";
import { query } from "./database";
export async function pushKeys() {
  return JSON.parse(
    (await query("SELECT value FROM tracker.config WHERE key='vapid'")).rows[0]
      .value,
  ) as { publicKey: string; privateKey: string };
}
export async function sendAlert(owner: number, alert: Record<string, unknown>) {
  const keys = await pushKeys();
  const subscriptions = (
    await query(
      "SELECT endpoint,subscription FROM tracker.subscriptions x JOIN tracker.sessions s ON s.id=x.session WHERE x.owner=$1 AND s.expires>$2",
      [owner, Math.floor(Date.now() / 1000)],
    )
  ).rows;
  await Promise.allSettled(
    subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(
          JSON.parse(String(row.subscription)),
          JSON.stringify(alert),
          {
            TTL: 86400,
            timeout: 5000,
            vapidDetails: { subject: "mailto:admin@sfk.com", ...keys },
          },
        );
      } catch (error) {
        if ([404, 410].includes((error as { statusCode: number }).statusCode))
          await query("DELETE FROM tracker.subscriptions WHERE endpoint=$1", [
            row.endpoint,
          ]);
      }
    }),
  );
}
