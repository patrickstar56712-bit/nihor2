/* Loot Tracker logs kept for the admins (see schema.sql: loot_logs). Only the "You receive" lines, gzip + base64.
   POST /api/logs {name, n, from, to, vid, data} -> anyone: one upload (the newest MAX are kept)
   GET  /api/logs          -> admin cookie: {logs: [{id, created, name, n, from, to, vid, size}]}, newest first
   GET  /api/logs?id=N     -> admin cookie: {data} of one upload
   POST /api/logs + admin cookie: {del: [ids]} | {clear: true} */
import { client, isAdmin, missing } from "./_db.js";

const BOT = /bot|crawl|spider|slurp|preview|headless|monitor|lighthouse|curl|wget|python|node-fetch/i;
const B64 = /^[A-Za-z0-9+/]+=*$/;
const MAX = 200, SIZE = 4e6;
const id = v => Math.max(0, Math.round(+v || 0));
const int = v => Math.max(0, Math.min(1e9, Math.round(+v || 0)));

let ready;
const setup = () => ready ??= client().execute(
  `CREATE TABLE IF NOT EXISTS loot_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL DEFAULT (datetime('now')),
     name TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, t0 INTEGER NOT NULL DEFAULT 0, t1 INTEGER NOT NULL DEFAULT 0,
     vid TEXT NOT NULL DEFAULT '', data TEXT NOT NULL)`
).catch(e => { ready = null; throw e });

async function keep(b, res) {
  const data = String(b.data || "");
  if (!data || data.length > SIZE || !B64.test(data)) return res.status(400).json({ error: "No log" });
  await client().batch([
    { sql: "INSERT INTO loot_logs (name, n, t0, t1, vid, data) VALUES (?, ?, ?, ?, ?, ?)",
      args: [String(b.name || "").slice(0, 120), int(b.n), int(b.from), int(b.to), String(b.vid || "").replace(/[^0-9a-f-]/gi, "").slice(0, 36), data] },
    `DELETE FROM loot_logs WHERE id NOT IN (SELECT id FROM loot_logs ORDER BY id DESC LIMIT ${MAX})`
  ], "write");
  return res.status(204).end();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const miss = missing();
  if (miss.length) return res.status(500).json({ error: "Missing in Vercel Environment Variables: " + miss.join(", ") });
  try {
    await setup();
    const b = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) : {};
    if (req.method === "POST" && b.data) return BOT.test(req.headers["user-agent"] || "") ? res.status(204).end() : await keep(b, res);
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    if (!await isAdmin(req)) return res.status(401).json({ error: "Not logged in" });
    if (req.method === "GET") {
      if (req.query?.id) {
        const r = (await client().execute({ sql: "SELECT data FROM loot_logs WHERE id = ?", args: [id(req.query.id)] })).rows[0];
        return r ? res.status(200).json({ data: r.data }) : res.status(404).json({ error: "Not found" });
      }
      const r = await client().execute("SELECT id, created, name, n, t0, t1, vid, length(data) AS size FROM loot_logs ORDER BY id DESC");
      return res.status(200).json({ logs: r.rows.map(x => ({ id: Number(x.id), created: x.created, name: x.name, n: Number(x.n),
        from: Number(x.t0), to: Number(x.t1), vid: x.vid, size: Number(x.size) })) });
    }
    if (b.clear) await client().execute("DELETE FROM loot_logs");
    else if (Array.isArray(b.del)) await client().batch(b.del.slice(0, MAX).map(x => ({ sql: "DELETE FROM loot_logs WHERE id = ?", args: [id(x)] })), "write");
    else return res.status(400).json({ error: "Nothing to do" });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
