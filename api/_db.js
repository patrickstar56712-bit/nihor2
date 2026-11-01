/* Shared by the API routes (a leading "_" keeps Vercel from serving this file as a route). */
import { createClient } from "@libsql/client/web";
import { createHash, timingSafeEqual } from "node:crypto";

let db;
export const client = () => db ??= createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

/* settings missing in Vercel, named so the Control Panel can show them */
export const missing = () => ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"].filter(k => !process.env[k]);

export const hash = s => createHash("sha256").update(s).digest("hex");

/* the admin password, compared in constant time (only api/admin.js checks it, at login) */
export function samePw(got) {
  const want = process.env.ADMIN_PASSWORD;
  if (!want || typeof got !== "string" || !got) return false;
  const h = s => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(want));
}

/* the admin cookie set at login (api/admin.js): a browser that logged in once stays trusted */
export const token = req => (/(?:^|;\s*)nh_adm=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || "") || [])[1] || "";
let auth;
export const setupAuth = () => auth ??= client().batch([
  "CREATE TABLE IF NOT EXISTS admin_sessions (h TEXT PRIMARY KEY, ua TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS admin_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0)"
], "write").catch(e => { auth = null; throw e });

export async function isAdmin(req) {
  const t = token(req);
  if (!t) return false;
  await setupAuth();
  return (await client().execute({ sql: "SELECT 1 FROM admin_sessions WHERE h = ?", args: [hash(t)] })).rows.length > 0;
}
