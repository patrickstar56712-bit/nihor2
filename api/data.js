/* Shared site data on Turso (see schema.sql).
   GET  /api/data  -> everything the Control Panel manages, for every visitor
   POST /api/data  -> header "x-admin-key: <ADMIN_PASSWORD>", body with any of
                      { check: true } | { items: { weapons: [...], ... } } | { skills: {...} } | { chars: {...} }
   Item, skill and character shapes are the ones index.html keeps in localStorage. */
import { client, isAdmin, missing } from "./_db.js";

const CATS = ["weapons", "jewellery", "armour", "helmets", "shields"];
const CHARS = { warrior: ["body", "mental"], sura: ["wasu", "masu"], ninja: ["dagger", "archer"], shaman: ["dragon", "heal"] };
const LV = 9, SKN = 30;

const txt = (v, max = 120) => String(v ?? "").trim().slice(0, max);
const int = v => Math.max(0, Math.min(Math.round(+v || 0), 1e15));

/* ---------- read ---------- */
async function readAll() {
  const [items, steps, mats, stats, lv, smats, chars, meta] = await client().batch([
    "SELECT id, category, name, image, craft_yang FROM items ORDER BY id",
    "SELECT item_id, step, yang FROM item_steps",
    "SELECT item_id, step, material, count FROM item_materials ORDER BY item_id, position, step",
    "SELECT item_id, stat, level, value FROM item_stats ORDER BY item_id, position, level",
    "SELECT level, yang FROM skill_levels",
    "SELECT level, material, count FROM skill_materials ORDER BY position, level",
    "SELECT character, grp, skill FROM character_skills ORDER BY character, grp, position",
    "SELECT value FROM meta WHERE key = 'updated'"
  ], "read");

  const byId = new Map(), out = Object.fromEntries(CATS.map(c => [c, []]));
  for (const r of items.rows) {
    const w = { n: r.name, y: Array(LV).fill(0), m: [], a: [], cr: { y: Number(r.craft_yang), m: [] }, im: r.image || "" };
    byId.set(Number(r.id), w); out[r.category]?.push(w);
  }
  for (const r of steps.rows) { const w = byId.get(Number(r.item_id)); if (w) w.y[Number(r.step)] = Number(r.yang); }
  for (const r of mats.rows) {
    const w = byId.get(Number(r.item_id)); if (!w) continue;
    const s = Number(r.step), c = Number(r.count);
    if (s < 0) { w.cr.m.push({ n: r.material, c }); continue; }
    let m = w.m.find(x => x.n === r.material);
    if (!m) w.m.push(m = { n: r.material, c: Array(LV).fill(0) });
    m.c[s] = c;
  }
  for (const r of stats.rows) {
    const w = byId.get(Number(r.item_id)); if (!w) continue;
    let a = w.a.find(x => x.n === r.stat);
    if (!a) w.a.push(a = { n: r.stat, v: Array(LV + 1).fill("") });
    a.v[Number(r.level)] = r.value;
  }

  const sk = { y: Array(SKN).fill(0), m: [] };
  for (const r of lv.rows) sk.y[Number(r.level)] = Number(r.yang);
  for (const r of smats.rows) {
    let m = sk.m.find(x => x.n === r.material);
    if (!m) sk.m.push(m = { n: r.material, c: Array(SKN).fill(0) });
    m.c[Number(r.level)] = Number(r.count);
  }

  const ch = {};
  for (const r of chars.rows) (ch[r.character + "/" + r.grp] ??= []).push(r.skill);

  const empty = !items.rows.length && !lv.rows.length && !smats.rows.length && !chars.rows.length;
  return { empty, updated: meta.rows[0]?.value || null, items: out, skills: sk, chars: ch };
}

