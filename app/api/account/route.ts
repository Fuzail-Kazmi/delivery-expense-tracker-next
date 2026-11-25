import { z } from "zod";
import {
  account,
  allowAttempt,
  matches,
  hashPassword,
  sessionId,
} from "@/lib/auth";
import { query, transaction } from "@/lib/database";
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(128);
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_][a-z0-9_.-]{2,31}$/),
    email,
    password,
  }),
  z.object({
    action: z.literal("email"),
    email,
    current: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("password"),
    password,
    current: z.string().min(1).max(128),
  }),
]);
const fail = (error: string, status: number) =>
  Response.json({ error }, { status });
export async function GET() {
  const u = await account();
  if (!u?.admin) return fail("Administrator access required.", 403);
  return Response.json({
    users: (await query("SELECT username,email FROM tracker.users ORDER BY id"))
      .rows,
  });
}
export async function POST(req: Request) {
  const u = await account();
  if (!u || String(u.id) !== req.headers.get("X-Ledger-Owner"))
    return fail("Sign in again.", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail(
      "Check your entries. Usernames need 3 to 32 letters, digits, dots, underscores or hyphens. Passwords need 8 to 128 characters.",
      400,
    );
  const d = parsed.data;
  try {
    if (d.action === "create") {
      if (!u.admin) return fail("Administrator access required.", 403);
      await query(
        "INSERT INTO tracker.users(username,email,password) VALUES($1,$2,$3)",
        [d.username, d.email, await hashPassword(d.password)],
      );
      return Response.json({ ok: true }, { status: 201 });
    }
    if (!(await allowAttempt("account:" + u.id, 12)))
      return fail("Try again in 15 minutes.", 429);
    const session = await sessionId();
    return await transaction(async (c) => {
      const stored = (
        await query(
          "SELECT password FROM tracker.users WHERE id=$1 FOR UPDATE",
          [u.id],
          c,
        )
      ).rows[0];
      if (!(await matches(d.current, stored.password)))
        return fail("Current password is incorrect.", 403);
      if (d.action === "email")
        await query(
          "UPDATE tracker.users SET email=$1 WHERE id=$2",
          [d.email, u.id],
          c,
        );
      else
        await query(
          "UPDATE tracker.users SET password=$1 WHERE id=$2",
          [await hashPassword(d.password), u.id],
          c,
        );
      await query("DELETE FROM tracker.resets WHERE owner=$1", [u.id], c);
      await query(
        "DELETE FROM tracker.sessions WHERE owner=$1 AND id<>$2",
        [u.id, session],
        c,
      );
      return Response.json({ ok: true });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      return fail("Email or username already in use.", 409);
    throw e;
  }
}
