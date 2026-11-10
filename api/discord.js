/* Discord bot panel at /discord (rewritten here).
   GET  /discord                     -> the panel with a valid dc_adm cookie, else the sign-in page
   POST /api/discord {id, pw}        -> sets the cookie (random token, HttpOnly, a year; only its hash is stored)
                                        5 wrong tries from one address lock it for 15 minutes
   POST /api/discord {logout: true}  -> this browser's cookie ends
   Only the hash of "id\npassword" is kept here, never the password itself. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { client, missing, hash } from "./_db.js";

const CRED = "e4050ff4e0db02853f2f94e5ecce07ded169fae482f10489824399da8d74beee";
const TRIES = 5, LOCK = 15 * 60, AGE = 365 * 86400;
const cookie = (v, age) => `dc_adm=${v}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
const tokenOf = req => (/(?:^|;\s*)dc_adm=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || "") || [])[1] || "";
const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim().slice(0, 64) || "?";

let ready;
const setup = () => ready ??= client().batch([
  "CREATE TABLE IF NOT EXISTS discord_sessions (h TEXT PRIMARY KEY, created TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS discord_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0)"
], "write").catch(e => { ready = null; throw e });

async function signedIn(req) {
  const t = tokenOf(req);
  return !!t && (await client().execute({ sql: "SELECT 1 FROM discord_sessions WHERE h = ?", args: [hash(t)] })).rows.length > 0;
}

const CSS = `:root{--bg:#0b0d12;--card:#151922;--line:#262c39;--fg:#e8ebf2;--mut:#8a93a6;--acc:#5865f2;--bad:#ef4f5f}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:100%;max-width:380px}
h1{margin:0 0 4px;font-size:22px}p{color:var(--mut);margin:0 0 20px}
label{display:block;font-size:13px;color:var(--mut);margin:12px 0 4px}
input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:#0e1118;color:var(--fg);font:inherit}
input:focus{outline:2px solid var(--acc);border-color:transparent}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--acc);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.6}.err{color:var(--bad);min-height:1.5em;margin-top:10px;font-size:14px}`;

const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Discord Bot Panel</title><style>${CSS}</style></head><body>${body}</body></html>`;

const LOGIN = page(`<form class="card" id="f"><h1>Discord Bot Panel</h1><p>Sign in to continue</p>
<label for="id">ID</label><input id="id" autocomplete="username" required>
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>
<button>Sign in</button><div class="err" id="e"></div></form>
<script>f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector("button");b.disabled=true;e.textContent="";
try{const r=await fetch("/api/discord",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:document.getElementById("id").value,pw:pw.value})});
if(r.ok)return location.reload();e.textContent=(await r.json().catch(()=>({}))).error||"Error"}catch{e.textContent="Network error"}b.disabled=false}</script>`);

const PANEL = page(`<div class="card"><h1>Discord Bot Panel</h1><p>Signed in. Bot controls will appear here.</p>
<button id="o">Sign out</button></div>
<script>o.onclick=async()=>{await fetch("/api/discord",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"logout":true}'});location.reload()}</script>`);

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const miss = missing();
  if (miss.length) return res.status(500).json({ error: "Missing in Vercel Environment Variables: " + miss.join(", ") });
  try {
    await setup();
    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(await signedIn(req) ? PANEL : LOGIN);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.logout) {
      const t = tokenOf(req);
      if (t) await client().execute({ sql: "DELETE FROM discord_sessions WHERE h = ?", args: [hash(t)] });
      res.setHeader("Set-Cookie", cookie("", 0));
      return res.status(200).json({ ok: true });
    }
    return await login(req, res, b.id, b.pw);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
