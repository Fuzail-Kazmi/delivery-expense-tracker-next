import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { execFileSync, spawn } from "node:child_process";
import { ledger, statement } from "../lib/ledger.ts";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";

test("authenticated ledger, threshold alerts, theme, isolation and recovery", async (t) => {
  const schema = "delivery_expense_test_" + randomUUID().replaceAll("-", "");
  const env = { ...process.env, TRACKER_SCHEMA: schema, ADMIN_PASSWORD: "123" };
  execFileSync(process.execPath, ["scripts/migrate.mjs"], {
    env,
    stdio: "inherit",
  });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  t.after(async () => {
    await pool.query("DROP SCHEMA " + schema + " CASCADE");
    await pool.end();
  });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      stdio: "ignore",
      env: {
        ...env,
        ADMIN_PASSWORD: "123",
        APP_ORIGIN: "http://127.0.0.1:" + port,
        RESEND_API_KEY: "",
      },
    },
  );
  t.after(async () => {
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
    }
  });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/signin")).ok) break;
    } catch {
      /* The server may still be starting. */
    }
    await pause(150);
  }
  const call = (path, body, cookie = "", method = body ? "POST" : "GET") =>
    fetch(base + path, {
      method,
      headers: { cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  const session = (r) => r.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
  assert.equal((await call("/api/data")).status, 401);
  const a = await call("/api/auth/signin", {
    email: "admin@sfk.com",
    password: "123",
  });
  assert.equal(a.status, 200);
  const admin = session(a);
  assert.equal(
    (
      await call(
        "/api/preferences",
        { action: "threshold", amount: 1200 },
        admin,
      )
    ).status,
    200,
  );
  const delivery = await (
    await call(
      "/api/data",
      { type: "delivery", date: "2026-01-31", qty: 10, price: 150 },
      admin,
    )
  ).json();
  assert.equal(delivery.alerts[0].amount, 1500);
  assert.ok(delivery.alerts[0].date);
  await call(
    "/api/data",
    { type: "payment", date: "2026-02-01", amount: 1000, method: "Cash" },
    admin,
  );
  const data = await (await call("/api/data", null, admin)).json();
  assert.equal(
    data.deliveries[0].qty * data.deliveries[0].price - data.payments[0].amount,
    500,
  );
  assert.deepEqual(
    statement(ledger(data.deliveries, data.payments)).outstanding,
    { whole: 3, partialDue: 50, count: 4 },
  );
  assert.ok(
    (await (await call("/api/preferences", null, admin)).json()).publicKey,
  );
  assert.equal(
    (await call("/api/preferences", { action: "theme", theme: "dark" }, admin))
      .status,
    200,
  );
  assert.match(
    await (await call("/dashboard", null, admin)).text(),
    /class="app dark"/,
  );
  const ownerHeaders = {
    "Content-Type": "application/json",
    cookie: admin,
    "Idempotency-Key": randomUUID(),
    "X-Ledger-Owner": String(data.user.id),
  };
  const replay = () =>
    fetch(base + "/api/data", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ type: "price", date: "2026-02-01", price: 151 }),
    });
  const copies = await Promise.all([replay(), replay()]);
  const ids = await Promise.all(
    copies.map(async (res) => (await res.json()).record.id),
  );
  assert.equal(ids[0], ids[1]);
  assert.equal(
    (await (await call("/api/data", null, admin)).json()).prices.length,
    1,
  );
  await call(
    "/api/data",
    { items: [{ type: "price", id: ids[0] }] },
    admin,
    "DELETE",
  );
  await replay();
  assert.equal(
    (await (await call("/api/data", null, admin)).json()).prices.length,
    0,
  );
  assert.equal(
    (
      await fetch(base + "/api/data", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "X-Ledger-Owner": String(data.user.id + 1),
        },
        body: JSON.stringify({ type: "price", date: "2026-02-01", price: 22 }),
      })
    ).status,
    403,
  );
  const credentials = { email: "test@example.com", password: "test-password" };
  const signup = await call("/api/auth/signup", credentials);
  assert.equal(signup.status, 201);
  const other = session(signup);
  const { recovery } = await signup.json();
  assert.equal(
    (await (await call("/api/data", null, other)).json()).deliveries.length,
    0,
  );
  assert.equal(
    (
      await call(
        "/api/data",
        {
          type: "delivery",
          date: "2026-01-31",
          qty: 1,
          price: 1,
          id: delivery.record.id,
        },
        other,
        "PUT",
      )
    ).status,
    404,
  );
  const reset = {
    email: credentials.email,
    password: "replacement-password",
    code: recovery,
  };
  assert.equal((await call("/api/auth/reset", reset)).status, 200);
  assert.equal((await call("/api/auth/reset", reset)).status, 400);
  assert.equal((await call("/api/data", null, other)).status, 401);
  assert.equal((await call("/api/auth/signin", credentials)).status, 401);
  assert.equal((await call("/api/auth/signin", reset)).status, 200);

  // Seed a large history in the disposable schema, then exercise the same HTTP
  // mutations, filtered statements, and multi-select deletion the UI uses.
  const owner = (
    await pool.query("SELECT id FROM " + schema + ".users WHERE email=$1", [
      "admin@sfk.com",
    ])
  ).rows[0].id;
  await pool.query(
    "INSERT INTO " +
      schema +
      ".entries(owner,type,date,cents,qty) SELECT $1,'delivery',date '2026-03-01'+(n%28),10000,2 FROM generate_series(1,1000) n",
    [owner],
  );
  await pool.query(
    "INSERT INTO " +
      schema +
      ".entries(owner,type,date,cents,method) SELECT $1,'payment','2026-04-01',10000,'Cash' FROM generate_series(1,500)",
    [owner],
  );
  const pay = {
    type: "payment",
    date: "2026-05-01",
    amount: 50,
    method: "Cash",
  };
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () => call("/api/data", pay, admin)),
  );
  assert.ok(concurrent.every((r) => r.status === 201));
  const read = async () => {
    const r = await (await call("/api/data", null, admin)).json();
    return ledger(r.deliveries, r.payments);
  };
  const all = await read();
  assert.equal(all.length, 1510);
  assert.equal(statement(all).closing, 150100);
  const range = statement(all, "2026-05-01", "2026-05-01");
  assert.equal(range.opening, 150500);
  assert.equal(range.paid, 400);
  assert.equal(range.bottles, 0);
  assert.equal(range.outstanding.count, 1501);
  assert.equal(range.latest.date, "2026-05-01");
  const price = await (
    await call(
      "/api/data",
      { type: "price", date: "2026-05-01", price: 225 },
      admin,
    )
  ).json();
  assert.equal(
    (await call("/api/data", { ...price.record, price: 230 }, admin, "PUT"))
      .status,
    200,
  );
  const last = range.latest;
  assert.equal(
    (
      await call(
        "/api/data",
        { ...pay, id: last.entityId, amount: 150 },
        admin,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(statement(await read()).closing, 150000);
  const removed = all
    .filter((r) => r.date === "2026-04-01")
    .map((r) => ({ id: r.entityId, type: r.entityType }));
  assert.equal(
    (await call("/api/data", { items: removed }, admin, "DELETE")).status,
    200,
  );
  assert.equal(statement(await read()).closing, 200000);
  const over = await call("/api/data", { ...pay, amount: 200050 }, admin);
  assert.equal(over.status, 201);
  const credit = statement(await read());
  assert.equal(credit.closing, -50);
  assert.equal(credit.outstanding.count, 0);
  assert.equal(
    (await call("/api/data", { ...pay, amount: -1 }, admin)).status,
    400,
  );
  assert.equal((await call("/api/auth/logout", {}, admin)).status, 200);
  assert.equal((await call("/api/data", null, admin)).status, 401);
});
