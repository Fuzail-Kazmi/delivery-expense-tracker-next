import { openDB, type DBSchema } from "idb";
import type { Account } from "./auth";
import type { Delivery, Payment, BottlePrice } from "./ledger";
import type { AlertRow } from "../components/preferences";

export type NewEntry = (
  | { type: "delivery"; qty: number; price: number }
  | { type: "payment"; amount: number; method: string }
  | { type: "price"; price: number }
) & { date: string; notes: string };
export type Snapshot = {
  user: Account;
  deliveries: Delivery[];
  payments: Payment[];
  prices: BottlePrice[];
  alerts: AlertRow[];
};
type Item = { type: NewEntry["type"]; id: number };
type Deletion = {
  type: "delete";
  items: (Item & { source?: { key: string; entry: NewEntry } })[];
};
type Draft = {
  owner: number;
  key: string;
  entry: NewEntry | Deletion;
  id?: number;
};
interface DeviceDB extends DBSchema {
  state: { key: string; value: number };
  ledgers: { key: number; value: Snapshot };
  queue: { key: number; value: Draft; indexes: { owner: number } };
}
export const localIdStart = 2 ** 40;
const device = () =>
  openDB<DeviceDB>("watertracker-device", 1, {
    upgrade(db) {
      db.createObjectStore("state");
      db.createObjectStore("ledgers");
      db.createObjectStore("queue", {
        keyPath: "id",
        autoIncrement: true,
      }).createIndex("owner", "owner");
    },
  });
let cached: ReturnType<typeof device> | undefined;
const db = () => (cached ??= device());
export class AccountChanged extends Error {}
export const activeOwner = async () => (await db()).get("state", "active");
export async function savedLedger(owner: number) {
  const tx = (await db()).transaction(["state", "ledgers", "queue"]);
  const [active, snapshot, pending] = await Promise.all([
    tx.objectStore("state").get("active"),
    tx.objectStore("ledgers").get(owner),
    tx.objectStore("queue").index("owner").getAll(owner),
  ]);
  if (active !== owner || !snapshot) return null;
  for (const item of pending) {
    const e = item.entry,
      id = localIdStart + item.id!;
    if (e.type === "delete") {
      const ids = new Set(e.items.map((x) => x.id));
      for (const field of ["deliveries", "payments", "prices"] as const) {
        const list = snapshot[field];
        for (let i = list.length - 1; i >= 0; i--)
          if (ids.has(list[i].id)) list.splice(i, 1);
      }
    }
    if (e.type === "delivery") snapshot.deliveries.push({ ...e, id });
    if (e.type === "payment") snapshot.payments.push({ ...e, id });
    if (e.type === "price") snapshot.prices.push({ ...e, id });
  }
  return { snapshot, pending: pending.length };
}
export async function enqueue(owner: number, entry: NewEntry) {
  const tx = (await db()).transaction(["state", "queue"], "readwrite");
  if ((await tx.objectStore("state").get("active")) !== owner)
    throw new AccountChanged("Reconnect and sign in to save this entry.");
  await tx.objectStore("queue").add({ owner, entry, key: crypto.randomUUID() });
  await tx.done;
}
export async function queueDelete(owner: number, items: Item[]) {
  const tx = (await db()).transaction(["state", "queue"], "readwrite");
  if ((await tx.objectStore("state").get("active")) !== owner)
    throw new AccountChanged();
  const queue = tx.objectStore("queue");
  const resolved = await Promise.all(
    items.map(async (item) => {
      if (item.id < localIdStart) return item;
      const draft = await queue.get(item.id - localIdStart);
      if (!draft || draft.owner !== owner || draft.entry.type === "delete")
        throw Error("Record just finished syncing. Select it again.");
      return { ...item, source: { key: draft.key, entry: draft.entry } };
    }),
  );
  await queue.add({
    owner,
    key: crypto.randomUUID(),
    entry: { type: "delete", items: resolved },
  });
  await tx.done;
}
export async function forget(owner: number) {
  const tx = (await db()).transaction(["state", "ledgers"], "readwrite");
  if ((await tx.objectStore("state").get("active")) === owner)
    await tx.objectStore("state").delete("active");
  await tx.objectStore("ledgers").delete(owner);
  await tx.done;
}
export async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks
    ? navigator.locks.request("watertracker-sync", fn)
    : fn();
}
async function checked(r: Response) {
  if (r.status === 401 || r.status === 403)
    throw new AccountChanged("Sign in again to sync your saved entries.");
  if (!r.ok)
    throw Error(
      (await r.json().catch(() => ({}))).error ||
        "Sync is waiting for a connection.",
    );
}
export async function syncLedger(owner: number, activate = false) {
  return exclusive(async () => {
    const store = await db();
    if (!activate && (await activeOwner()) !== owner)
      throw new AccountChanged("The active account has changed.");
    const drafts = await store.getAllFromIndex("queue", "owner", owner);
    const headers = { "X-Ledger-Owner": String(owner) };
    // Keep drafts until the refreshed server ledger and their acknowledgements
    // can be committed together. Lost responses are safe to replay.
    for (const draft of drafts) {
      if (draft.entry.type === "delete") {
        const items = [];
        for (const item of draft.entry.items) {
          let id = item.id;
          if (item.source) {
            const replay = await fetch("/api/data", {
              method: "POST",
              headers: {
                ...headers,
                "Content-Type": "application/json",
                "Idempotency-Key": item.source.key,
              },
              body: JSON.stringify(item.source.entry),
            });
            await checked(replay);
            id = (await replay.json()).record.id;
          }
          items.push({ type: item.type, id });
        }
        const res = await fetch("/api/data", {
          method: "DELETE",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          signal: AbortSignal.timeout(18000),
        });
        await checked(res);
        continue;
      }
      const r = await fetch("/api/data", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": draft.key,
        },
        body: JSON.stringify(draft.entry),
        signal: AbortSignal.timeout(18000),
      });
      await checked(r);
    }
    const res = await fetch("/api/data", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(18000),
    });
    await checked(res);
    const data: Snapshot = await res.json();
    if (data.user?.id !== owner)
      throw new AccountChanged("The active account has changed.");
    const tx = store.transaction(["state", "ledgers", "queue"], "readwrite");
    const previous = await tx.objectStore("state").get("active");
    if (!activate && previous !== owner)
      throw new AccountChanged("The active account has changed.");
    if (previous && previous !== owner)
      await tx.objectStore("ledgers").delete(previous);
    await tx.objectStore("state").put(owner, "active");
    await tx.objectStore("ledgers").put(data, owner);
    for (const draft of drafts) await tx.objectStore("queue").delete(draft.id!);
    await tx.done;
  });
}
export const sender = Math.random().toString(36);
export function announce() {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("watertracker-device");
    channel.postMessage(sender);
    channel.close();
  }
}
