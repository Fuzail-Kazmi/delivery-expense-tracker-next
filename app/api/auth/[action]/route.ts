import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  account,
  allowAttempt,
  hashPassword,
  issue,
  logout,
  matches,
} from "@/lib/auth";
import { digest } from "@/lib/store";
import { query, transaction } from "@/lib/database";

const fail = (error: string, status = 400) =>
  Response.json({ error }, { status });
const emailField = z.string().trim().toLowerCase().email().max(254);
const passwordField = z.string().min(8).max(128);
const mailReady = () =>
  Boolean(
    process.env.RESEND_API_KEY &&
    process.env.MAIL_FROM &&
    process.env.APP_ORIGIN,
  );
export async function POST(
  req: Request,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    return fail("Use a JSON request.", 415);
  try {
    const body = await req.json();
    if (action === "logout") {
      await logout();
      return Response.json({ ok: true });
    }
    if (action === "recovery") {
      const user = await account();
      if (!user) return fail("Please sign in.", 401);
      const stored = (
        await query("SELECT password FROM tracker.users WHERE id=$1", [user.id])
      ).rows[0];
      if (
        !(await allowAttempt("recovery:" + user.id, 12)) ||
        !(await matches(
          z.string().max(128).parse(body.password),
          String(stored.password),
        ))
      )
        return fail("Check your current password.", 403);
      const recovery = randomBytes(20).toString("hex");
      await query("UPDATE tracker.users SET recovery=$1 WHERE id=$2", [
        digest(recovery),
        user.id,
      ]);
      return Response.json({ recovery });
    }
    const email = emailField.parse(body.email);
    if (
      !(await allowAttempt(action + ":" + email, action === "forgot" ? 4 : 20))
    )
      return fail("Too many requests. Try again in 15 minutes.", 429);
    const user = (
      await query(
        "SELECT id,password,recovery FROM tracker.users WHERE email=$1",
        [email],
      )
    ).rows[0];
    const secure =
      new URL(process.env.APP_ORIGIN || req.url).protocol === "https:";
    if (action === "signup") {
      if (email === "admin@sfk.com")
        return fail("This email is reserved for the administrator.", 409);
      const hash = await hashPassword(passwordField.parse(body.password));
      const recovery = randomBytes(20).toString("hex");
      const result = await query(
        "INSERT INTO tracker.users(email,password,recovery) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id",
        [email, hash, digest(recovery)],
      );
      if (!result.rowCount)
        return fail("This email is already registered.", 409);
      await issue(result.rows[0].id, secure);
      return Response.json({ recovery }, { status: 201 });
    }
    if (action === "signin") {
      const pass = z.string().min(1).max(128).parse(body.password);
      if (!user || !(await matches(pass, String(user.password))))
        return fail("Check your email and password.", 401);
      await issue(Number(user.id), secure);
      return Response.json({ ok: true });
    }
    if (action === "forgot") {
      if (!mailReady())
        return fail(
          "Email delivery is unavailable. Use your saved recovery key below.",
          503,
        );
      if (user) {
        const code = randomBytes(32).toString("hex");
        const link = new URL("/signin", process.env.APP_ORIGIN);
        link.hash = new URLSearchParams({ reset: code, email }).toString();
        await query("INSERT INTO tracker.resets VALUES($1,$2,$3)", [
          digest(code),
          user.id,
          Date.now() + 1200000,
        ]);
        const sent = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.RESEND_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.MAIL_FROM,
            to: [email],
            subject: "Reset your WaterTracker password",
            text:
              "Open this link within 20 minutes to set a new password.\n\n" +
              link.href,
          }),
        });
        if (!sent.ok) {
          await query("DELETE FROM tracker.resets WHERE code=$1", [
            digest(code),
          ]);
          return fail(
            "Email delivery is unavailable. Use your recovery key or try later.",
            503,
          );
        }
      }
      return Response.json({ ok: true });
    }
    if (action === "reset") {
      const code = digest(z.string().min(20).max(256).parse(body.code));
      const hash = await hashPassword(passwordField.parse(body.password));
      const recovery = randomBytes(20).toString("hex");
      const ok = await transaction(async (client) => {
        if (!user) return false;
        const row = (
          await query(
            "SELECT recovery FROM tracker.users WHERE id=$1 FOR UPDATE",
            [user.id],
            client,
          )
        ).rows[0];
        if (
          row.recovery !== code &&
          !(
            await query(
              "SELECT owner FROM tracker.resets WHERE owner=$1 AND code=$2 AND expires>$3",
              [user.id, code, Date.now()],
              client,
            )
          ).rowCount
        )
          return false;
        await query(
          "UPDATE tracker.users SET password=$1,recovery=$2 WHERE id=$3",
          [hash, digest(recovery), user.id],
          client,
        );
        await query(
          "DELETE FROM tracker.resets WHERE owner=$1",
          [user.id],
          client,
        );
        await query(
          "DELETE FROM tracker.sessions WHERE owner=$1",
          [user.id],
          client,
        );
        return true;
      });
      if (!ok)
        return fail(
          "The reset link or recovery key is invalid or has expired.",
        );
      return Response.json({ recovery });
    }
    return fail("Unknown action.", 404);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return fail(
        "Check the email and fields. New passwords need 8 to 128 characters.",
      );
    return fail("The account request could not be completed.", 500);
  }
}
