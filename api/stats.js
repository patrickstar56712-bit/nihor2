/* Site statistics (see schema.sql: stats_daily, visitors). Only counts, never file contents or IPs.
   POST /api/stats  {v: browser id, visit: true on a session's first page, view: page, up: "loot"|"dloot"|"screen", n: lines or items read}
                    -> anyone; adds to today's counters (Turkey time)
   GET  /api/stats  -> admin cookie: last 30 days, totals, pages and uploads for the Control Panel */
import { client, isAdmin, missing } from "./_db.js";

const PAGES = new Set(["home", "tools", "loot", "dloot", "screen", "upgrade", "weapons", "jewellery", "armour", "helmets", "shields", "dews", "petart", "progress", "skills", "divine"]);
const TOOLS = new Set(["loot", "dloot", "screen"]);
const DAY = "date('now', '+3 hours')";
const BOT = /bot|crawl|spider|slurp|preview|headless|monitor|lighthouse|curl|wget|python|node-fetch/i;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bump = (kind, key, by = 1) => ({
  sql: `INSERT INTO stats_daily (day, kind, key, count) VALUES (${DAY}, ?, ?, ?) ON CONFLICT (day, kind, key) DO UPDATE SET count = count + excluded.count`,
  args: [kind, key, by]
});

async function record(req, res) {
  if (BOT.test(req.headers["user-agent"] || "")) return res.status(204).end();
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const st = [];
  if (b.visit) {
    st.push(bump("visit", ""));
    if (ID.test(b.v || "")) st.push({ sql: `INSERT OR IGNORE INTO visitors (id, day) VALUES (?, ${DAY})`, args: [b.v.toLowerCase()] });
  }
  if (PAGES.has(b.view)) st.push(bump("view", b.view));
  if (TOOLS.has(b.up)) {
    st.push(bump("upload", b.up));
    const n = Math.round(+b.n || 0); if (n > 0) st.push(bump("lines", b.up, Math.min(n, 1e6)));
  }
  if (st.length) await client().batch(st, "write");
  return res.status(204).end();
}

async function report(res) {
  const since = `date('now', '+3 hours', '-29 days')`;
  const [daily, uniq, totals, allUniq, pages, tools, today] = await client().batch([
    `SELECT day, kind, sum(count) AS n FROM stats_daily WHERE day >= ${since} GROUP BY day, kind`,
    `SELECT day, count(*) AS n FROM visitors WHERE day >= ${since} GROUP BY day`,
    "SELECT kind, sum(count) AS n FROM stats_daily GROUP BY kind",
    "SELECT count(DISTINCT id) AS n FROM visitors",
    "SELECT key, sum(count) AS n FROM stats_daily WHERE kind = 'view' GROUP BY key ORDER BY n DESC",
    "SELECT key, kind, sum(count) AS n FROM stats_daily WHERE kind IN ('upload', 'lines') GROUP BY key, kind",
    `SELECT ${DAY} AS d`
  ], "read");
  const days = {};
  const day = d => days[d] ??= { day: d, visits: 0, unique: 0, views: 0, uploads: 0 };
  for (const r of daily.rows) {
    const o = day(r.day), n = Number(r.n);
    if (r.kind === "visit") o.visits += n; else if (r.kind === "view") o.views += n; else if (r.kind === "upload") o.uploads += n;
  }
  for (const r of uniq.rows) day(r.day).unique = Number(r.n);
  const tot = { visits: 0, views: 0, uploads: 0, lines: 0 };
  for (const r of totals.rows) if (r.kind === "visit") tot.visits = Number(r.n); else if (r.kind === "view") tot.views = Number(r.n);
    else if (r.kind === "upload") tot.uploads = Number(r.n); else if (r.kind === "lines") tot.lines = Number(r.n);
  tot.unique = Number(allUniq.rows[0]?.n || 0);
  const up = {};
  for (const r of tools.rows) (up[r.key] ??= { files: 0, lines: 0 })[r.kind === "upload" ? "files" : "lines"] = Number(r.n);
  return res.status(200).json({
    today: today.rows[0].d,
    days: Object.values(days).sort((a, b) => a.day < b.day ? -1 : 1),
    totals: tot,
    pages: pages.rows.map(r => ({ page: r.key, views: Number(r.n) })),
    uploads: up
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const miss = missing();
  if (miss.length) return res.status(500).json({ error: "Missing in Vercel Environment Variables: " + miss.join(", ") });
  try {
    if (req.method === "POST") return await record(req, res);
    if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });
    if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "Missing in Vercel Environment Variables: ADMIN_PASSWORD" });
    if (!await isAdmin(req)) return res.status(401).json({ error: "Not logged in" });
    return await report(res);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
