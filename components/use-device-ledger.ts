"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeOwner,
  savedLedger,
  syncLedger,
  forget,
  AccountChanged,
  announce,
  type Snapshot,
} from "@/lib/offline";

export function useDeviceLedger(
  owner: number,
  cachedShell: boolean,
  apply: (data: Snapshot) => void,
  failed: () => void,
) {
  const [pending, setPending] = useState(0),
    [online, setOnline] = useState(true),
    [ready, setReady] = useState(false),
    [issue, setIssue] = useState(""),
    [storage, setStorage] = useState(true);
  const alive = useRef(true);
  const readLocal = useCallback(async () => {
    const view = await savedLedger(owner);
    if (view && alive.current) {
      apply(view.snapshot);
      setPending(view.pending);
    }
    return Boolean(view);
  }, [owner, apply]);
  const reload = useCallback(
    async (activate = false) => {
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }
      try {
        await syncLedger(owner, activate);
        if (alive.current) {
          await readLocal();
          setOnline(true);
          setIssue("");
          announce();
        }
      } catch (e) {
        if (!alive.current) return;
        if (e instanceof AccountChanged) {
          await forget(owner);
          announce();
          location.replace("/signin?reason=sync");
          return;
        }
        setIssue("Sync paused. Your saved entries stay on this device.");
        if (!(await readLocal().catch(() => false))) failed();
      }
    },
    [owner, readLocal, failed],
  );
  useEffect(() => {
    alive.current = true;
    let cancelled = false,
      canStore = true,
      booted = false;
    const start = async () => {
      setOnline(navigator.onLine);
      try {
        await activeOwner();
      } catch {
        canStore = false;
        if (cancelled) return;
        setStorage(false);
        const res = await fetch("/api/data", {
          headers: { "X-Ledger-Owner": String(owner) },
        });
        if (res.status === 401 || res.status === 403) {
          location.replace("/signin");
          return;
        }
        if (!res.ok) throw Error("Ledger unavailable");
        apply(await res.json());
        return;
      }
      const loaded = await readLocal();
      if (cancelled) return;
      if (navigator.onLine) await reload(!cachedShell);
      else if (!loaded) failed();
      booted = true;
    };
    void start().catch(() => {
      if (!cancelled) failed();
    });
    let cleanupWorker: (() => void) | undefined;
    if ("serviceWorker" in navigator) {
      const installed = () => {
        void caches
          .match("/offline")
          .then((r) => {
            if (!cancelled && r) setReady(true);
          })
          .catch(() => {});
      };
      navigator.serviceWorker.addEventListener("controllerchange", installed);
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then(() => navigator.serviceWorker.ready)
        .then(installed)
        .catch(() => {});
      installed();
      cleanupWorker = () =>
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          installed,
        );
    }
    const reconnect = () => {
      setOnline(navigator.onLine);
      if (booted && canStore && navigator.onLine) void reload();
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("watertracker-device")
        : null;
    if (channel)
      channel.onmessage = () => {
        if (booted)
          void activeOwner().then((active) => {
            if (active !== owner) location.replace("/signin");
            else void readLocal();
          });
      };
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", reconnect);
    window.addEventListener("focus", reconnect);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reconnect();
    }, 45000);
    return () => {
      cancelled = true;
      alive.current = false;
      channel?.close();
      cleanupWorker?.();
      clearInterval(timer);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", reconnect);
      window.removeEventListener("focus", reconnect);
    };
  }, [owner, cachedShell, readLocal, reload, apply, failed]);
  return { pending, online, ready, issue, storage, readLocal, reload };
}