/* ---------- write: each part replaces what the database holds for it ---------- */
function itemStmts(cat, list) {
  const st = [
    { sql: "DELETE FROM item_materials WHERE item_id IN (SELECT id FROM items WHERE category = ?)", args: [cat] },
    { sql: "DELETE FROM item_steps WHERE item_id IN (SELECT id FROM items WHERE category = ?)", args: [cat] },
    { sql: "DELETE FROM item_stats WHERE item_id IN (SELECT id FROM items WHERE category = ?)", args: [cat] },
    { sql: "DELETE FROM items WHERE category = ?", args: [cat] }
  ];
  const seen = new Set();
  for (const w of (Array.isArray(list) ? list : []).slice(0, 500)) {
    const n = txt(w?.n, 80); if (!n || seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase());
    const im = typeof w.im === "string" && w.im.startsWith("data:image/") && w.im.length < 300000 ? w.im : null;
    const id = "(SELECT id FROM items WHERE category = ? AND name = ? COLLATE NOCASE)";
    st.push({ sql: "INSERT INTO items (category, name, image, craft_yang) VALUES (?, ?, ?, ?)", args: [cat, n, im, int(w.cr?.y)] });
    for (let s = 0; s < LV; s++) st.push({ sql: `INSERT INTO item_steps (item_id, step, yang) VALUES (${id}, ?, ?)`, args: [cat, n, s, int(w.y?.[s])] });
    /* materials per step (-1 = craft); the same name twice in one step is added together */
    const rows = new Map();
    const add = (s, mat, c, pos) => {
      if (!mat || c <= 0) return;
      const k = s + "|" + mat.toLowerCase(), r = rows.get(k);
      if (r) r.c += c; else rows.set(k, { s, mat, c, pos });
    };
    (Array.isArray(w.m) ? w.m : []).slice(0, 60).forEach((m, p) => { for (let s = 0; s < LV; s++) add(s, txt(m?.n), int(m?.c?.[s]), p) });
    (Array.isArray(w.cr?.m) ? w.cr.m : []).slice(0, 60).forEach((m, p) => add(-1, txt(m?.n), int(m?.c), p));
    for (const r of rows.values())
      st.push({ sql: `INSERT INTO item_materials (item_id, step, material, count, position) VALUES (${id}, ?, ?, ?, ?)`, args: [cat, n, r.s, r.mat, r.c, r.pos] });
    const sseen = new Set();
    (Array.isArray(w.a) ? w.a : []).slice(0, 30).forEach((a, p) => {
      const sn = txt(a?.n, 80);
      for (let l = 0; l <= LV; l++) {
        const v = txt(a?.v?.[l], 40), k = sn.toLowerCase() + "|" + l; if (!v || sseen.has(k)) continue; sseen.add(k);
        st.push({ sql: `INSERT INTO item_stats (item_id, stat, level, value, position) VALUES (${id}, ?, ?, ?, ?)`, args: [cat, n, sn, l, v, p] });
      }
    });
  }
  return st;
}

function skillStmts(sk) {
  const st = ["DELETE FROM skill_materials", "DELETE FROM skill_levels"];
  for (let i = 0; i < SKN; i++) st.push({ sql: "INSERT INTO skill_levels (level, yang) VALUES (?, ?)", args: [i, int(sk?.y?.[i])] });
  const seen = new Set();
  (Array.isArray(sk?.m) ? sk.m : []).slice(0, 60).forEach((m, p) => {
    const n = txt(m?.n); if (!n || seen.has(n.toLowerCase())) return; seen.add(n.toLowerCase());
    for (let i = 0; i < SKN; i++) { const c = int(m?.c?.[i]); if (c > 0) st.push({ sql: "INSERT INTO skill_materials (level, material, count, position) VALUES (?, ?, ?, ?)", args: [i, n, c, p] }) }
  });
  return st;
}

function charStmts(ch) {
  const st = ["DELETE FROM character_skills"];
  for (const [c, gs] of Object.entries(CHARS)) for (const g of gs) {
    const list = Array.isArray(ch?.[c + "/" + g]) ? ch[c + "/" + g] : [], seen = new Set();
    list.slice(0, 80).forEach((s, p) => {
      const n = txt(s); if (!n || seen.has(n)) return; seen.add(n);
      st.push({ sql: "INSERT INTO character_skills (character, grp, skill, position) VALUES (?, ?, ?, ?)", args: [c, g, n, p] });
    });
  }
  return st;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  /* settings missing in Vercel -> say which, so the Control Panel can show it */
  const miss = missing();
  if (miss.length) return res.status(500).json({ error: "Missing in Vercel Environment Variables: " + miss.join(", ") });
  try {
    if (req.method === "GET") return res.status(200).json(await readAll());
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "Missing in Vercel Environment Variables: ADMIN_PASSWORD" });
    if (!isAdmin(req)) return res.status(401).json({ error: "Wrong admin password" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.check) { await client().execute("SELECT 1 FROM items LIMIT 1"); return res.status(200).json({ ok: true }) }   // login also proves the database answers
    const st = [];
    for (const c of CATS) if (b.items && Array.isArray(b.items[c])) st.push(...itemStmts(c, b.items[c]));
    if (b.skills) st.push(...skillStmts(b.skills));
    if (b.chars) st.push(...charStmts(b.chars));
    if (!st.length) return res.status(400).json({ error: "Nothing to save" });
    st.push("INSERT OR REPLACE INTO meta (key, value) VALUES ('updated', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))");
    await client().batch(st, "write");
    return res.status(200).json({ ok: true, statements: st.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
