import test from "node:test";
import assert from "node:assert/strict";
import { ledger, statement, effectivePrice, csv } from "../lib/ledger.ts";
const deliveries = [
  { id: 1, date: "2026-01-31", qty: 10, price: 150, notes: "" },
];
const payments = [
  { id: 2, date: "2026-02-01", amount: 1000, method: "Cash", notes: "" },
];
test("partial payment carries January's bill into a payment-only February", () => {
  const rows = ledger(deliveries, payments);
  const period = statement(rows, "2026-02-01", "2026-02-28");
  assert.equal(period.opening, 1500);
  assert.equal(period.paid, 1000);
  assert.equal(period.closing, 500);
  assert.equal(period.bottles, 0);
  assert.equal(statement(rows).bottles, 10);
  assert.equal(period.latest.date, "2026-02-01");
  assert.equal(period.latest.credit, 1000);
  assert.equal(statement(rows, "2026-02-02", "2026-02-02").closing, 500);
});
test("same-day order, fractional rupees and overpayment", () => {
  const rows = ledger(
    [{ ...deliveries[0], price: 5.55, qty: 3 }],
    [
      { ...payments[0], id: 9, amount: 4.55 },
      { ...payments[0], id: 10, amount: 20 },
    ],
  );
  assert.equal(statement(rows).latest.entityId, 10);
  assert.equal(statement(rows).closing, -7.9);
});
test("effective price and CSV preserve historical values and quoted notes", () => {
  const prices = [
    { id: 1, date: "2026-01-01", price: 150 },
    { id: 3, date: "2026-01-01", price: 170 },
    { id: 4, date: "2026-02-01", price: 200 },
  ];
  assert.equal(effectivePrice(prices, "2026-01-10").price, 170);
  assert.equal(csv([{ note: 'Paid, "cash"' }]), '"note"\r\n"Paid, ""cash"""');
});

test("FIFO keeps historical bottle prices, partial bottles and advance credit exact", () => {
  const d = (id, date, qty, price) => ({ id, date, qty, price, notes: "" });
  const p = (id, date, amount) => ({
    id,
    date,
    amount,
    method: "Cash",
    notes: "",
  });
  const rows = ledger(
    [d(2, "2026-02-01", 3, 125), d(3, "2026-02-02", 2, 200)],
    [p(1, "2026-01-01", 50), p(4, "2026-02-03", 350)],
  );
  const first = statement(rows, "2026-02-01", "2026-02-01");
  assert.equal(first.closing, 325);
  assert.deepEqual(first.outstanding, { whole: 2, partialDue: 75, count: 3 });
  const latest = statement(rows);
  assert.equal(latest.closing, 375);
  assert.deepEqual(latest.outstanding, { whole: 1, partialDue: 175, count: 2 });
});
