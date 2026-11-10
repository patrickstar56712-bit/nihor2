/* The Discord bot: answers with Gemini when someone tags it.
   Runs on its own computer (npm start). Settings come from preju.vercel.app/discord every 30 s. */
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { GoogleGenAI } from "@google/genai";

const { DISCORD_TOKEN, GEMINI_API_KEY, BOT_KEY, SITE = "https://preju.vercel.app" } = process.env;
for (const [k, v] of Object.entries({ DISCORD_TOKEN, GEMINI_API_KEY, BOT_KEY })) if (!v) { console.error(`Missing in .env: ${k}`); process.exit(1); }

const DEFAULT_PROMPT = `You are a witty, helpful AI living in a Discord server of friends, similar to Grok on X.
Answer in the language the user writes in. Be short and casual unless asked for detail. Use Discord markdown.
You see the recent chat and, if the user replied to a message, that message too: use them to understand what they mean.
Never ping @everyone or @here.`;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});
let cfg = { enabled: true, model: "gemini-2.5-flash", prompt: "", history: 15, search: true, channels: "", cooldown: 5 };

const api = (path, init = {}) => fetch(SITE + "/api/discord?bot=1" + path, { ...init, headers: { "x-bot-key": BOT_KEY, "Content-Type": "application/json" } })
  .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); });

async function sync() {
  try {
    const guilds = bot.guilds.cache.map(g => ({ id: g.id, name: g.name, members: g.memberCount }));
    const r = await api("", { method: "POST", body: JSON.stringify({ beat: { tag: bot.user?.tag || "", guilds } }) });
    cfg = { ...cfg, ...r.config };
  } catch (e) { console.error("Site sync:", e.message); }
}

/* errors also go to the panel's Errors list */
function report(where, e) {
  console.error(where, e);
  api("", { method: "POST", body: JSON.stringify({ error: { where, msg: String(e?.stack || e?.message || e) } }) }).catch(() => {});
}
process.on("unhandledRejection", e => report("unhandledRejection", e));
process.on("uncaughtException", e => report("uncaughtException", e));
bot.on("error", e => report("discord", e));
bot.on("shardDisconnect", (ev, id) => report("discord", "Disconnected (code " + ev.code + "), reconnecting…"));
bot.on("guildCreate", () => sync());
bot.on("guildDelete", () => sync());

const nameOf = m => m.member?.displayName || m.author.globalName || m.author.username;
const lastUse = new Map();

async function images(m) {
  const out = [];
  for (const a of m.attachments.values()) {
    if (!a.contentType?.startsWith("image/") || a.size > 8e6 || out.length >= 4) continue;
    const buf = Buffer.from(await (await fetch(a.url)).arrayBuffer());
    out.push({ inlineData: { mimeType: a.contentType.split(";")[0], data: buf.toString("base64") } });
  }
  return out;
}

bot.on("messageCreate", async m => {
  if (m.author.bot || !cfg.enabled || !m.guild) return;
  if (!m.mentions.users.has(bot.user.id)) return;
  const only = cfg.channels.split(/[,\s]+/).filter(Boolean);
  if (only.length && !only.includes(m.channel.id) && !only.includes(m.channel.parentId)) return;
  const now = Date.now(), last = lastUse.get(m.author.id) || 0;
  if (now - last < cfg.cooldown * 1000) return m.react("⏳").catch(() => {});
  lastUse.set(m.author.id, now);

  try {
    await m.channel.sendTyping();
    const question = m.content.replace(new RegExp(`<@!?${bot.user.id}>`, "g"), "").trim();
    const prev = cfg.history ? await m.channel.messages.fetch({ limit: cfg.history, before: m.id }).catch(() => null) : null;
    const chat = prev ? [...prev.values()].reverse().map(x => `${nameOf(x)}: ${x.cleanContent}`).join("\n") : "";
    const ref = m.reference?.messageId ? await m.fetchReference().catch(() => null) : null;

    const text = [
      chat && `Recent chat in #${m.channel.name}:\n${chat}`,
      ref && `${nameOf(m)} is replying to this message from ${nameOf(ref)}:\n"${ref.cleanContent}"`,
      `${nameOf(m)} tagged you and says: ${question || "(nothing, just the tag: react to the replied message or the chat)"}`
    ].filter(Boolean).join("\n\n");
    const parts = [{ text }, ...(ref ? await images(ref) : []), ...await images(m)];

    const r = await ai.models.generateContent({
      model: cfg.model,
      contents: [{ role: "user", parts }],
      config: { systemInstruction: cfg.prompt || DEFAULT_PROMPT, ...(cfg.search ? { tools: [{ googleSearch: {} }] } : {}) }
    });
    const answer = (r.text || "").trim() || "🤔";

    const chunks = answer.match(/[\s\S]{1,1990}/g);
    await m.reply({ content: chunks[0], allowedMentions: { parse: [], repliedUser: true } });
    for (const c of chunks.slice(1)) await m.channel.send({ content: c, allowedMentions: { parse: [] } });

    api("", { method: "POST", body: JSON.stringify({ log: { user: m.author.username, channel: m.channel.name, q: question, a: answer } }) }).catch(() => {});
  } catch (e) {
    report(`answer in #${m.channel.name} (${m.guild.name})`, e);
    m.reply({ content: "Something went wrong: " + String(e.message).slice(0, 300), allowedMentions: { parse: [] } }).catch(() => {});
  }
});

bot.once("clientReady", () => {
  console.log(`Online as ${bot.user.tag}`);
  sync();
  setInterval(sync, 30_000);
});
bot.login(DISCORD_TOKEN);
