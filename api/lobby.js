/* 123 Lobby behind a sign-in (its files live in api/_lobby/, which Vercel does not serve by itself).
   GET  /123lobby/          (rewritten here)        -> the lobby with a valid lobby cookie, else the sign-in page
   GET  /123lobby/png/<f>   (rewritten here, ?f=<f>) -> a lobby picture, only with a valid lobby cookie
   POST /api/lobby {login: password} -> sets the lobby cookie (random token, HttpOnly, 30 days; only its hash is stored)
                                        password: LOBBY_PASSWORD in Vercel (the admin password while that is not set);
                                        5 wrong passwords from one address lock it for 15 minutes
   POST /api/lobby {logout: true}    -> this browser's lobby cookie ends */
import { readFileSync } from "node:fs";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { client, missing, hash } from "./_db.js";

const TRIES = 5, LOCK = 15 * 60, AGE = 30 * 86400;
const cookie = (v, age) => `nh_lb=${v}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const tok = req => (/(?:^|;\s*)nh_lb=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || "") || [])[1] || "";
const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
const pwWant = () => process.env.LOBBY_PASSWORD || process.env.ADMIN_PASSWORD || "";
function samePw(got) {
  const want = pwWant();
  if (!want || typeof got !== "string" || !got) return false;
  const h = s => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(want));
}
let ready;
const setup = () => ready ??= client().batch([
  "CREATE TABLE IF NOT EXISTS lobby_sessions (h TEXT PRIMARY KEY, created TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS lobby_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0)"
], "write").catch(e => { ready = null; throw e });
async function signedIn(req) {
  const t = tok(req);
  if (!t) return false;
  return (await client().execute({ sql: "SELECT 1 FROM lobby_sessions WHERE h = ?", args: [hash(t)] })).rows.length > 0;
}

const file = p => readFileSync(new URL("./_lobby/" + p, import.meta.url));
const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

const SIGNIN = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>123 Lobby · Giriş</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#070514;color:#f2f2f2;font-family:system-ui,sans-serif}
form{width:100%;max-width:340px;padding:28px 24px;border:1px solid #2a2a2a;border-radius:16px;background:#0e0e0e;display:grid;gap:14px}
h1{margin:0;font-size:24px;color:#e5a93d}p{margin:0;color:#9a9a9a;font-size:14px}
input{width:100%;padding:11px 12px;border-radius:10px;border:1px solid #2a2a2a;background:#000;color:#f2f2f2;font-size:15px}
input:focus{outline:2px solid #e5a93d;outline-offset:1px}
button{padding:11px;border-radius:10px;border:1px solid #e5a93d;background:#241f10;color:#e5a93d;font-size:15px;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}#e{color:#ff6b6b;min-height:1.2em;font-size:13px}
</style></head><body>
<form id="f"><h1>123 Lobby</h1><p>Devam etmek için şifreyi gir.</p>
<input id="p" type="password" autocomplete="current-password" placeholder="Şifre" aria-label="Şifre" required autofocus>
<button id="b">Giriş yap</button><div id="e" role="alert"></div></form>
<script>
f.onsubmit=async e=>{e.preventDefault();b.disabled=true;document.getElementById("e").textContent="";
  try{const r=await fetch("/api/lobby",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({login:p.value})});
    const d=await r.json().catch(()=>({}));if(r.ok){location.reload();return}
    document.getElementById("e").textContent=d.error||"Giriş olmadı";}
  catch(x){document.getElementById("e").textContent="Sunucuya ulaşılamadı"}
  b.disabled=false;p.select()};
</script></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const miss = missing();
  if (miss.length) return res.status(500).send("Missing in Vercel Environment Variables: " + miss.join(", "));
  try {
    await setup();
    if (req.method === "GET") {
      const ok = await signedIn(req), f = String(req.query?.f || "");
      if (f) {   // a picture of the lobby
        const m = /^[a-z0-9_-]+\.([a-z]+)$/i.exec(f), ty = m && TYPES[m[1].toLowerCase()];
        if (!ok) return res.status(401).send("Not signed in");
        if (!ty) return res.status(404).send("Not found");
        try { res.setHeader("Content-Type", ty); return res.status(200).send(file("png/" + f)) } catch (e) { return res.status(404).send("Not found") }
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(ok ? file("index.html") : SIGNIN);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.logout) {
      const t = tok(req);
      if (t) await client().execute({ sql: "DELETE FROM lobby_sessions WHERE h = ?", args: [hash(t)] });
      res.setHeader("Set-Cookie", cookie("", 0));
      return res.status(200).json({ ok: true });
    }
    if (typeof b.login !== "string") return res.status(400).json({ error: "Nothing to do" });
    if (!pwWant()) return res.status(500).json({ error: "Missing in Vercel Environment Variables: LOBBY_PASSWORD" });
    const ip = ipOf(req).slice(0, 64), now = Math.floor(Date.now() / 1000);
    const fl = (await client().execute({ sql: "SELECT n, until FROM lobby_fails WHERE ip = ?", args: [ip] })).rows[0];
    if (fl && Number(fl.until) > now) return res.status(429).json({ error: `Çok fazla yanlış deneme · ${Math.ceil((Number(fl.until) - now) / 60)} dk sonra tekrar dene` });
    if (!samePw(b.login)) {
      const n = (fl ? Number(fl.n) : 0) + 1, lock = n >= TRIES;
      await client().execute({ sql: "INSERT INTO lobby_fails (ip, n, until) VALUES (?, ?, ?) ON CONFLICT (ip) DO UPDATE SET n = excluded.n, until = excluded.until",
        args: [ip, lock ? 0 : n, lock ? now + LOCK : 0] });
      return res.status(401).json({ error: lock ? "Yanlış şifre · 15 dakika kilitlendi" : "Yanlış şifre" });
    }
    const t = randomBytes(32).toString("hex");
    await client().batch([
      { sql: "DELETE FROM lobby_fails WHERE ip = ?", args: [ip] },
      { sql: "INSERT INTO lobby_sessions (h) VALUES (?)", args: [hash(t)] }
    ], "write");
    res.setHeader("Set-Cookie", cookie(t, AGE));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error: " + String(e?.message || e).slice(0, 200) });
  }
}
