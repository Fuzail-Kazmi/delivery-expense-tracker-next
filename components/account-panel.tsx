"use client";
import { useState, useEffect } from "react";
export function AccountPanel({
  users,
  online,
  owner,
}: {
  users: boolean;
  online: boolean;
  owner: number;
}) {
  const [list, setList] = useState<
      { email: string; username: string | null }[]
    >([]),
    [msg, message] = useState(""),
    [busy, working] = useState(false);
  useEffect(() => {
    if (users && online)
      fetch("/api/account")
        .then(async (r) => {
          if (!r.ok) throw Error();
          setList((await r.json()).users);
        })
        .catch(() => message("Could not load users."));
  }, [users, online]);
  async function submit(e: React.FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    const form = e.currentTarget;
    working(true);
    try {
      const data = Object.fromEntries(new FormData(form));
      const r = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ledger-Owner": String(owner),
        },
        body: JSON.stringify({ ...data, action }),
      });
      const res = await r.json();
      if (!r.ok) throw Error(res.error);
      form.reset();
      message(action === "create" ? "User created." : "Account updated.");
      if (users) setList((await (await fetch("/api/account")).json()).users);
      else if (action === "email") location.assign("/settings");
    } catch (err) {
      message((err as Error).message);
    } finally {
      working(false);
    }
  }
  return (
    <div className="preferences">
      <section className="panel">
        <h2>{users ? "Users" : "Account security"}</h2>
        {!online ? (
          <p>Reconnect to manage accounts.</p>
        ) : (
          <>
            {(users ? ["create"] : ["email", "password"]).map((action) => (
              <form
                className="fields"
                key={action}
                onSubmit={(e) => submit(e, action)}
              >
                {users ? (
                  <label>
                    Username
                    <input
                      name="username"
                      required
                      pattern="[A-Za-z0-9_][A-Za-z0-9_.\-]{2,31}"
                    />
                  </label>
                ) : (
                  <label>
                    Current password
                    <input
                      type="password"
                      name="current"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                )}
                {action !== "password" && (
                  <label>
                    {users ? "Email address" : "New email address"}
                    <input type="email" name="email" required />
                  </label>
                )}
                {action !== "email" && (
                  <label>
                    New password
                    <input
                      type="password"
                      name="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                    />
                  </label>
                )}
                <button className="primary" disabled={busy}>
                  {users
                    ? "Create user"
                    : action === "email"
                      ? "Change email"
                      : "Change password"}
                </button>
              </form>
            ))}
            {users &&
              list.map((u) => (
                <p key={u.email}>
                  {u.username ? u.username + " | " : ""}
                  {u.email}
                </p>
              ))}
          </>
        )}
        <p role="status">{msg}</p>
      </section>
    </div>
  );
}
