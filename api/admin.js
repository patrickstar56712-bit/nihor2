/* Control Panel sign-in, and its pages (see schema.sql: admin_sessions, admin_fails).
   POST /api/admin {login: password} -> sets the admin cookie: a random token, HttpOnly, kept for a year; only its hash is stored.
                                        5 wrong passwords from one address lock it for 15 minutes.
   POST /api/admin {logout: true}     -> this browser's cookie ends
   POST /api/admin {logoutAll: true}  -> (admin) every browser's cookie ends
   GET  /api/admin                    -> {html, js}: the Control Panel (api/_panel/), only with a valid admin cookie */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { client, isAdmin, missing, samePw, setupAuth, token, hash } from "./_db.js";

const TRIES = 5, LOCK = 15 * 60, AGE = 365 * 86400;
const cookie = (v, age) => `nh_adm=${v}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
let panel;
const pages = () => panel ??= {
  html: readFileSync(new URL("./_panel/panel.html", import.meta.url), "utf8"),
  js: readFileSync(new URL("./_panel/panel.js", import.meta.url), "utf8")
};
const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";

async function login(req, res, pw) {
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "Missing in Vercel Environment Variables: ADMIN_PASSWORD" });
  const ip = ipOf(req).slice(0, 64), now = Math.floor(Date.now() / 1000);
  const f = (await client().execute({ sql: "SELECT n, until FROM admin_fails WHERE ip = ?", args: [ip] })).rows[0];
  if (f && Number(f.until) > now) return res.status(429).json({ error: `Too many wrong passwords · try again in ${Math.ceil((Number(f.until) - now) / 60)} min` });
  if (!samePw(pw)) {
    const n = (f ? Number(f.n) : 0) + 1, lock = n >= TRIES;
    await client().execute({ sql: "INSERT INTO admin_fails (ip, n, until) VALUES (?, ?, ?) ON CONFLICT (ip) DO UPDATE SET n = excluded.n, until = excluded.until",
      args: [ip, lock ? 0 : n, lock ? now + LOCK : 0] });
    return res.status(401).json({ error: lock ? "Wrong password · locked for 15 minutes" : "Wrong password" });
  }
  const t = randomBytes(32).toString("hex");
  await client().batch([
    { sql: "DELETE FROM admin_fails WHERE ip = ?", args: [ip] },
    { sql: "INSERT INTO admin_sessions (h, ua) VALUES (?, ?)", args: [hash(t), String(req.headers["user-agent"] || "").slice(0, 200)] }
  ], "write");
  res.setHeader("Set-Cookie", cookie(t, AGE));
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const miss = missing();
  if (miss.length) return res.status(500).json({ error: "Missing in Vercel Environment Variables: " + miss.join(", ") });
  try {
    await setupAuth();
    if (req.method === "GET") {
      if (!await isAdmin(req)) return res.status(401).json({ error: "Not logged in" });
      return res.status(200).json(pages());
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (typeof b.login === "string") return await login(req, res, b.login);
    if (b.logoutAll) {
      if (!await isAdmin(req)) return res.status(401).json({ error: "Not logged in" });
      await client().execute("DELETE FROM admin_sessions");
    } else if (b.logout) {
      const t = token(req);
      if (t) await client().execute({ sql: "DELETE FROM admin_sessions WHERE h = ?", args: [hash(t)] });
    } else return res.status(400).json({ error: "Nothing to do" });
    res.setHeader("Set-Cookie", cookie("", 0));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
