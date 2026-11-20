"use client";
import { useState } from "react";
import { Bell, KeyRound, Moon, Sun } from "lucide-react";
export type AlertRow = {
  id: number;
  date: string;
  amount: number;
  seen: number;
};
export async function preference(data: Record<string, unknown>) {
  const response = await fetch("/api/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Unable to save settings.");
  return result;
}
export default function Preferences({
  dark,
  theme,
  threshold,
  update,
  alertChange,
  flash,
}: {
  dark: boolean;
  theme: (value: boolean) => void;
  threshold: number;
  update: (limit: number) => void;
  alertChange: (rows: AlertRow[]) => void;
  flash: (text: string) => void;
}) {
  const [amount, setAmount] = useState(String(threshold || ""));
  const [key, setKey] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  async function enable() {
    try {
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      )
        throw Error(
          "This browser supports in-app alerts only. On iPhone, open the app from the Home Screen over HTTPS.",
        );
      if ((await Notification.requestPermission()) !== "granted")
        throw Error(
          "Allow notifications in your browser settings to receive device alerts.",
        );
      const info = await (await fetch("/api/preferences")).json();
      await navigator.serviceWorker.register("/sw.js");
      const sw = await navigator.serviceWorker.ready;
      const s =
        (await sw.pushManager.getSubscription()) ||
        (await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: info.publicKey,
        }));
      await preference({ action: "subscribe", subscription: s.toJSON() });
      setSubscribed(true);
      flash("Device notifications enabled.");
    } catch (err) {
      flash((err as Error).message);
    }
  }
  return (
    <div className="preferences">
      <section className="panel">
        <h2>Appearance</h2>
        <p>Your theme follows your account across sign-ins.</p>
        <div className="theme-choices">
          <button
            className={!dark ? "chosen" : ""}
            onClick={() => theme(false)}
          >
            <Sun />
            Light
          </button>
          <button className={dark ? "chosen" : ""} onClick={() => theme(true)}>
            <Moon />
            Dark
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>
          <Bell size={19} /> Balance alerts
        </h2>
        <p>
          Get an alert when the amount you owe reaches your limit. Set it to
          zero to turn alerts off.
        </p>
        <form
          className="fields"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await preference({
                action: "threshold",
                amount: Number(amount),
              });
              update(Number(amount));
              alertChange(r.alerts);
              flash("Balance limit saved.");
            } catch (err) {
              flash((err as Error).message);
            }
          }}
        >
          <label>
            Balance limit (Rs.)
            <input
              required
              type="number"
              min="0"
              max="999999999"
              step=".01"
              value={amount}
              placeholder="1500"
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <div className="action-row">
            <button className="primary">Save limit</button>
            <button type="button" className="secondary" onClick={enable}>
              {subscribed ? "Device alerts enabled" : "Enable device alerts"}
            </button>
          </div>
        </form>
      </section>
      <section className="panel">
        <h2>
          <KeyRound size={19} /> Account recovery
        </h2>
        <p>
          Create a new recovery key to keep somewhere private. It replaces your
          previous key.
        </p>
        <form
          className="fields"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            try {
              const res = await fetch("/api/auth/recovery", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  password: new FormData(form).get("password"),
                }),
              });
              const r = await res.json();
              if (!res.ok) throw Error(r.error);
              setKey(r.recovery);
              form.reset();
            } catch (err) {
              flash((err as Error).message);
            }
          }}
        >
          <label>
            Current password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="secondary">Generate recovery key</button>
        </form>
        {key && <code className="recovery-code">{key}</code>}
      </section>
    </div>
  );
}
