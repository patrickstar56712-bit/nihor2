/* Shared by the API routes (a leading "_" keeps Vercel from serving this file as a route). */
import { createClient } from "@libsql/client/web";
import { createHash, timingSafeEqual } from "node:crypto";

let db;
export const client = () => db ??= createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

/* settings missing in Vercel, named so the Control Panel can show them */
export const missing = () => ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"].filter(k => !process.env[k]);

export function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD, got = req.headers["x-admin-key"];
  if (!want || typeof got !== "string" || !got) return false;
  const h = s => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(want));
}
