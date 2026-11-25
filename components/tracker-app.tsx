"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  Milk,
  CreditCard,
  Tags,
  NotebookText,
  ChartNoAxesCombined,
  Settings2,
  Menu,
  ChevronRight,
  Moon,
  Sun,
  Bell,
  Search,
  LogOut,
  Plus,
  CalendarDays,
  PanelLeft,
} from "lucide-react";
import { useDeviceLedger } from "./use-device-ledger";
import {
  savedLedger,
  enqueue,
  queueDelete,
  exclusive,
  localIdStart,
  forget,
  announce,
  type Snapshot,
  type NewEntry,
} from "@/lib/offline";
import { recordSchema } from "@/lib/entry-input";
import { AccountPanel } from "./account-panel";
import { Users } from "lucide-react";
import { Brand } from "./brand";
import { Overview } from "./overview";
import Preferences, { preference, type AlertRow } from "./preferences";
import Statements from "./statements";
import {
  ledger,
  money,
  formatDate,
  csv,
  effectivePrice,
  localDay,
  type Delivery,
  type Payment,
  type BottlePrice,
  type LedgerRow,
} from "@/lib/ledger";
import type { Account } from "@/lib/auth";

export type Page =
  | "dashboard"
  | "deliveries"
  | "payments"
  | "pricing"
  | "ledger"
  | "reports"
  | "users"
  | "settings";
type EntryType = "delivery" | "payment" | "price";
type EditableRecord = Delivery | Payment | BottlePrice;
type FilterMode = "all" | "date" | "range" | "month" | "year";
type DeleteItem = { type: EntryType; id: number };
type DeleteRequest = { title: string; message: string; items: DeleteItem[] };
const pages = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "deliveries", icon: Milk, label: "Bottle deliveries" },
  { id: "payments", icon: CreditCard, label: "Payments" },
  { id: "pricing", icon: Tags, label: "Bottle prices" },
  { id: "ledger", icon: NotebookText, label: "Ledger" },
  { id: "reports", icon: ChartNoAxesCombined, label: "Reports" },
  { id: "users", icon: Users, label: "Users" },
  { id: "settings", icon: Settings2, label: "Settings" },
] as const;

const matchesSearch = (value: unknown, query: string) =>
  JSON.stringify(value).toLowerCase().includes(query.trim().toLowerCase());
