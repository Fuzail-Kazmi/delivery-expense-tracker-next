export type Delivery = {
  id: number;
  date: string;
  qty: number;
  price: number;
  notes: string;
};
export type Payment = {
  id: number;
  date: string;
  amount: number;
  method: string;
  notes: string;
};
export type BottlePrice = {
  id: number;
  date: string;
  price: number;
  notes: string;
};
export const money = (value: number) =>
  "Rs. " +
  Math.abs(value).toLocaleString("en-PK", { maximumFractionDigits: 2 });
export const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date + "T12:00:00"));
export const localDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Karachi",
  }).format(new Date());
export function effectivePrice(prices: BottlePrice[], date: string) {
  return prices
    .filter((p) => p.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
}
export function ledger(deliveries: Delivery[], payments: Payment[]) {
  const rows = [
    ...deliveries.map((d) => ({
      id: "delivery-" + d.id,
      entityType: "delivery" as const,
      entityId: d.id,
      date: d.date,
      description:
        d.qty + (d.qty === 1 ? " bottle delivered" : " bottles delivered"),
      qty: d.qty,
      debit: (Math.round(d.price * 100) * d.qty) / 100,
      credit: 0,
      notes: d.notes,
      method: "",
    })),
    ...payments.map((p) => ({
      id: "payment-" + p.id,
      entityType: "payment" as const,
      entityId: p.id,
      date: p.date,
      description: "Payment · " + p.method,
      qty: 0,
      debit: 0,
      credit: p.amount,
      notes: p.notes,
      method: p.method,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.entityId - b.entityId);
  let cents = 0;
  return rows.map((r) => {
    cents += Math.round(r.credit * 100) - Math.round(r.debit * 100);
    return { ...r, balance: cents / 100 };
  });
}
export type LedgerRow = ReturnType<typeof ledger>[number];
// Payments and advance credit settle the oldest delivered bottles first.
// At most one bottle can carry a partially paid balance at a cut-off date.
export function bottleBalance(rows: LedgerRow[], to = "") {
  const history = to ? rows.filter((r) => r.date <= to) : rows;
  let available = history.reduce((s, r) => s + Math.round(r.credit * 100), 0);
  let whole = 0,
    partialDue = 0;
  for (const row of history) {
    if (!row.qty) continue;
    const billed = Math.round(row.debit * 100),
      unit = billed / row.qty;
    const applied = Math.min(billed, available);
    available -= applied;
    const remainder = applied % unit;
    whole += row.qty - Math.floor(applied / unit) - (remainder ? 1 : 0);
    if (remainder) partialDue = (unit - remainder) / 100;
  }
  return { whole, partialDue, count: whole + (partialDue ? 1 : 0) };
}
export function statement(rows: LedgerRow[], from = "", to = "") {
  const included = rows.filter(
    (r) => (!from || r.date >= from) && (!to || r.date <= to),
  );
  const opening = from
    ? -(rows.filter((r) => r.date < from).at(-1)?.balance ?? 0)
    : 0;
  const billed =
    included.reduce((n, r) => n + Math.round(r.debit * 100), 0) / 100;
  const paid =
    included.reduce((n, r) => n + Math.round(r.credit * 100), 0) / 100;
  return {
    opening,
    closing:
      (Math.round(opening * 100) +
        Math.round(billed * 100) -
        Math.round(paid * 100)) /
      100,
    outstanding: bottleBalance(rows, to),
    billed,
    paid,
    bottles: included.reduce((n, r) => n + r.qty, 0),
    latest: included.findLast((r) => r.entityType === "payment"),
    rows: included,
  };
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  function cell(v: unknown) {
    const raw = String(v ?? "");
    const safe =
      typeof v === "string" && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  }
  return [
    keys.map(cell).join(","),
    ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
  ].join("\r\n");
}
