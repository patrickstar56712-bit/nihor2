/* O mu? Bu mu? rooms: the rules, on plain room objects (api/lobby.js loads and saves them; a leading "_" keeps Vercel from serving this file).
   A room: {code, t: tournament id, n: its item count, size, host: player id, st: "lobby" | "play" | "end",
            players: [{id, name, av, seen}], round: [item index], next: [..], k: pair index,
            votes: {playerId: 0 | 1}, rev: time the votes were shown (0 = not yet), last: {a, b, w, votes} the pair before, champ, v: version}
   Everyone votes on each pair; when every player who is here has voted the votes show for a moment, then the pick
   with more votes goes on (a tie: one of them at random). */

export const MAXP = 16, GONE = 20000, SHOW = 2500, SIZES = [4, 8, 16, 32, 64, 128, 256];
const CODE_CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newCode = () => Array.from({ length: 5 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join("");
const shuf = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a };

/* a player as the page sends it: id from the tab, a name and an avatar number */
export function cleanMe(m) {
  const id = String(m?.id || ""), name = String(m?.name || "").trim().replace(/\s+/g, " "), av = Math.max(0, Math.min(63, Math.floor(+m?.av || 0)));
  if (!/^[a-z0-9]{8,32}$/.test(id)) return null;
  if (name.length < 2 || name.length > 20) return null;
  return { id, name, av };
}
const here = (r, now) => r.players.filter(p => now - p.seen < GONE);

export function create(me, t, n, size, now) {
  n = Math.floor(+n); size = Math.floor(+size);
  if (!/^[a-z0-9-]{1,40}$/.test(String(t)) || !(n >= 2 && n <= 1000) || !SIZES.includes(size) || size > n) throw new Error("Geçersiz turnuva");
  return { code: newCode(), t: String(t), n, size, host: me.id, st: "lobby", players: [{ ...me, seen: now }], round: [], next: [], k: 0, votes: {}, rev: 0, last: null, champ: null, v: 0, created: now };
}

/* the rules for one request from a player; returns an error text or "" */
export function op(r, me, o, now) {
  const p = r.players.find(x => x.id === me.id);
  if (o.op === "join") {
    if (p) { p.name = me.name; p.av = me.av; p.seen = now; return "" }
    for (const x of r.players) if (now - x.seen >= GONE) x.gone = 1;
    r.players = r.players.filter(x => !x.gone);
    if (r.players.length >= MAXP) return "Oda dolu";
    if (r.players.some(x => x.name.toLowerCase() === me.name.toLowerCase())) return "Bu ad odada var, başka bir ad seç";
    r.players.push({ ...me, seen: now });
    if (!r.players.some(x => x.id === r.host)) r.host = me.id;
    return "";
  }
  if (!p) return "Bu odada değilsin";
  p.seen = now;
  if (o.op === "leave") {
    r.players = r.players.filter(x => x.id !== me.id);
    delete r.votes[me.id];
    if (r.host === me.id && r.players.length) r.host = r.players[0].id;
    return "";
  }
  if (o.op === "vote") {
    if (r.st !== "play" || r.rev) return "";
    r.votes[me.id] = o.side ? 1 : 0;
    return "";
  }
  if (r.host !== me.id) return "Bunu sadece oda sahibi yapabilir";
  if (o.op === "start") {
    if (r.st === "play") return "";
    r.round = shuf(Array.from({ length: r.n }, (_, i) => i)).slice(0, r.size);
    r.next = []; r.k = 0; r.votes = {}; r.rev = 0; r.last = null; r.champ = null; r.st = "play";
    return "";
  }
  if (o.op === "lobby") { r.st = "lobby"; r.round = []; r.next = []; r.k = 0; r.votes = {}; r.rev = 0; r.last = null; r.champ = null; return "" }
  if (o.op === "skip") { if (r.st === "play" && !r.rev) r.rev = now; return "" }   // the host goes on without the missing votes
  return "Bilinmeyen işlem";
}

/* time passing: players who left drop out, votes show once everyone here voted, then the pair is decided.
   Returns true when the room changed. */
export function tick(r, now) {
  let ch = false;
  const hosted = r.players.some(x => x.id === r.host && now - x.seen < GONE);
  if (!hosted) { const h = here(r, now)[0]; if (h && h.id !== r.host) { r.host = h.id; ch = true } }
  if (r.st !== "play") return ch;
  const live = here(r, now);
  if (!r.rev && live.length && live.every(x => r.votes[x.id] !== undefined)) { r.rev = now; ch = true }
  if (r.rev && now - r.rev >= SHOW) {
    const a = r.round[r.k * 2], b = r.round[r.k * 2 + 1], vs = Object.values(r.votes);
    const n0 = vs.filter(v => v === 0).length, n1 = vs.length - n0;
    const w = n0 > n1 ? a : n1 > n0 ? b : (Math.random() < .5 ? a : b);
    r.last = { a, b, w, votes: { ...r.votes } };
    r.next.push(w); r.k++; r.votes = {}; r.rev = 0;
    if (r.k * 2 >= r.round.length) { r.round = r.next; r.next = []; r.k = 0 }
    if (r.round.length === 1) { r.champ = r.round[0]; r.st = "end" }
    ch = true;
  }
  return ch;
}

/* what the page sees */
/* what the page sees: who voted shows at once, what they voted only once the votes are shown */
export const view = (r, now) => ({ ...r, now, votes: r.rev ? r.votes : Object.fromEntries(Object.keys(r.votes).map(k => [k, -1])),
  players: r.players.map(p => ({ id: p.id, name: p.name, av: p.av, here: now - p.seen < GONE })) });
