/* Screen Tracker pictures (see schema.sql: screen_missing, screen_icons).
   GET  /api/screen -> {icons: [{id, name, image}]} for every visitor: recognized in screenshots besides png/
                       with header "x-admin-key" also {missing: [{id, image, seen, first, last}]}
   POST /api/screen {miss: [{sig, image}]} -> anyone: inventory slots nobody could recognize (up to 300 kept)
   POST /api/screen + "x-admin-key": {save: {name, image, miss}} | {del: [ids]} | {clear: true} | {delIcon: id}
                                     | {type: {k, t}} or {types: [{k, t}]} (an item's kind shown in Items; t "" goes back to the default)
                                     | {pair: {id, key, chest}} (a dungeon key and its chest; no id = a new pair) | {delPair: id}
   GET also gives {types: {item key: kind}, pairs: [{id, key, chest}]} */
import { client, isAdmin, missing } from "./_db.js";

const BOT = /bot|crawl|spider|slurp|preview|headless|monitor|lighthouse|curl|wget|python|node-fetch/i;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
const SIG = /^[0-9a-f]{16,64}$/;
const MAX = 300;
const pic = v => typeof v === "string" && v.length < 20000 && PNG.test(v) ? v : "";
const id = v => Math.max(0, Math.round(+v || 0));
const KEY = /^[a-z0-9]{1,80}$/;

/* the tables are made on first use, so nothing has to be run by hand in Turso */
let ready;
const setup = () => ready ??= client().batch([
  `CREATE TABLE IF NOT EXISTS screen_missing (id INTEGER PRIMARY KEY AUTOINCREMENT, sig TEXT NOT NULL UNIQUE, image TEXT NOT NULL,
     seen INTEGER NOT NULL DEFAULT 1, first TEXT NOT NULL DEFAULT (datetime('now')), last TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS screen_icons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, image TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS item_types (k TEXT PRIMARY KEY, t TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS dungeon_pairs (id INTEGER PRIMARY KEY AUTOINCREMENT, key_name TEXT NOT NULL DEFAULT '', chest_name TEXT NOT NULL DEFAULT '')`
], "write").catch(e => { ready = null; throw e });

async function read(req, res) {
  const adm = isAdmin(req);
  const [icons, miss, types, pairs] = await client().batch([
    "SELECT id, name, image FROM screen_icons ORDER BY name COLLATE NOCASE",
    adm ? "SELECT id, image, seen, first, last FROM screen_missing ORDER BY last DESC" : "SELECT 1 WHERE 0",
    "SELECT k, t FROM item_types",
    "SELECT id, key_name, chest_name FROM dungeon_pairs ORDER BY id"
  ], "read");
  const out = { icons: icons.rows.map(r => ({ id: Number(r.id), name: r.name, image: r.image })),
    types: Object.fromEntries(types.rows.map(r => [r.k, r.t])),
    pairs: pairs.rows.map(r => ({ id: Number(r.id), key: r.key_name, chest: r.chest_name })) };
  if (adm) out.missing = miss.rows.map(r => ({ id: Number(r.id), image: r.image, seen: Number(r.seen), first: r.first, last: r.last }));
  return res.status(200).json(out);
}

/* a visitor's unrecognized slots: the same picture again only raises its count */
async function report(b, res) {
  const st = [];
  for (const m of (Array.isArray(b.miss) ? b.miss : []).slice(0, 20)) {
    const im = pic(m?.image), sig = String(m?.sig || "");
    if (!im || !SIG.test(sig)) continue;
    st.push({
      sql: `INSERT INTO screen_missing (sig, image) SELECT ?, ? WHERE (SELECT count(*) FROM screen_missing) < ${MAX}
            ON CONFLICT (sig) DO UPDATE SET seen = seen + 1, last = datetime('now')`,
      args: [sig, im]
    });
  }
  if (st.length) await client().batch(st, "write");
  return res.status(204).end();
}

async function admin(b, res) {
  const st = [];
  if (b.save) {
    const name = String(b.save.name ?? "").trim().slice(0, 80), im = pic(b.save.image);
    if (!name || !im) return res.status(400).json({ error: "A name and a picture are needed" });
    st.push({ sql: "INSERT INTO screen_icons (name, image) VALUES (?, ?)", args: [name, im] });
    if (id(b.save.miss)) st.push({ sql: "DELETE FROM screen_missing WHERE id = ?", args: [id(b.save.miss)] });
  }
  if (Array.isArray(b.del)) for (const x of b.del.slice(0, MAX)) st.push({ sql: "DELETE FROM screen_missing WHERE id = ?", args: [id(x)] });
  if (b.clear) st.push("DELETE FROM screen_missing");
  for (const y of [b.type, ...(Array.isArray(b.types) ? b.types.slice(0, 20) : [])]) {
    if (!y || !KEY.test(String(y.k || ""))) continue;
    const t = String(y.t ?? "").trim().slice(0, 30);
    st.push(t ? { sql: "INSERT INTO item_types (k, t) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET t = excluded.t", args: [y.k, t] }
              : { sql: "DELETE FROM item_types WHERE k = ?", args: [y.k] });
  }
  if (b.pair) {
    const k = String(b.pair.key ?? "").trim().slice(0, 80), c = String(b.pair.chest ?? "").trim().slice(0, 80);
    if (!k && !c) return res.status(400).json({ error: "A key or a chest name is needed" });
    st.push(id(b.pair.id) ? { sql: "UPDATE dungeon_pairs SET key_name = ?, chest_name = ? WHERE id = ?", args: [k, c, id(b.pair.id)] }
                          : { sql: "INSERT INTO dungeon_pairs (key_name, chest_name) VALUES (?, ?)", args: [k, c] });
  }
  if (b.delPair) st.push({ sql: "DELETE FROM dungeon_pairs WHERE id = ?", args: [id(b.delPair)] });
  if (b.delIcon) st.push({ sql: "DELETE FROM screen_icons WHERE id = ?", args: [id(b.delIcon)] });
  if (!st.length) return res.status(400).json({ error: "Nothing to save" });
  await client().batch(st, "write");
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const miss = missing();
  if (miss.length) return res.status(500).json({ error: "Missing in Vercel Environment Variables: " + miss.join(", ") });
  try {
    await setup();
    if (req.method === "GET") return await read(req, res);
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.miss) return BOT.test(req.headers["user-agent"] || "") ? res.status(204).end() : await report(b, res);
    if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "Missing in Vercel Environment Variables: ADMIN_PASSWORD" });
    if (!isAdmin(req)) return res.status(401).json({ error: "Wrong admin password" });
    return await admin(b, res);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
