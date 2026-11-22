"use client";
import { useEffect, useState } from "react";
import TrackerApp, { type Page } from "@/components/tracker-app";
import { activeOwner, savedLedger } from "@/lib/offline";
import type { Account } from "@/lib/auth";
export default function OfflinePage() {
  const [state, setState] = useState<{ user?: Account; page: Page } | null>(
    null,
  );
  useEffect(() => {
    (async () => {
      const owner = await activeOwner();
      const cached = owner ? await savedLedger(owner) : null;
      const route =
        new URLSearchParams(location.search).get("view") || "dashboard";
      const page = (
        [
          "dashboard",
          "deliveries",
          "payments",
          "pricing",
          "ledger",
          "reports",
          "settings",
        ].includes(route)
          ? route
          : "dashboard"
      ) as Page;
      setState({ user: cached?.snapshot.user, page });
    })().catch(() => setState({ page: "dashboard" }));
  }, []);
  if (state?.user)
    return (
      <TrackerApp initialPage={state.page} user={state.user} cachedShell />
    );
  return (
    <main style={{ margin: "auto", maxWidth: 480, padding: 28 }}>
      <h1>WaterTracker</h1>
      <p>
        {state
          ? "Connect to the internet and sign in once to set up offline access on this device."
          : "Opening your saved ledger…"}
      </p>
      {state && <a href="/signin">Sign in</a>}
    </main>
  );
}
