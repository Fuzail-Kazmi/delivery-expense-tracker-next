"use client";
import { useState } from "react";
import { Download, Share2, Printer } from "lucide-react";
import { DateRange } from "./overview";
import {
  csv,
  formatDate,
  money,
  statement,
  type LedgerRow,
} from "@/lib/ledger";
export default function Statements({
  rows,
  query,
  flash,
  remove,
}: {
  rows: LedgerRow[];
  query: string;
  flash: (s: string) => void;
  remove: (
    items: { type: "delivery" | "payment"; id: number }[],
    context: string,
  ) => void;
}) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [sharing, setSharing] = useState("");
  const period = statement(rows, range.from, range.to);
  const months = [...new Set(period.rows.map((r) => r.date.slice(0, 7)))]
    .reverse()
    .map((id) => {
      const label = new Date(id + "-01T12:00:00").toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      });
      const from = range.from > id + "-01" ? range.from : id + "-01";
      const to = range.to && range.to < id + "-31" ? range.to : id + "-31";
      return { id, label, ...statement(rows, from, to) };
    })
    .filter((m) =>
      (m.label + " " + m.id).toLowerCase().includes(query.trim().toLowerCase()),
    );
  const active = months.filter((m) => selected.includes(m.id));
  const output = months.map((m) => ({
    Month: m.label,
    From: range.from || "All history",
    To: range.to || "Latest",
    "Delivered bottles": m.bottles,
    "Bottles with a closing balance": m.outstanding.count,
    "Fully unpaid bottles": m.outstanding.whole,
    "Remaining on partly paid bottle (PKR)": m.outstanding.partialDue,
    "Opening due (negative = credit)": m.opening,
    "Billed PKR": m.billed,
    "Paid PKR": m.paid,
    "Closing due (negative = credit)": m.closing,
    "Last payment PKR": m.latest?.credit ?? "",
    "Last payment date": m.latest?.date ?? "",
  }));
  const shareText = [
    "WaterTracker statement",
    ...months.map(
      (m) =>
        m.label +
        " · " +
        m.bottles +
        " bottles · billed " +
        money(m.billed) +
        " · paid " +
        money(m.paid) +
        " · closing " +
        (m.closing < 0 ? "credit " : "due ") +
        money(m.closing) +
        " · " +
        m.outstanding.count +
        " bottles with a balance",
    ),
  ].join("\n");
  const file = () =>
    new File(
      ["\uFEFF" + csv(output)],
      "water-statement-" +
        (range.from || "all") +
        "-" +
        (range.to || "latest") +
        ".csv",
      { type: "text/csv;charset=utf-8" },
    );
  async function share() {
    try {
      const f = file();
      if (navigator.canShare?.({ files: [f] })) {
        await navigator.share({ title: "WaterTracker statement", files: [f] });
        return;
      }
      if (navigator.share) {
        await navigator.share({
          title: "WaterTracker statement",
          text: shareText,
        });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        flash("Report copied for sharing.");
        return;
      }
      setSharing(shareText);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setSharing(shareText);
    }
  }
  return (
    <section className="panel report">
      <div className="section-title">
        <div>
          <h2>Monthly statements</h2>
          <p>
            Opening and closing balances include earlier deliveries and
            payments.
          </p>
        </div>
      </div>
      <DateRange
        value={range}
        onChange={(r) => {
          setRange(r);
          setSelected([]);
          setSharing("");
        }}
      />
      <div className="report-actions">
        <button
          className="primary"
          disabled={!months.length}
          onClick={() => {
            const url = URL.createObjectURL(file());
            const a = document.createElement("a");
            a.href = url;
            a.download = file().name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={15} />
          Download CSV
        </button>
        <button className="secondary" disabled={!months.length} onClick={share}>
          <Share2 size={15} />
          Share report
        </button>
        <button className="secondary" onClick={() => window.print()}>
          <Printer size={15} />
          Print / PDF
        </button>
        {active.length > 0 && (
          <button
            className="danger"
            onClick={() =>
              remove(
                active.flatMap((m) =>
                  m.rows.map((r) => ({ type: r.entityType, id: r.entityId })),
                ),
                "The deliveries and payments in the selected statements will be removed.",
              )
            }
          >
            Delete selected
          </button>
        )}
      </div>
      {sharing && (
        <label className="share-manual">
          Copy this report
          <textarea
            value={sharing}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
      <p className="print-range">
        Statement period · {range.from || "Beginning"} to{" "}
        {range.to || "Latest record"}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-cell">
                <input
                  type="checkbox"
                  aria-label="Select all statements"
                  checked={!!months.length && active.length === months.length}
                  onChange={() =>
                    setSelected(
                      active.length === months.length
                        ? []
                        : months.map((m) => m.id),
                    )
                  }
                />
              </th>
              {[
                "Month",
                "Opening balance",
                "Bottles",
                "Billed",
                "Paid",
                "Closing balance",
                "Bottles with a balance",
                "Last payment",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.id}>
                <td className="check-cell">
                  <input
                    type="checkbox"
                    aria-label={"Select " + m.label}
                    checked={selected.includes(m.id)}
                    onChange={() =>
                      setSelected(
                        selected.includes(m.id)
                          ? selected.filter((id) => id !== m.id)
                          : [...selected, m.id],
                      )
                    }
                  />
                </td>
                <td data-label="Month">{m.label}</td>
                <td data-label="Opening balance">
                  {money(m.opening)} {m.opening < 0 ? "credit" : "due"}
                </td>
                <td data-label="Bottles">{m.bottles}</td>
                <td data-label="Billed">{money(m.billed)}</td>
                <td data-label="Paid">{money(m.paid)}</td>
                <td data-label="Closing balance">
                  <b>{money(m.closing)}</b> {m.closing < 0 ? "credit" : "due"}
                </td>
                <td data-label="Bottles with a balance">
                  {m.outstanding.count}
                  {m.outstanding.partialDue > 0 && (
                    <small className="note">
                      1 partly paid · {money(m.outstanding.partialDue)} due
                    </small>
                  )}
                </td>
                <td data-label="Last payment">
                  {m.latest ? (
                    <>
                      {money(m.latest.credit)}
                      <small className="note">
                        {formatDate(m.latest.date)}
                      </small>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!months.length && (
        <p className="no-activity">No statements match this view.</p>
      )}
    </section>
  );
}
