import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query } from "./database";
const derive = promisify(scrypt),
  lifetime = 7 * 86400,
  cookieName = "water_session";
export type Account = {
  id: number;
  email: string;
  theme: "light" | "dark";
  threshold: number;
};
let secret: Uint8Array | undefined;
async function key() {
  if (!secret)
    secret = new TextEncoder().encode(
      (await query("SELECT value FROM tracker.config WHERE key='jwt'")).rows[0]
        .value,
    );
  return secret;
}
export async function hashPassword(pass: string) {
  const salt = randomBytes(16).toString("hex");
  return (
    salt + "." + ((await derive(pass, salt, 64)) as Buffer).toString("hex")
  );
}
export async function matches(pass: string, stored: string) {
  const [salt, hex] = stored.split(".");
  return timingSafeEqual(
    (await derive(pass, salt, 64)) as Buffer,
    Buffer.from(hex, "hex"),
  );
}
export async function issue(owner: number, secure: boolean) {
  const id = randomBytes(24).toString("hex"),
    now = Math.floor(Date.now() / 1000),
    expires = now + lifetime;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(owner))
    .setJti(id)
    .setIssuer("water-tracker")
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(await key());
  await query("DELETE FROM tracker.sessions WHERE expires<=$1", [now]);
  await query("INSERT INTO tracker.sessions VALUES($1,$2,$3)", [
    id,
    owner,
    expires,
  ]);
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: lifetime,
  });
}
async function claims() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    return (
      await jwtVerify(token, await key(), {
        algorithms: ["HS256"],
        issuer: "water-tracker",
      })
    ).payload;
  } catch {
    return null;
  }
}
export async function account(): Promise<Account | null> {
  const c = await claims();
  if (!c?.jti || !c.sub) return null;
  return (
    (
      await query<Account>(
        "SELECT u.id,u.email,u.theme,u.threshold::float8 FROM tracker.users u JOIN tracker.sessions s ON s.owner=u.id WHERE s.id=$1 AND u.id=$2 AND s.expires>$3",
        [c.jti, Number(c.sub), Math.floor(Date.now() / 1000)],
      )
    ).rows[0] ?? null
  );
}
export async function logout() {
  const c = await claims();
  if (c?.jti) await query("DELETE FROM tracker.sessions WHERE id=$1", [c.jti]);
  (await cookies()).delete(cookieName);
}
export async function allowAttempt(key: string, limit: number) {
  const now = Date.now();
  const r = await query(
    "INSERT INTO tracker.attempts AS a VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN a.until_ms<=$3 THEN 1 ELSE a.count+1 END,until_ms=CASE WHEN a.until_ms<=$3 THEN excluded.until_ms ELSE a.until_ms END RETURNING count",
    [key, now + 900000, now],
  );
  return r.rows[0].count <= limit;
}
export async function sessionId() {
  return (await claims())?.jti;
}