const matchesDateFilter = (
  date: string,
  mode: FilterMode,
  value: string,
  startDate?: string,
  endDate?: string,
) => {
  if (mode === "all") return true;
  if (mode === "date") return !value || date === value;
  if (mode === "range") {
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    return true;
  }
  if (mode === "month") return !value || date.startsWith(value);
  if (mode === "year") return !value || date.startsWith(`${value}-`);
  return true;
};
const uniqueDeleteItems = (items: DeleteItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export default function TrackerApp({
  initialPage,
  user,
  cachedShell = false,
}: {
  initialPage: Page;
  user: Account;
  cachedShell?: boolean;
}) {
  const [page, setPage] = useState(initialPage);
  const [dark, setDark] = useState(user.theme === "dark");
  const [threshold, setThreshold] = useState(user.threshold / 100);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<EntryType | null>(null);
  const [editingRecord, setEditingRecord] = useState<EditableRecord | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<DeleteRequest | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [prices, setPrices] = useState<BottlePrice[]>([]);
  const [loading, setLoading] = useState(true);
  const toastTimer = useRef<number | null>(null);

  const flash = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  const [profile, setProfile] = useState(user);
  const owner = user.id;
  const apply = useCallback((data: Snapshot) => {
    setProfile(data.user);
    setDeliveries(data.deliveries);
    setPayments(data.payments);
    setPrices(data.prices);
    setAlerts(data.alerts);
    setDark(data.user.theme === "dark");
    setThreshold(data.user.threshold / 100);
    setLoadError(false);
    setLoading(false);
  }, []);
  const failed = useCallback(() => {
    setLoadError(true);
    setLoading(false);
  }, []);
  const { pending, online, ready, issue, storage, readLocal, reload } =
    useDeviceLedger(owner, cachedShell, apply, failed);

  async function signOut() {
    if (!navigator.onLine) {
      flash(
        "Reconnect to sign out and remove the saved ledger from this device.",
      );
      return;
    }
    try {
      await exclusive(async () => {
        if (storage && (await savedLedger(owner))?.pending) {
          flash("Sync your pending entries before signing out.");
          return;
        }
        const res = await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ledger-Owner": String(owner),
          },
          body: "{}",
        });
        if (!res.ok) throw Error();
        if (storage) {
          await forget(owner);
          announce();
        }
        location.replace("/signin");
      });
    } catch {
      flash("Unable to sign out. Check your connection and try again.");
    }
  }

  useEffect(() => {
    const onPopState = () => {
      const route = window.location.pathname.slice(1) as Page;
      if (pages.some((item) => item.id === route)) setPage(route);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const ledgerRows = useMemo(
    () => ledger(deliveries, payments),
    [deliveries, payments],
  );
  const currentPrice = effectivePrice(prices, localDay())?.price || 0;
  async function changeTheme(next: boolean) {
    try {
      await preference({ action: "theme", theme: next ? "dark" : "light" });
      setDark(next);
      if (storage) void reload();
    } catch {
      flash("Could not save the theme.");
    }
  }
  async function toggleAlerts() {
    setShowAlerts(!showAlerts);
    if (!showAlerts) {
      try {
        const r = await preference({ action: "read" });
        setAlerts(r.alerts);
      } catch {
        flash("Unable to load notifications.");
      }
    }
  }
  const go = (nextPage: Page) => {
    setPage(nextPage);
    setShowAlerts(false);
    setMenuOpen(false);
    setQuery("");
    window.history.pushState({}, "", `/${nextPage}`);
  };

  const openAdd = (type: EntryType) => {
    setEditingRecord(null);
    setModal(type);
  };

  const openEdit = (type: EntryType, record: EditableRecord) => {
    if (!online || record.id >= localIdStart) {
      flash("Reconnect and sync before editing this record.");
      return;
    }
    setEditingRecord(record);
    setModal(type);
  };

  const closeEditor = () => {
    setModal(null);
    setEditingRecord(null);
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = modal;
    if (!type || saving) return;
    setSaving(true);
    const common = {
      type,
      ...(editingRecord ? { id: editingRecord.id } : {}),
      date: String(form.get("date")),
      notes: String(form.get("notes")),
    };
    const payload =
      type === "delivery"
        ? {
            ...common,
            qty: Number(form.get("qty")),
            price: Number(form.get("price")),
          }
        : type === "payment"
          ? {
              ...common,
              amount: Number(form.get("amount")),
              method: String(form.get("method")),
            }
          : { ...common, price: Number(form.get("price")) };
    try {
      if (!editingRecord && storage) {
        const valid = recordSchema.safeParse(payload);
        if (!valid.success) throw Error(valid.error.issues[0].message);
        await enqueue(owner, valid.data as NewEntry);
        closeEditor();
        await readLocal();
        announce();
        if (navigator.onLine) void reload();
        const waiting = (await savedLedger(owner))?.pending;
        if (waiting && "serviceWorker" in navigator) {
          void navigator.serviceWorker
            .getRegistration()
            .then((reg) =>
              (
                reg as
                  | (ServiceWorkerRegistration & {
                      sync?: { register: (tag: string) => Promise<void> };
                    })
                  | undefined
              )?.sync?.register("watertracker-entries"),
            )
            .catch(() => {});
        }
        flash(
          waiting ? "Saved on this device. Waiting to sync." : "Record saved.",
        );
        return;
      }
      const response = await fetch("/api/data", {
        method: editingRecord ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
          "X-Ledger-Owner": String(owner),
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Save failed");
      const { record } = result;
      setAlerts(result.alerts);
      if (type === "delivery")
        setDeliveries((current) =>
          editingRecord
            ? current.map((item) => (item.id === record.id ? record : item))
            : [...current, record],
        );
      if (type === "payment")
        setPayments((current) =>
          editingRecord
            ? current.map((item) => (item.id === record.id ? record : item))
            : [...current, record],
        );
      if (type === "price")
        setPrices((current) =>
          editingRecord
            ? current.map((item) => (item.id === record.id ? record : item))
            : [...current, record],
        );
      if (storage) void reload();
      const action = editingRecord ? "updated" : "saved";
      closeEditor();
      flash(`${type[0].toUpperCase()}${type.slice(1)} ${action}`);
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (storage) {
        await queueDelete(owner, uniqueDeleteItems(pendingDelete.items));
        setPendingDelete(null);
        await readLocal();
        announce();
        if (navigator.onLine) void reload();
        else
          void navigator.serviceWorker
            ?.getRegistration()
            .then((r) =>
              (
                r as
                  | (ServiceWorkerRegistration & {
                      sync?: { register: (tag: string) => Promise<void> };
                    })
                  | undefined
              )?.sync?.register("watertracker-entries"),
            )
            .catch(() => {});
        flash("Deletion saved.");
        return;
      }
      const response = await fetch("/api/data", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "X-Ledger-Owner": String(owner),
        },
        body: JSON.stringify({ items: uniqueDeleteItems(pendingDelete.items) }),
      });
      if (!response.ok) throw new Error("Delete failed");
      setAlerts((await response.json()).alerts);
      const deliveryIds = new Set(
        pendingDelete.items
          .filter((item) => item.type === "delivery")
          .map((item) => item.id),
      );
      const paymentIds = new Set(
        pendingDelete.items
          .filter((item) => item.type === "payment")
          .map((item) => item.id),
      );
      const priceIds = new Set(
        pendingDelete.items
          .filter((item) => item.type === "price")
          .map((item) => item.id),
      );
      setDeliveries((current) =>
        current.filter((item) => !deliveryIds.has(item.id)),
      );
      setPayments((current) =>
        current.filter((item) => !paymentIds.has(item.id)),
      );
      setPrices((current) => current.filter((item) => !priceIds.has(item.id)));
      flash(
        `${uniqueDeleteItems(pendingDelete.items).length} record${pendingDelete.items.length === 1 ? "" : "s"} deleted`,
      );
      if (storage) void reload();
      setPendingDelete(null);
    } catch {
      flash("Could not delete the selected records");
    } finally {
      setDeleting(false);
    }
  }

  const requestDelete = (items: DeleteItem[], context: string) => {
    const uniqueItems = uniqueDeleteItems(items);
    setPendingDelete({
      title:
        uniqueItems.length === 1
          ? "Delete this record?"
          : `Delete ${uniqueItems.length} records?`,
      message: `${context} This action cannot be undone.`,
      items: uniqueItems,
    });
  };

  function download(name: string, data: object[]) {
    if (!data.length) {
      flash("There are no records to export");
      return;
    }
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv(data as Record<string, unknown>[])], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `water-${name}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash("CSV export downloaded");
  }

  const activePage = pages.find((item) => item.id === page) ?? pages[0];
  const headerEntry: EntryType | null =
    page === "payments"
      ? "payment"
      : page === "pricing"
        ? "price"
        : ["dashboard", "deliveries"].includes(page)
          ? "delivery"
          : null;
  const searchable = [
    "deliveries",
    "payments",
    "pricing",
    "ledger",
    "reports",
  ].includes(page);

  return (
    <div className={dark ? "app dark" : "app"}>
      <aside
        className={menuOpen ? "sidebar open" : "sidebar"}
        aria-label="Main navigation"
      >
        <Brand />
        <div className="workspace-tag">Delivery workspace</div>
        <nav>
          {pages
            .filter((item) => item.id !== "users" || profile.admin)
            .map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "active" : ""}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => go(item.id)}
              >
                <item.icon size={19} />
                {item.label}
              </button>
            ))}
        </nav>
        <div className="profile">
          <span className="avatar">
            {profile.email.slice(0, 2).toUpperCase()}
          </span>
          <p>
            <b>{profile.admin ? "Administrator" : "Personal account"}</b>
            <small>{profile.email}</small>
          </p>
          <button title="Sign out" aria-label="Sign out" onClick={signOut}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="menu-scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <main>
        <header>
          <button
            className="hamb"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="crumb">
            <PanelLeft size={17} />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{activePage.label}</b>
          </div>
          <div className="header-actions">
            <span className="today">
              <CalendarDays size={15} />
              {formatDate(localDay())}
            </span>
            <button
              className="icon-button"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={() => changeTheme(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="icon-button bell"
              aria-label="Notifications"
              aria-expanded={showAlerts}
              onClick={toggleAlerts}
            >
              <Bell size={18} />
              {alerts.some((a) => !a.seen) && <i />}
            </button>
          </div>
          {showAlerts && (
            <div className="notification-pop">
              <h3>Notifications</h3>
              {alerts.length ? (
                alerts.map((a) => (
                  <div key={a.id}>
                    <b>Balance reached {money(a.amount)}</b>
                    <small>{formatDate(a.date)}</small>
                  </div>
                ))
              ) : (
                <p>No balance alerts yet.</p>
              )}
            </div>
          )}
        </header>
        <div className="content">
          {!loading && !loadError && (
            <div className="sync-strip" role="status">
              <span>
                {!storage
                  ? "Online only · Device storage unavailable"
                  : !online
                    ? "Offline · Saved on this device"
                    : issue ||
                      (!ready
                        ? "Preparing offline access…"
                        : "Ready for offline use")}
              </span>
              {pending > 0 && (
                <b>
                  {pending} pending {pending === 1 ? "entry" : "entries"}
                </b>
              )}
              {(pending > 0 || issue) && online && (
                <button className="link" onClick={() => void reload()}>
                  Sync now
                </button>
              )}
            </div>
          )}
          {page !== "dashboard" && (
            <div className="title-row">
              <div>
                <h1>{activePage.label}</h1>
                <p>
                  {
                    {
                      deliveries:
                        "Record bottles received and their delivery prices.",
                      payments: "Review payments made to your supplier.",
                      pricing: "Manage your price per bottle over time.",
                      ledger:
                        "Follow each charge, payment and running balance.",
                      reports:
                        "Download or share your water supply statements.",
                      users: "Manage access to your app.",
                      settings: "Manage your account preferences.",
                    }[page]
                  }
                </p>
              </div>
              {headerEntry && (
                <button
                  className="primary"
                  onClick={() => openAdd(headerEntry)}
                >
                  <Plus size={16} />
                  {headerEntry === "delivery"
                    ? "Add bottles"
                    : headerEntry === "price"
                      ? "Add price"
                      : "Record payment"}
                </button>
              )}
            </div>
          )}
          {searchable && (
            <label className="record-search">
              <Search size={17} />
              <input
                aria-label={"Search " + activePage.label}
                placeholder={
                  page === "reports"
                    ? "Search month or year…"
                    : "Search records…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          {loadError && (
            <div className="panel no-activity">
              Your records could not be loaded.{" "}
              <button className="link" onClick={() => location.reload()}>
                Retry
              </button>
            </div>
          )}
          {loading ? <LoadingState /> : null}
          {!loading && !loadError && page === "dashboard" ? (
            <Overview
              rows={ledgerRows}
              price={currentPrice}
              add={openAdd}
              go={go}
            />
          ) : null}
          {!loading && !loadError && page === "deliveries" ? (
            <DeliveriesPage
              data={deliveries}
              query={query}
              onEdit={(record) => openEdit("delivery", record)}
              onDelete={requestDelete}
              onExport={(data) => download("deliveries", data)}
            />
          ) : null}
          {!loading && !loadError && page === "payments" ? (
            <PaymentsPage
              data={payments}
              query={query}
              onEdit={(record) => openEdit("payment", record)}
              onDelete={requestDelete}
              onExport={(data) => download("payments", data)}
            />
          ) : null}
          {!loading && !loadError && page === "pricing" ? (
            <PricingPage
              data={prices}
              query={query}
              onEdit={(record) => openEdit("price", record)}
              onDelete={requestDelete}
              onExport={(data) => download("pricing", data)}
            />
          ) : null}
          {!loading && !loadError && page === "ledger" ? (
            <LedgerPage
              data={ledgerRows}
              query={query}
              onEdit={(type, id) => {
                const record =
                  type === "delivery"
                    ? deliveries.find((item) => item.id === id)
                    : payments.find((item) => item.id === id);
                if (record) openEdit(type, record);
              }}
              onDelete={requestDelete}
              onExport={(data) => download("ledger", data)}
            />
          ) : null}
          {!loading && !loadError && page === "reports" ? (
            <Statements
              rows={ledgerRows}
              query={query}
              flash={flash}
              remove={requestDelete}
            />
          ) : null}
          {!loading &&
            !loadError &&
            (page === "settings" || (page === "users" && profile.admin)) && (
              <AccountPanel
                key={page}
                users={page === "users"}
                online={online}
                owner={owner}
              />
            )}
          {!loading && !loadError && page === "settings" ? (
            <Preferences
              dark={dark}
              theme={changeTheme}
              threshold={threshold}
              update={setThreshold}
              alertChange={setAlerts}
              flash={flash}
            />
          ) : null}
        </div>
      </main>
      {modal ? (
        <EntryDialog
          key={`${modal}-${editingRecord?.id ?? "new"}`}
          type={modal}
          record={editingRecord}
          prices={prices}
          busy={saving}
          close={closeEditor}
          save={save}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmDialog
          request={pendingDelete}
          deleting={deleting}
          cancel={() => setPendingDelete(null)}
          confirm={confirmDelete}
        />
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function useSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const key = ids.join("|");
  const visibleIds = useMemo(() => (key ? key.split("|") : []), [key]);
  const visible = new Set(visibleIds);
  const visibleSelected = new Set(
    [...selected].filter((id) => visible.has(id)),
  );
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => visibleSelected.has(id));
  return {
    selected: visibleSelected,
    toggle: (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: () => setSelected(allSelected ? new Set() : new Set(visibleIds)),
    allSelected,
  };
}

type FilterState = {
  mode: FilterMode;
  value: string;
  startDate: string;
  endDate: string;
};

const DEFAULT_FILTER_STATE: FilterState = {
  mode: "all",
  value: "",
  startDate: "",
  endDate: "",
};

function useDateFilter<T extends { date: string }>(
  data: T[],
  query: string,
  storageKey = "water_tracker_filter",
) {
  const [filterState, setFilterState] = useState<FilterState>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            mode: parsed.mode ?? "all",
            value: parsed.value ?? "",
            startDate: parsed.startDate ?? "",
            endDate: parsed.endDate ?? "",
          };
        }
      } catch (error) {
        void error;
      }
    }
    return DEFAULT_FILTER_STATE;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(filterState));
    } catch (error) {
      void error;
    }
  }, [filterState, storageKey]);

  const setMode = (mode: FilterMode) =>
    setFilterState({ mode, value: "", startDate: "", endDate: "" });
  const setValue = (value: string) =>
    setFilterState((prev) => ({ ...prev, value }));
  const setStartDate = (startDate: string) =>
    setFilterState((prev) => ({
      ...prev,
      startDate,
      endDate:
        prev.endDate && prev.endDate < startDate ? startDate : prev.endDate,
    }));
  const setEndDate = (endDate: string) =>
    setFilterState((prev) => ({
      ...prev,
      endDate,
      startDate: endDate && prev.startDate > endDate ? endDate : prev.startDate,
    }));
  const clearFilter = () => setFilterState(DEFAULT_FILTER_STATE);

  const filtered = useMemo(
    () =>
      data.filter(
        (item) =>
          matchesDateFilter(
            item.date,
            filterState.mode,
            filterState.value,
            filterState.startDate,
            filterState.endDate,
          ) && matchesSearch(item, query),
      ),
    [data, filterState, query],
  );

  return {
    mode: filterState.mode,
    value: filterState.value,
    startDate: filterState.startDate,
    endDate: filterState.endDate,
    setMode,
    setValue,
    setStartDate,
    setEndDate,
    clearFilter,
    filtered,
  };
}

function PageToolbar({
  title,
  count,
  selectedCount,
  onAdd,
  onExport,
  onPrint,
  onDelete,
}: {
  title: string;
  count: number;
  selectedCount: number;
  onAdd?: () => void;
  onExport?: () => void;
  onPrint?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="toolbar">
      <div>
        <h2>{title}</h2>
        <p>
          {count} record{count === 1 ? "" : "s"}
        </p>
      </div>
      <section>
        {selectedCount > 0 && onDelete ? (
          <button className="danger" onClick={onDelete}>
            Delete selected ({selectedCount})
          </button>
        ) : null}
        {onPrint ? (
          <button className="secondary" onClick={onPrint}>
            Print / PDF
          </button>
        ) : null}
        {onExport ? (
          <button className="secondary" onClick={onExport}>
            ⇩ Export CSV
          </button>
        ) : null}
        {onAdd ? (
          <button className="primary" onClick={onAdd}>
            ＋ Add new
          </button>
        ) : null}
      </section>
    </div>
  );
}

function DateFilter({
  mode,
  value,
  startDate,
  endDate,
  setMode,
  setValue,
  setStartDate,
  setEndDate,
  clearFilter,
}: {
  mode: FilterMode;
  value: string;
  startDate?: string;
  endDate?: string;
  setMode: (mode: FilterMode) => void;
  setValue: (value: string) => void;
  setStartDate?: (val: string) => void;
  setEndDate?: (val: string) => void;
  clearFilter: () => void;
}) {
  return (
    <div className="filters" aria-label="Date filters">
      <label>
        Filter by
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as FilterMode)}
        >
          <option value="all">All time</option>
          <option value="date">Exact date</option>
          <option value="range">Date range (From - To)</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
        </select>
      </label>
      {mode === "date" ? (
        <label>
          Choose date
          <input
            aria-label="Filter by exact date"
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      ) : null}
      {mode === "range" ? (
        <>
          <label>
            From Date
            <input
              aria-label="Filter from date"
              type="date"
              max={endDate || undefined}
              value={startDate ?? ""}
              onChange={(event) => setStartDate?.(event.target.value)}
            />
          </label>
          <label>
            To Date
            <input
              aria-label="Filter to date"
              type="date"
              min={startDate || undefined}
              value={endDate ?? ""}
              onChange={(event) => setEndDate?.(event.target.value)}
            />
          </label>
        </>
      ) : null}
      {mode === "month" ? (
        <label>
          Choose month
          <input
            aria-label="Filter by month"
            type="month"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      ) : null}
      {mode === "year" ? (
        <label>
          Enter year
          <input
            aria-label="Filter by year"
            type="number"
            min="2000"
            max="2100"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      ) : null}
      {mode !== "all" || value || startDate || endDate ? (
        <button type="button" className="text-button" onClick={clearFilter}>
          Clear filter
        </button>
      ) : null}
    </div>
  );
}

function SelectAll({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      className="row-check"
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
    />
  );
}

function RowActionButton({
  action,
  label,
  onClick,
}: {
  action: "edit" | "delete";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`row-icon-button ${action}-action`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {action === "edit" ? <PencilIcon /> : <TrashIcon />}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m14.7 5.3 4 4M4 20l3.7-.8L19 7.9a2.8 2.8 0 0 0-4-4L3.8 15.2 3 19.9Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
    </svg>
  );
}

function EmptyRow({ columns }: { columns: number }) {
  return (
    <tr>
      <td className="empty-cell" colSpan={columns}>
        No records match this view.
      </td>
    </tr>
  );
}

function DeliveriesPage({
  data,
  query,
  onEdit,
  onDelete,
  onExport,
}: {
  data: Delivery[];
  query: string;
  onEdit: (record: Delivery) => void;
  onDelete: (items: DeleteItem[], context: string) => void;
  onExport: (data: Delivery[]) => void;
}) {
  const filter = useDateFilter(data, query);
  const rows = [...filter.filtered].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
  );
  const selection = useSelection(rows.map((item) => String(item.id)));
  const selectedItems = rows
    .filter((item) => selection.selected.has(String(item.id)))
    .map((item) => ({ type: "delivery" as const, id: item.id }));
  return (
    <article className="panel table-panel">
      <PageToolbar
        title="Delivery history"
        count={rows.length}
        selectedCount={selectedItems.length}
        onExport={() => onExport(rows)}
        onDelete={() =>
          onDelete(
            selectedItems,
            "The selected deliveries and their ledger entries will be removed.",
          )
        }
      />
      <DateFilter {...filter} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-cell">
                <SelectAll
                  checked={selection.allSelected}
                  onChange={selection.toggleAll}
                  label="Select all deliveries"
                />
              </th>
              <th>Date</th>
              <th>Quantity</th>
              <th>Unit price</th>
              <th>Total bill</th>
              <th>Notes</th>
              <th className="action-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item) => (
                <tr key={item.id}>
                  <td className="check-cell">
                    <SelectAll
                      checked={selection.selected.has(String(item.id))}
                      onChange={() => selection.toggle(String(item.id))}
                      label={`Select delivery on ${item.date}`}
                    />
                  </td>
                  <td data-label="Date">{formatDate(item.date)}</td>
                  <td data-label="Quantity">{item.qty} bottles</td>
                  <td data-label="Unit price">{money(item.price)}</td>
                  <td data-label="Total bill">
                    <b>{money(item.qty * item.price)}</b>
                  </td>
                  <td data-label="Notes" className="notes-cell">
                    {item.notes || "—"}
                  </td>
                  <td className="action-cell">
                    <div className="row-actions">
                      <RowActionButton
                        action="edit"
                        label={`Edit delivery on ${formatDate(item.date)}`}
                        onClick={() => onEdit(item)}
                      />
                      <RowActionButton
                        action="delete"
                        label={`Delete delivery on ${formatDate(item.date)}`}
                        onClick={() =>
                          onDelete(
                            [{ type: "delivery", id: item.id }],
                            "This delivery and its ledger entry will be removed.",
                          )
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow columns={7} />
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PaymentsPage({
  data,
  query,
  onEdit,
  onDelete,
  onExport,
}: {
  data: Payment[];
  query: string;
  onEdit: (record: Payment) => void;
  onDelete: (items: DeleteItem[], context: string) => void;
  onExport: (data: Payment[]) => void;
}) {
  const filter = useDateFilter(data, query);
  const rows = [...filter.filtered].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
  );
  const selection = useSelection(rows.map((item) => String(item.id)));
  const selectedItems = rows
    .filter((item) => selection.selected.has(String(item.id)))
    .map((item) => ({ type: "payment" as const, id: item.id }));
  return (
    <article className="panel table-panel">
      <PageToolbar
        title="Payment history"
        count={rows.length}
        selectedCount={selectedItems.length}
        onExport={() => onExport(rows)}
        onDelete={() =>
          onDelete(
            selectedItems,
            "The selected payments and their ledger entries will be removed.",
          )
        }
      />
      <DateFilter {...filter} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-cell">
                <SelectAll
                  checked={selection.allSelected}
                  onChange={selection.toggleAll}
                  label="Select all payments"
                />
              </th>
              <th>Date</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Notes</th>
              <th className="action-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item) => (
                <tr key={item.id}>
                  <td className="check-cell">
                    <SelectAll
                      checked={selection.selected.has(String(item.id))}
                      onChange={() => selection.toggle(String(item.id))}
                      label={`Select payment on ${item.date}`}
                    />
                  </td>
                  <td data-label="Date">{formatDate(item.date)}</td>
                  <td data-label="Amount" className="positive">
                    <b>{money(item.amount)}</b>
                  </td>
                  <td data-label="Method">{item.method}</td>
                  <td data-label="Notes" className="notes-cell">
                    {item.notes || "—"}
                  </td>
                  <td className="action-cell">
                    <div className="row-actions">
                      <RowActionButton
                        action="edit"
                        label={`Edit payment on ${formatDate(item.date)}`}
                        onClick={() => onEdit(item)}
                      />
                      <RowActionButton
                        action="delete"
                        label={`Delete payment on ${formatDate(item.date)}`}
                        onClick={() =>
                          onDelete(
                            [{ type: "payment", id: item.id }],
                            "This payment and its ledger entry will be removed.",
                          )
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow columns={6} />
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PricingPage({
  data,
  query,
  onEdit,
  onDelete,
  onExport,
}: {
  data: BottlePrice[];
  query: string;
  onEdit: (record: BottlePrice) => void;
  onDelete: (items: DeleteItem[], context: string) => void;
  onExport: (data: BottlePrice[]) => void;
}) {
  const filter = useDateFilter(data, query);
  const rows = [...filter.filtered].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
  );
  const selection = useSelection(rows.map((item) => String(item.id)));
  const selectedItems = rows
    .filter((item) => selection.selected.has(String(item.id)))
    .map((item) => ({ type: "price" as const, id: item.id }));
  return (
    <article className="panel table-panel">
      <PageToolbar
        title="Bottle price history"
        count={rows.length}
        selectedCount={selectedItems.length}
        onExport={() => onExport(rows)}
        onDelete={() =>
          onDelete(
            selectedItems,
            "The selected price history records will be removed.",
          )
        }
      />
      <DateFilter {...filter} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-cell">
                <SelectAll
                  checked={selection.allSelected}
                  onChange={selection.toggleAll}
                  label="Select all prices"
                />
              </th>
              <th>Effective date</th>
              <th>Price per bottle</th>
              <th>Status</th>
              <th>Notes</th>
              <th className="action-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item) => (
                <tr key={item.id}>
                  <td className="check-cell">
                    <SelectAll
                      checked={selection.selected.has(String(item.id))}
                      onChange={() => selection.toggle(String(item.id))}
                      label={`Select price effective ${item.date}`}
                    />
                  </td>
                  <td data-label="Effective date">{formatDate(item.date)}</td>
                  <td data-label="Price per bottle">
                    <b>{money(item.price)}</b>
                  </td>
                  <td data-label="Status">
                    {item.id === effectivePrice(data, localDay())?.id ? (
                      <span className="status active-status">Active</span>
                    ) : (
                      <span className="status">
                        {item.date > localDay() ? "Scheduled" : "Historical"}
                      </span>
                    )}
                  </td>
                  <td data-label="Notes" className="notes-cell">
                    {item.notes || "—"}
                  </td>
                  <td className="action-cell">
                    <div className="row-actions">
                      <RowActionButton
                        action="edit"
                        label={`Edit price effective ${formatDate(item.date)}`}
                        onClick={() => onEdit(item)}
                      />
                      <RowActionButton
                        action="delete"
                        label={`Delete price effective ${formatDate(item.date)}`}
                        onClick={() =>
                          onDelete(
                            [{ type: "price", id: item.id }],
                            "This price history record will be removed.",
                          )
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow columns={6} />
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function LedgerPage({
  data,
  query,
  onEdit,
  onDelete,
  onExport,
}: {
  data: LedgerRow[];
  query: string;
  onEdit: (type: "delivery" | "payment", id: number) => void;
  onDelete: (items: DeleteItem[], context: string) => void;
  onExport: (data: LedgerRow[]) => void;
}) {
  const filter = useDateFilter(data, query);
  const rows = [...filter.filtered].reverse();
  const selection = useSelection(rows.map((item) => item.id));
  const selectedItems = rows
    .filter((item) => selection.selected.has(item.id))
    .map((item) => ({ type: item.entityType, id: item.entityId }));
  return (
    <article className="panel table-panel">
      <PageToolbar
        title="Account ledger"
        count={rows.length}
        selectedCount={selectedItems.length}
        onExport={() => onExport(rows)}
        onDelete={() =>
          onDelete(
            selectedItems,
            "The source deliveries or payments behind these ledger entries will also be removed.",
          )
        }
      />
      <DateFilter {...filter} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-cell">
                <SelectAll
                  checked={selection.allSelected}
                  onChange={selection.toggleAll}
                  label="Select all ledger entries"
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Running balance</th>
              <th className="action-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item) => (
                <tr key={item.id}>
                  <td className="check-cell">
                    <SelectAll
                      checked={selection.selected.has(item.id)}
                      onChange={() => selection.toggle(item.id)}
                      label={`Select ${item.description}`}
                    />
                  </td>
                  <td data-label="Date">{formatDate(item.date)}</td>
                  <td data-label="Description">
                    {item.description}
                    <small className="note">{item.notes}</small>
                  </td>
                  <td data-label="Debit">
                    {item.debit ? money(item.debit) : "—"}
                  </td>
                  <td data-label="Credit" className="positive">
                    {item.credit ? money(item.credit) : "—"}
                  </td>
                  <td data-label="Running balance">
                    <span
                      className={
                        item.balance < 0 ? "status owing" : "status crediting"
                      }
                    >
                      {item.balance < 0 ? "Owing" : "Credit"}{" "}
                      {money(item.balance)}
                    </span>
                  </td>
                  <td className="action-cell">
                    <div className="row-actions">
                      <RowActionButton
                        action="edit"
                        label={`Edit ${item.description}`}
                        onClick={() => onEdit(item.entityType, item.entityId)}
                      />
                      <RowActionButton
                        action="delete"
                        label={`Delete ${item.description}`}
                        onClick={() =>
                          onDelete(
                            [{ type: item.entityType, id: item.entityId }],
                            "The source record and its ledger entry will be removed.",
                          )
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow columns={7} />
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span />
      <span />
      <span />
      <p>Loading your records…</p>
    </div>
  );
}

function useModalKeyboard(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const container = ref.current;
    if (!container) return;
    const items = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea,select",
        ),
      );
    items()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key !== "Tab") return;
      const elements = items(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    container.addEventListener("keydown", keydown);
    return () => {
      container.removeEventListener("keydown", keydown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [close]);
  return ref;
}
function EntryDialog({
  type,
  record,
  prices,
  busy,
  close,
  save,
}: {
  type: EntryType;
  record: EditableRecord | null;
  prices: BottlePrice[];
  busy: boolean;
  close: () => void;
  save: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useModalKeyboard(close);
  const isEditing = Boolean(record);
  const delivery = record && "qty" in record ? record : null;
  const payment = record && "amount" in record ? record : null;
  const [date, setDate] = useState(record?.date || localDay());
  const price = effectivePrice(prices, date)?.price || 0;
  const recordPrice = record && "price" in record ? record.price : undefined;
  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      ref={dialogRef}
      role="presentation"
    >
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={save}
        aria-labelledby="entry-dialog-title"
      >
        <div className="dialog-head">
          <div>
            <small>{isEditing ? "EDIT RECORD" : "NEW RECORD"}</small>
            <h2 id="entry-dialog-title">
              {isEditing ? "Edit" : "Add"} {type}
            </h2>
          </div>
          <button type="button" aria-label="Close dialog" onClick={close}>
            ×
          </button>
        </div>
        <label>
          Date
          <input
            required
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={type === "price" ? undefined : localDay()}
          />
        </label>
        {type === "delivery" ? (
          <div className="form-grid">
            <label>
              Bottle quantity
              <input
                required
                min="1"
                max="10000"
                name="qty"
                type="number"
                defaultValue={delivery?.qty}
              />
            </label>
            <label>
              Price per bottle
              <input
                required
                min="0.01"
                max="9999999"
                step="0.01"
                name="price"
                key={date}
                type="number"
                defaultValue={(recordPrice ?? price) || undefined}
              />
            </label>
          </div>
        ) : null}
        {type === "payment" ? (
          <div className="form-grid">
            <label>
              Amount paid
              <input
                required
                min="0.01"
                max="9999999"
                step="0.01"
                name="amount"
                type="number"
                defaultValue={payment?.amount}
              />
            </label>
            <label>
              Method
              <select name="method" defaultValue={payment?.method ?? "Cash"}>
                <option>Cash</option>
                <option>Easypaisa</option>
                <option>JazzCash</option>
                <option>Bank Transfer</option>
              </select>
            </label>
          </div>
        ) : null}
        {type === "price" ? (
          <label>
            Bottle price
            <input
              required
              min="0.01"
              max="9999999"
              step="0.01"
              name="price"
              type="number"
              defaultValue={recordPrice}
            />
          </label>
        ) : null}
        <label>
          Notes <span>(optional)</span>
          <textarea
            maxLength={500}
            name="notes"
            placeholder="Add a short note"
            defaultValue={record?.notes}
          />
        </label>
        <section className="dialog-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button disabled={busy} className="primary">
            {busy ? "Saving…" : isEditing ? "Update record" : "Save record"}
          </button>
        </section>
      </form>
    </div>
  );
}

function ConfirmDialog({
  request,
  deleting,
  cancel,
  confirm,
}: {
  request: DeleteRequest;
  deleting: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  const dialogRef = useModalKeyboard(cancel);
  return (
    <div
      className="backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      ref={dialogRef}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className="warning-icon">!</div>
        <h2 id="confirm-title">{request.title}</h2>
        <p id="confirm-message">{request.message}</p>
        <section>
          <button className="secondary" disabled={deleting} onClick={cancel}>
            No, keep it
          </button>
          <button
            className="danger solid"
            disabled={deleting}
            onClick={confirm}
          >
            {deleting ? "Deleting…" : "Yes, delete"}
          </button>
        </section>
      </div>
    </div>
  );
}
