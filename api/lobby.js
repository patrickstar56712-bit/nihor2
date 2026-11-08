/* 123 Lobby behind accounts (its files live in api/_lobby/, which Vercel does not serve by itself).
   GET  /123lobby/          (rewritten here)        -> the lobby with a valid lobby cookie, else the sign-in / sign-up page
   GET  /123lobby/png/<f>   (rewritten here, ?f=<f>) -> a lobby picture, only with a valid lobby cookie (the wallpaper always, for the sign-in page)
   POST /api/lobby {register: {u, p}} -> makes an account and signs in
   POST /api/lobby {login: {u, p}}    -> signs in: lobby cookie (random token, HttpOnly, 30 days; only its hash is stored)
                                         5 wrong passwords from one address lock it for 15 minutes; 5 new accounts per address per hour
   POST /api/lobby {logout: true}     -> this browser's lobby cookie ends
   GET  /api/lobby?users=1            -> (lobby admin) every account: [{u, name, created, admin}]
   POST /api/lobby {deleteUser: u}    -> (lobby admin) removes that account and signs it out everywhere (admins can not be removed)
   Passwords are kept as scrypt hashes with their own salt. */
import { readFileSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { client, missing, hash, isAdmin } from "./_db.js";

const TRIES = 5, LOCK = 15 * 60, AGE = 30 * 86400, REGS = 5;
const cookie = (v, age) => `nh_lb=${v}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const tok = req => (/(?:^|;\s*)nh_lb=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || "") || [])[1] || "";
const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
const pwHash = (p, salt) => scryptSync(p, salt, 32).toString("hex");
const U_OK = /^[a-zA-Z0-9_.-]{3,20}$/;
/* lobby admins (lowercase names); such a name can be signed up only from a browser signed in to the tracker's Control Panel */
const ADMINS = new Set((process.env.LOBBY_ADMINS || "preju").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));

let ready;
const setup = () => ready ??= (async () => {
  await client().batch([
    "CREATE TABLE IF NOT EXISTS lobby_users (u TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, ph TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS lobby_sessions (h TEXT PRIMARY KEY, u TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS lobby_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0)"
  ], "write");
  /* a lobby_sessions table from the first (one password) version has no user column */
  try { await client().execute("ALTER TABLE lobby_sessions ADD COLUMN u TEXT NOT NULL DEFAULT ''") } catch (e) {}
  await client().execute("DELETE FROM lobby_sessions WHERE u = ''");
})().catch(e => { ready = null; throw e });

/* the signed-in user {u, name, admin}, or null */
async function signedIn(req) {
  const t = tok(req);
  if (!t) return null;
  const row = (await client().execute({ sql: "SELECT u.u, u.name FROM lobby_sessions s JOIN lobby_users u ON u.u = s.u WHERE s.h = ?", args: [hash(t)] })).rows[0];
  return row ? { u: String(row.u), name: String(row.name), admin: ADMINS.has(String(row.u)) } : null;
}
/* the lobby page, told who is signed in (it then shows that user, not its own login box) */
const lobbyPage = me => file("index.html").toString("utf8").replace("<head>",
  "<head><script>window.LB_ME=" + JSON.stringify({ name: me.name, admin: me.admin }).replace(/</g, "\\u003c") + "</script>");
async function startSession(res, u) {
  const t = randomBytes(32).toString("hex");
  await client().execute({ sql: "INSERT INTO lobby_sessions (h, u) VALUES (?, ?)", args: [hash(t), u] });
  res.setHeader("Set-Cookie", cookie(t, AGE));
}

const file = p => readFileSync(new URL("./_lobby/" + p, import.meta.url));
const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
const PUBLIC = new Set(["bg.jpg", "favicon.png"]);   // the wallpaper and the tab icon of the sign-in page

const SIGNIN = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>123 Lobby · Giriş</title><link rel="icon" type="image/png" href="png/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&display=swap" rel="stylesheet">
<style>
:root{--panel:#0e0e0e;--ink:#f2f2f2;--mute:#9a9a9a;--line:#2a2a2a;--gold:#e5a93d;--jade:#5fc2a6;--hl:#241f10;color-scheme:dark}
*{box-sizing:border-box}[hidden]{display:none!important}
html{background:#070514}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:transparent;color:var(--ink);font-family:"Bricolage Grotesque",system-ui,sans-serif}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;
  background:linear-gradient(rgba(6,4,18,.2),rgba(6,4,18,.2)),url(png/bg.jpg) center/cover no-repeat,
    radial-gradient(900px 600px at 15% 0%,color-mix(in srgb,var(--gold) 22%,transparent),transparent 70%),
    radial-gradient(800px 600px at 90% 20%,color-mix(in srgb,var(--jade) 18%,transparent),transparent 70%),#070514}
.box{width:100%;max-width:360px;padding:26px 24px;border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:blur(6px);display:grid;gap:14px}
h1{margin:0;font-size:26px;color:var(--gold)}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:4px;border:1px solid var(--line);border-radius:12px;background:#000}
.tabs button{padding:8px;border:0;border-radius:9px;background:transparent;color:var(--mute);font:inherit;font-weight:700;cursor:pointer}
.tabs button[aria-selected=true]{background:var(--hl);color:var(--gold)}
form{display:grid;gap:10px}
label{display:grid;gap:5px;font-size:13px;color:var(--mute)}
input{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:#000;color:var(--ink);font:inherit;font-size:15px}
input:focus{outline:2px solid var(--gold);outline-offset:1px}
.go{margin-top:4px;padding:11px;border-radius:10px;border:1px solid var(--gold);background:var(--hl);color:var(--gold);font:inherit;font-size:15px;font-weight:800;cursor:pointer}
.go:disabled{opacity:.6;cursor:wait}
.e{color:#ff6b6b;min-height:1.2em;font-size:13px}small{color:var(--mute);font-size:12px}
</style></head><body>
<div class="box">
  <h1>123 Lobby</h1>
  <div class="tabs" role="tablist"><button role="tab" id="tIn" aria-selected="true">Giriş yap</button><button role="tab" id="tUp" aria-selected="false">Kayıt ol</button></div>
  <form id="fIn">
    <label>Kullanıcı adı<input name="u" autocomplete="username" required autofocus></label>
    <label>Şifre<input name="p" type="password" autocomplete="current-password" required></label>
    <button class="go">Giriş yap</button><div class="e" role="alert"></div>
  </form>
  <form id="fUp" hidden>
    <label>Kullanıcı adı<input name="u" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_.\\-]{3,20}" required></label>
    <small>3-20 karakter: harf, rakam, _ . -</small>
    <label>Şifre<input name="p" type="password" placeholder="Basit şifre yazın" autocomplete="new-password" minlength="6" maxlength="100" required></label>
    <label>Şifre (tekrar)<input name="p2" type="password" placeholder="Basit şifre yazın" autocomplete="new-password" minlength="6" maxlength="100" required></label>
    <button class="go">Kayıt ol</button><div class="e" role="alert"></div>
  </form>
</div>
<script>
const tab=up=>{tIn.setAttribute("aria-selected",!up);tUp.setAttribute("aria-selected",up);fIn.hidden=up;fUp.hidden=!up;(up?fUp:fIn).u.focus()};
tIn.onclick=()=>tab(false);tUp.onclick=()=>tab(true);
async function send(f,kind){const b=f.querySelector(".go"),er=f.querySelector(".e");er.textContent="";
  if(kind==="register"&&f.p.value!==f.p2.value){er.textContent="Şifreler aynı değil";return}
  b.disabled=true;
  try{const r=await fetch("/api/lobby",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({[kind]:{u:f.u.value.trim(),p:f.p.value}})});
    const d=await r.json().catch(()=>({}));if(r.ok){location.reload();return}er.textContent=d.error||"Olmadı, tekrar dene";}
  catch(x){er.textContent="Sunucuya ulaşılamadı"}
  b.disabled=false}
fIn.onsubmit=e=>{e.preventDefault();send(fIn,"login")};
fUp.onsubmit=e=>{e.preventDefault();send(fUp,"register")};
</script></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const miss = missing();
  if (miss.length) return res.status(500).send("Missing in Vercel Environment Variables: " + miss.join(", "));
  try {
    await setup();
    if (req.method === "GET") {
      if (req.query?.users) {   // the accounts, for the lobby's Kontrol paneli
        const me = await signedIn(req);
        if (!me || !me.admin) return res.status(403).json({ error: "Sadece admin" });
        const rows = (await client().execute("SELECT u, name, created FROM lobby_users ORDER BY created DESC")).rows;
        return res.status(200).json(rows.map(x => ({ u: String(x.u), name: String(x.name), created: String(x.created), admin: ADMINS.has(String(x.u)) })));
      }
      const f = String(req.query?.f || "");
      if (f) {   // a picture of the lobby
        const m = /^[a-z0-9_-]+\.([a-z]+)$/i.exec(f), ty = m && TYPES[m[1].toLowerCase()];
        if (!ty) return res.status(404).send("Not found");
        if (!PUBLIC.has(f) && !await signedIn(req)) return res.status(401).send("Not signed in");
        try { res.setHeader("Content-Type", ty); return res.status(200).send(file("png/" + f)) } catch (e) { return res.status(404).send("Not found") }
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const me = await signedIn(req);
      return res.status(200).send(me ? lobbyPage(me) : SIGNIN);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (typeof b.deleteUser === "string") {
      const me = await signedIn(req), u = b.deleteUser.trim().toLowerCase();
      if (!me || !me.admin) return res.status(403).json({ error: "Sadece admin" });
      if (ADMINS.has(u)) return res.status(400).json({ error: "Admin hesabı silinemez" });
      await client().batch([
        { sql: "DELETE FROM lobby_sessions WHERE u = ?", args: [u] },
        { sql: "DELETE FROM lobby_users WHERE u = ?", args: [u] }
      ], "write");
      return res.status(200).json({ ok: true });
    }
    if (b.logout) {
      const t = tok(req);
      if (t) await client().execute({ sql: "DELETE FROM lobby_sessions WHERE h = ?", args: [hash(t)] });
      res.setHeader("Set-Cookie", cookie("", 0));
      return res.status(200).json({ ok: true });
    }
    const ip = ipOf(req).slice(0, 64), now = Math.floor(Date.now() / 1000);
    if (b.register && typeof b.register === "object") {
      const name = String(b.register.u || "").trim(), p = String(b.register.p || ""), u = name.toLowerCase();
      if (!U_OK.test(name)) return res.status(400).json({ error: "Kullanıcı adı 3-20 karakter olmalı: harf, rakam, _ . -" });
      if (ADMINS.has(u) && !await isAdmin(req)) return res.status(403).json({ error: "Bu kullanıcı adı ayrılmış" });
      if (p.length < 6 || p.length > 100) return res.status(400).json({ error: "Şifre en az 6 karakter olmalı" });
      const n = Number((await client().execute({ sql: "SELECT COUNT(*) AS n FROM lobby_users WHERE ip = ? AND created > datetime('now', '-1 hour')", args: [ip] })).rows[0].n);
      if (n >= REGS) return res.status(429).json({ error: "Bu adresten çok fazla kayıt açıldı · biraz sonra tekrar dene" });
      if ((await client().execute({ sql: "SELECT 1 FROM lobby_users WHERE u = ?", args: [u] })).rows.length) return res.status(409).json({ error: "Bu kullanıcı adı alınmış" });
      const salt = randomBytes(16).toString("hex");
      await client().execute({ sql: "INSERT INTO lobby_users (u, name, salt, ph, ip) VALUES (?, ?, ?, ?, ?)", args: [u, name, salt, pwHash(p, salt), ip] });
      await startSession(res, u);
      return res.status(200).json({ ok: true });
    }
    if (b.login && typeof b.login === "object") {
      const u = String(b.login.u || "").trim().toLowerCase(), p = String(b.login.p || "");
      const fl = (await client().execute({ sql: "SELECT n, until FROM lobby_fails WHERE ip = ?", args: [ip] })).rows[0];
      if (fl && Number(fl.until) > now) return res.status(429).json({ error: `Çok fazla yanlış deneme · ${Math.ceil((Number(fl.until) - now) / 60)} dk sonra tekrar dene` });
      const row = U_OK.test(u) ? (await client().execute({ sql: "SELECT salt, ph FROM lobby_users WHERE u = ?", args: [u] })).rows[0] : null;
      const ok = !!row && p.length > 0 && timingSafeEqual(Buffer.from(pwHash(p, String(row.salt)), "hex"), Buffer.from(String(row.ph), "hex"));
      if (!ok) {
        const n = (fl ? Number(fl.n) : 0) + 1, lock = n >= TRIES;
        await client().execute({ sql: "INSERT INTO lobby_fails (ip, n, until) VALUES (?, ?, ?) ON CONFLICT (ip) DO UPDATE SET n = excluded.n, until = excluded.until",
          args: [ip, lock ? 0 : n, lock ? now + LOCK : 0] });
        return res.status(401).json({ error: lock ? "Kullanıcı adı veya şifre yanlış · 15 dakika kilitlendi" : "Kullanıcı adı veya şifre yanlış" });
      }
      await client().execute({ sql: "DELETE FROM lobby_fails WHERE ip = ?", args: [ip] });
      await startSession(res, u);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Nothing to do" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
