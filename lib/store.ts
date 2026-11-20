import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "./database";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export async function due(owner: number, client: PoolClient) {
  const { rows } = await query(
    "SELECT COALESCE(SUM(CASE type WHEN 'delivery' THEN cents*qty WHEN 'payment' THEN -cents ELSE 0 END),0) AS amount FROM tracker.entries WHERE owner=$1",
    [owner],
    client,
  );
  return Number(rows[0].amount);
}
export async function lockLedger(owner: number, client: PoolClient) {
  const { rows } = await query(
    "SELECT threshold FROM tracker.users WHERE id=$1 FOR UPDATE",
    [owner],
    client,
  );
  return Number(rows[0].threshold);
}
export async function recordCrossing(
  owner: number,
  before: number,
  limit: number,
  client: PoolClient,
) {
  if (!limit || before >= limit) return;
  const after = await due(owner, client);
  if (after < limit) return;
  const date = today();
  const { rows } = await query(
    "INSERT INTO tracker.alerts(owner,date,cents) VALUES($1,$2,$3) RETURNING id",
    [owner, date, after],
    client,
  );
  return { id: rows[0].id, date, amount: after / 100 };
}
export async function notices(owner: number, client?: PoolClient) {
  return (
    await query(
      "SELECT id,date::text,cents::float8/100 AS amount,seen FROM tracker.alerts WHERE owner=$1 ORDER BY id DESC LIMIT 30",
      [owner],
      client,
    )
  ).rows;
}
