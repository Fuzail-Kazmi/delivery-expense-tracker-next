"use client";
import { useState } from "react";
import {
  Banknote,
  Wallet,
  Milk,
  PackagePlus,
  CreditCard,
  CalendarDays,
  Waves,
  ReceiptText,
  Plus,
  SlidersHorizontal,
  Droplets,
} from "lucide-react";
import {
  ledger as makeLedger,
  statement,
  money,
  formatDate,
  localDay,
  type LedgerRow,
} from "@/lib/ledger";
type Period = { from: string; to: string };
export function DateRange({
  value,
  onChange,
}: {
  value: Period;
  onChange: (range: Period) => void;
}) {
  return (
    <div className="date-range">
      <label>
        From date
        <input
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) =>
            onChange({
              from: e.target.value,
              to:
                value.to && value.to < e.target.value
                  ? e.target.value
                  : value.to,
            })
          }
        />
      </label>
      <label>
        To date
        <input
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) =>
            onChange({
              to: e.target.value,
              from:
                e.target.value && value.from > e.target.value
                  ? e.target.value
                  : value.from,
            })
          }
        />
      </label>
      <button className="link" onClick={() => onChange({ from: "", to: "" })}>
        Clear dates
      </button>
    </div>
  );
}
export function Overview({
  rows,
  price,
  add,
  go,
}: {
  rows: ReturnType<typeof makeLedger>;
  price: number;
  add: (kind: "payment" | "delivery") => void;
  go: (page: "ledger" | "pricing") => void;
}) {
  const [range, setRange] = useState<Period>({ from: "", to: "" });
  const [showDates, show] = useState(false);
  const all = statement(rows);
  const period = statement(rows, range.from, range.to);
  const filtered = Boolean(range.from || range.to);
  const latest = all.latest;
  const deliveryCount = rows.filter((r) => r.entityType === "delivery").length;
  const since = latest ? statement(rows.slice(rows.indexOf(latest) + 1)) : null;
  const lastDate = range.to || localDay();
  const end = new Date(lastDate + "T12:00:00");
  const months = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(end.getFullYear(), end.getMonth() - 5 + index, 1);
    const id =
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    return {
      id,
      label: d.toLocaleDateString("en-GB", { month: "short" }),
      ...statement(period.rows.filter((r) => r.date.startsWith(id))),
    };
  });
  const max = Math.max(1, ...months.flatMap((m) => [m.billed, m.paid]));
  const recent = period.rows.slice(-5).reverse();
  return (
    <div className="overview">
      <div className="title-row">
        <div>
          <h1>Dashboard</h1>
          <p>Your water supply at a glance.</p>
        </div>
        <button className="primary" onClick={() => add("delivery")}>
          <Plus size={17} /> Add bottles
        </button>
      </div>
      <div className="summary-grid">
        <section className="due-card">
          <div className="ripple" />
          <div className="card-kicker">
            <Wallet size={17} /> Remaining amount
          </div>
          <strong>{money(Math.max(0, all.closing))}</strong>
          <p>
            {all.closing < 0
              ? money(-all.closing) + " in advance credit"
              : all.closing === 0
                ? "Your account is settled"
                : "Current outstanding balance"}
          </p>
          <button onClick={() => add("payment")}>
            <Plus size={15} /> Record payment
          </button>
        </section>
        <section className="metric">
          <span className="metric-icon mint">
            <Banknote />
          </span>
          <h2>Last payment</h2>
          <strong>{latest ? money(latest.credit) : "—"}</strong>
          <p>
            {latest
              ? formatDate(latest.date) + " · " + latest.method
              : "No payments recorded"}
          </p>
          {latest && since && (
            <details className="payment-detail">
              <summary>Payment details</summary>
              <p>
                {money(latest.balance)}{" "}
                {latest.balance > 0 ? "in credit" : "due"} immediately after
                payment.
              </p>
              <p>
                {since.bottles} bottles delivered since, billed at{" "}
                {money(since.billed)}.
              </p>
            </details>
          )}
        </section>
        <section className="metric">
          <span className="metric-icon sky">
            <Milk />
          </span>
          <h2>Bottles with a balance</h2>
          <strong>{all.outstanding.count.toLocaleString()}</strong>
          <p>
            {all.outstanding.whole} fully unpaid
            {all.outstanding.partialDue > 0
              ? " · 1 partly paid (" +
                money(all.outstanding.partialDue) +
                " due)"
              : ""}
          </p>
          <p>
            {all.bottles.toLocaleString()} bottles delivered across{" "}
            {deliveryCount} {deliveryCount === 1 ? "delivery" : "deliveries"}
          </p>
        </section>
      </div>
      <div className="section-title">
        <div>
          <h2>Activity overview</h2>
          <p>
            {filtered
              ? [
                  range.from ? formatDate(range.from) : "Beginning",
                  range.to ? formatDate(range.to) : "Today",
                ].join(" – ")
              : "All recorded activity"}
          </p>
        </div>
        <button
          className="secondary"
          aria-expanded={showDates}
          onClick={() => show(!showDates)}
        >
          <SlidersHorizontal size={15} />
          {filtered ? "Date range" : "Filter dates"}
        </button>
      </div>
      {showDates && <DateRange value={range} onChange={setRange} />}
      {filtered && (
        <div className="statement-strip">
          <span>
            Opening {period.opening < 0 ? "credit" : "due"}
            <b>{money(period.opening)}</b>
          </span>
          <span>
            Bottles in period<b>{period.bottles}</b>
          </span>
          <span>
            Paid in period<b>{money(period.paid)}</b>
          </span>
          <span>
            Last paid in period
            <b>{period.latest ? money(period.latest.credit) : "—"}</b>
            {period.latest && formatDate(period.latest.date)}
          </span>
          <span>
            Bottles with a balance at closing<b>{period.outstanding.count}</b>
            {period.outstanding.partialDue > 0 ? "Includes 1 partly paid" : ""}
          </span>
          <span>
            Closing {period.closing < 0 ? "credit" : "due"}
            <b>{money(period.closing)}</b>
          </span>
        </div>
      )}
      <div className="analytics-grid">
        <section className="panel analytics">
          <div className="panel-heading">
            <h3>Bills and payments</h3>
            <p>
              Monthly totals · PKR · {months[0].label} – {months[5].label}{" "}
              {end.getFullYear()}
            </p>
          </div>
          <div className="legend-new">
            <span>Billed</span>
            <span>Paid</span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={months
              .map(
                (m) =>
                  m.label +
                  ": billed " +
                  money(m.billed) +
                  ", paid " +
                  money(m.paid),
              )
              .join(". ")}
          >
            {months.map((m) => (
              <div key={m.id}>
                <div
                  className="bars"
                  title={
                    m.label +
                    " · Billed " +
                    money(m.billed) +
                    " · Paid " +
                    money(m.paid)
                  }
                >
                  <i style={{ height: (m.billed / max) * 100 + "%" }} />
                  <i style={{ height: (m.paid / max) * 100 + "%" }} />
                </div>
                <small>{m.label}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel totals">
          <div className="panel-heading">
            <h3>Account summary</h3>
            <p>{filtered ? "Selected period" : "All time"}</p>
          </div>
          <dl>
            <div>
              <dt>
                <ReceiptText />
                Total billed
              </dt>
              <dd>{money(period.billed)}</dd>
            </div>
            <div>
              <dt>
                <CreditCard />
                Total paid
              </dt>
              <dd>{money(period.paid)}</dd>
            </div>
            <div>
              <dt>
                <Droplets />
                Current bottle price
              </dt>
              <dd>
                {price ? (
                  money(price)
                ) : (
                  <button className="link" onClick={() => go("pricing")}>
                    Set price
                  </button>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <section className="panel recent">
        <div className="section-title">
          <h3>Recent activity</h3>
          <button className="link" onClick={() => go("ledger")}>
            View ledger
          </button>
        </div>
        {recent.length ? (
          recent.map((row) => <Activity key={row.id} row={row} />)
        ) : (
          <div className="no-activity">
            <Waves size={25} />
            <span>
              {filtered
                ? "No deliveries or payments in this period."
                : "Your first delivery or payment will appear here."}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
function Activity({ row }: { row: LedgerRow }) {
  const payment = row.entityType === "payment";
  return (
    <div className="activity-line">
      <i className={"metric-icon " + (payment ? "mint" : "sky")}>
        {payment ? <Banknote /> : <PackagePlus />}
      </i>
      <div>
        <b>{row.description}</b>
        <small>
          <CalendarDays size={12} />
          {formatDate(row.date)}
        </small>
      </div>
      <strong>
        {money(payment ? row.credit : row.debit)}
        <small>{payment ? "Paid" : "Billed"}</small>
      </strong>
    </div>
  );
}
