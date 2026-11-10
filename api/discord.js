/* Discord bot panel at /discord (rewritten here).
   GET  /discord                     -> the panel with a valid dc_adm cookie, else the sign-in page
   POST /api/discord {id, pw}        -> sets the cookie (random token, HttpOnly, a year; only its hash is stored)
                                        5 wrong tries from one address lock it for 15 minutes
   POST /api/discord {logout: true}  -> this browser's cookie ends
   GET  /api/discord?state=1         -> (panel) {config, seen, bot, logs}
   POST /api/discord {config}        -> (panel) saves the bot settings
   The bot (bot/ folder, runs on its own computer; header x-bot-key = DISCORD_BOT_KEY in Vercel, same value in the bot's .env):
   POST /api/discord?bot=1 {beat: {tag, guilds: [{id, name, members}]}} -> {config}, and marks the bot online
   POST /api/discord?bot=1 {log: {user, channel, q, a}} -> keeps the last 100 answers
   POST /api/discord?bot=1 {error: {where, msg}}       -> keeps the last 50 errors
   POST /api/discord {clearErrors: true}             -> (panel) empties the error list
   Only the hash of "id\npassword" is kept here, never the password itself. */
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { client, missing, hash } from "./_db.js";

const CRED = "e4050ff4e0db02853f2f94e5ecce07ded169fae482f10489824399da8d74beee";
const TRIES = 5, LOCK = 15 * 60, AGE = 365 * 86400;
const cookie = (v, age) => `dc_adm=${v}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
const tokenOf = req => (/(?:^|;\s*)dc_adm=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || "") || [])[1] || "";
const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim().slice(0, 64) || "?";

let ready;
const setup = () => ready ??= client().batch([
  "CREATE TABLE IF NOT EXISTS discord_sessions (h TEXT PRIMARY KEY, created TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS discord_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS discord_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL DEFAULT (datetime('now')), user TEXT, channel TEXT, q TEXT, a TEXT)",
  "CREATE TABLE IF NOT EXISTS discord_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL DEFAULT (datetime('now')), at TEXT, msg TEXT)",
  "CREATE TABLE IF NOT EXISTS discord_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0)"
], "write").catch(e => { ready = null; throw e });

async function signedIn(req) {
  const t = tokenOf(req);
  return !!t && (await client().execute({ sql: "SELECT 1 FROM discord_sessions WHERE h = ?", args: [hash(t)] })).rows.length > 0;
}

const DEFAULTS = { enabled: true, model: "gemini-2.5-flash", prompt: "", history: 15, search: true, channels: "", cooldown: 5 };
const getKv = async k => { const r = (await client().execute({ sql: "SELECT v FROM discord_kv WHERE k = ?", args: [k] })).rows[0]; return r ? JSON.parse(String(r.v)) : null; };
const setKv = (k, v) => client().execute({ sql: "INSERT INTO discord_kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", args: [k, JSON.stringify(v)] });
const getConfig = async () => ({ ...DEFAULTS, ...(await getKv("config") || {}) });
const cleanConfig = c => ({
  enabled: !!c.enabled, search: !!c.search,
  model: String(c.model || DEFAULTS.model).slice(0, 60),
  prompt: String(c.prompt || "").slice(0, 4000),
  history: Math.max(0, Math.min(50, Math.floor(Number(c.history) || 0))),
  cooldown: Math.max(0, Math.min(600, Math.floor(Number(c.cooldown) || 0))),
  channels: String(c.channels || "").replace(/[^0-9,\s]/g, "").slice(0, 2000)
});
function isBot(req) {
  const want = process.env.DISCORD_BOT_KEY, got = String(req.headers["x-bot-key"] || "");
  if (!want || !got) return false;
  const h = s => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(want));
}

const CSS = `:root{--bg:#0b0d12;--card:#151922;--line:#262c39;--fg:#e8ebf2;--mut:#8a93a6;--acc:#5865f2;--bad:#ef4f5f}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:100%;max-width:380px}
h1{margin:0 0 4px;font-size:22px}p{color:var(--mut);margin:0 0 20px}
label{display:block;font-size:13px;color:var(--mut);margin:12px 0 4px}
input,textarea{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:#0e1118;color:var(--fg);font:inherit}
textarea{resize:vertical}input:focus,textarea:focus{outline:2px solid var(--acc);border-color:transparent}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--acc);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.6}.err{color:var(--bad);min-height:1.5em;margin-top:10px;font-size:14px}
.wide{max-width:760px;align-self:flex-start}.top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.ghost{width:auto;margin:0;background:transparent;border:1px solid var(--line);padding:7px 14px}h2{font-size:17px;margin:28px 0 10px}
.row{display:flex;gap:8px;align-items:center;color:var(--fg);font-size:15px}.row input{width:auto}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:520px){.two{grid-template-columns:1fr}.card{padding:20px}}
.st{margin:10px 0 6px;font-weight:600}.on{color:#3ba55d}.off{color:var(--mut)}
.log{border-top:1px solid var(--line);padding:10px 0}.meta{font-size:12px;color:var(--mut)}.q{font-weight:600;white-space:pre-wrap}.bad{color:var(--bad)!important}.a{color:#c9cfdb;white-space:pre-wrap;overflow-wrap:anywhere}`;

const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Discord Bot Panel</title><style>${CSS}</style></head><body>${body}</body></html>`;

const LOGIN = page(`<form class="card" id="f"><h1>Discord Bot Panel</h1><p>Sign in to continue</p>
<label for="id">ID</label><input id="id" autocomplete="username" required>
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>
<button>Sign in</button><div class="err" id="e"></div></form>
<script>f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector("button");b.disabled=true;e.textContent="";
try{const r=await fetch("/api/discord",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:document.getElementById("id").value,pw:pw.value})});
if(r.ok)return location.reload();e.textContent=(await r.json().catch(()=>({}))).error||"Error"}catch{e.textContent="Network error"}b.disabled=false}</script>`);

const PANEL = page(`<div class="card wide"><div class="top"><h1>Discord Bot Panel</h1><button id="o" class="ghost">Sign out</button></div>
<div id="st" class="st">…</div>
<form id="cf">
<label class="row"><input type="checkbox" id="enabled"> Bot answers when tagged</label>
<label class="row"><input type="checkbox" id="search"> Google Search (fresh info from the web)</label>
<label for="model">Gemini model</label><input id="model" list="models"><datalist id="models"><option>gemini-2.5-flash<option>gemini-2.5-pro<option>gemini-2.5-flash-lite</datalist>
<label for="prompt">Personality / instructions (empty = default)</label><textarea id="prompt" rows="6"></textarea>
<div class="two"><div><label for="history">Messages read before the tag</label><input id="history" type="number" min="0" max="50"></div>
<div><label for="cooldown">Cooldown per user (seconds)</label><input id="cooldown" type="number" min="0" max="600"></div></div>
<label for="channels">Only these channel IDs (comma separated, empty = all)</label><input id="channels">
<button>Save</button><div class="err" id="e"></div></form>
<h2>Servers</h2><div id="gs"></div>
<div class="top"><h2>Errors</h2><button id="ce" class="ghost">Clear</button></div><div id="errs"></div>
<h2>Last answers</h2><div id="logs"></div></div>
<script>
const $=id=>document.getElementById(id),F=["enabled","search","model","prompt","history","cooldown","channels"];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const post=b=>fetch("/api/discord",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
async function load(first){const r=await fetch("/api/discord?state=1");if(r.status==401)return location.reload();const d=await r.json();
 const ago=d.seen?Math.round((Date.now()-d.seen)/1000):null,on=ago!==null&&ago<90;
 $("st").className="st "+(on?"on":"off");$("st").textContent=on?"● Online · "+(d.bot&&d.bot.tag||"")+" · "+(d.bot&&d.bot.guilds?d.bot.guilds.length:"?")+" server(s)":"● Offline"+(ago!==null?" · last seen "+new Date(d.seen).toLocaleString():"");
 if(first)F.forEach(k=>{const el=$(k);if(el.type=="checkbox")el.checked=d.config[k];else el.value=d.config[k]});
 $("logs").innerHTML=d.logs.length?d.logs.map(l=>'<div class="log"><div class="meta">'+esc(l.t)+" UTC · "+esc(l.user)+" · #"+esc(l.channel)+'</div><div class="q">'+esc(l.q)+'</div><div class="a">'+esc(l.a)+"</div></div>").join(""):"<p>No answers yet.</p>";
const gl=d.bot&&Array.isArray(d.bot.guilds)?d.bot.guilds:[];
 $("gs").innerHTML=gl.length?gl.map(g=>'<div class="log"><span class="q">'+esc(g.name)+'</span> <span class="meta">· '+g.members+' members · '+esc(g.id)+(on?'':' · bot offline')+'</span></div>').join(""):"<p>No servers reported yet.</p>";
 $("errs").innerHTML=d.errors.length?d.errors.map(x=>'<div class="log"><div class="meta">'+esc(x.t)+" UTC · "+esc(x.at)+'</div><div class="a bad">'+esc(x.msg)+"</div></div>").join(""):'<p class="on">No errors.</p>'}
ce.onclick=async()=>{await post({clearErrors:true});load()};
cf.onsubmit=async ev=>{ev.preventDefault();const c={};F.forEach(k=>{const el=$(k);c[k]=el.type=="checkbox"?el.checked:el.value});
 const r=await post({config:c});$("e").style.color=r.ok?"#3ba55d":"";$("e").textContent=r.ok?"Saved · the bot picks it up within 30 s":(await r.json()).error}
o.onclick=async()=>{await post({logout:true});location.reload()};load(true);setInterval(load,15000);
</script>`);

async function login(req, res, id, pw) {
  const ip = ipOf(req), now = Math.floor(Date.now() / 1000);
  const f = (await client().execute({ sql: "SELECT n, until FROM discord_fails WHERE ip = ?", args: [ip] })).rows[0];
  if (f && Number(f.until) > now) return res.status(429).json({ error: `Too many wrong tries · try again in ${Math.ceil((Number(f.until) - now) / 60)} min` });
  const ok = typeof id === "string" && typeof pw === "string" &&
    timingSafeEqual(Buffer.from(hash(id + "\n" + pw), "hex"), Buffer.from(CRED, "hex"));
  if (!ok) {
    const n = (f ? Number(f.n) : 0) + 1, lock = n >= TRIES;
    await client().execute({ sql: "INSERT INTO discord_fails (ip, n, until) VALUES (?, ?, ?) ON CONFLICT (ip) DO UPDATE SET n = excluded.n, until = excluded.until",
      args: [ip, lock ? 0 : n, lock ? now + LOCK : 0] });
    return res.status(401).json({ error: lock ? "Wrong ID or password · locked for 15 minutes" : "Wrong ID or password" });
  }
  const t = randomBytes(32).toString("hex");
  await client().batch([
    { sql: "DELETE FROM discord_fails WHERE ip = ?", args: [ip] },
    { sql: "INSERT INTO discord_sessions (h) VALUES (?)", args: [hash(t)] }
  ], "write");
  res.setHeader("Set-Cookie", cookie(t, AGE));
  return res.status(200).json({ ok: true });
}

const body = req => typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const miss = missing();
  if (miss.length) return res.status(500).json({ error: "Missing in Vercel Environment Variables: " + miss.join(", ") });
  try {
    await setup();
    const q = req.query || {};
    if (q.bot) {
      if (!isBot(req)) return res.status(401).json({ error: process.env.DISCORD_BOT_KEY ? "Wrong bot key" : "Missing in Vercel Environment Variables: DISCORD_BOT_KEY" });
      const bb = body(req), cut = (v, n) => String(v ?? "").slice(0, n);
      if (bb.beat) {
        const g = Array.isArray(bb.beat.guilds) ? bb.beat.guilds.slice(0, 100).map(x => ({ id: cut(x.id, 30), name: cut(x.name, 100), members: Number(x.members) || 0 })) : [];
        await setKv("seen", { at: Date.now(), tag: cut(bb.beat.tag, 80), guilds: g });
        return res.status(200).json({ config: await getConfig() });
      }
      if (bb.error) {
        await client().batch([
          { sql: "INSERT INTO discord_errors (at, msg) VALUES (?, ?)", args: [cut(bb.error.where, 80), cut(bb.error.msg, 1500)] },
          "DELETE FROM discord_errors WHERE id NOT IN (SELECT id FROM discord_errors ORDER BY id DESC LIMIT 50)"
        ], "write");
        return res.status(200).json({ ok: true });
      }
      const l = bb.log || {};
      await client().batch([
        { sql: "INSERT INTO discord_logs (user, channel, q, a) VALUES (?, ?, ?, ?)", args: [cut(l.user, 80), cut(l.channel, 80), cut(l.q, 1000), cut(l.a, 2000)] },
        "DELETE FROM discord_logs WHERE id NOT IN (SELECT id FROM discord_logs ORDER BY id DESC LIMIT 100)"
      ], "write");
      return res.status(200).json({ ok: true });
    }
    if (req.method === "GET" && q.state) {
      if (!await signedIn(req)) return res.status(401).json({ error: "Not signed in" });
      const seen = await getKv("seen");
      const logs = (await client().execute("SELECT t, user, channel, q, a FROM discord_logs ORDER BY id DESC LIMIT 30")).rows
        .map(r => ({ t: r.t, user: r.user, channel: r.channel, q: r.q, a: r.a }));
      const errors = (await client().execute("SELECT t, at, msg FROM discord_errors ORDER BY id DESC LIMIT 50")).rows
        .map(r => ({ t: r.t, at: r.at, msg: r.msg }));
      return res.status(200).json({ config: await getConfig(), seen: seen?.at || 0, bot: seen, logs, errors });
    }
    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(await signedIn(req) ? PANEL : LOGIN);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = body(req);
    if (b.logout) {
      const t = tokenOf(req);
      if (t) await client().execute({ sql: "DELETE FROM discord_sessions WHERE h = ?", args: [hash(t)] });
      res.setHeader("Set-Cookie", cookie("", 0));
      return res.status(200).json({ ok: true });
    }
    if (b.clearErrors) {
      if (!await signedIn(req)) return res.status(401).json({ error: "Not signed in" });
      await client().execute("DELETE FROM discord_errors");
      return res.status(200).json({ ok: true });
    }
    if (b.config) {
      if (!await signedIn(req)) return res.status(401).json({ error: "Not signed in" });
      await setKv("config", cleanConfig(b.config));
      return res.status(200).json({ ok: true });
    }
    return await login(req, res, b.id, b.pw);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
