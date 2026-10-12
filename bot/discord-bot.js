/**
 * Discord bot: /add /remove /massadd /massremove
 * Saves to LIVE Netlify site — stays after bot is off.
 * Run: npm run bot
 */
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} = require("discord.js");
const {
  setBadges,
  parseEmojiInput,
  parseManyEmojis,
} = require("./store");

const OWNER_ID = String(process.env.OWNER_ID || "").trim();
const TOKEN = process.env.DISCORD_TOKEN;
const PRODUCTION_API_URL = String(
  process.env.PRODUCTION_API_URL || "https://slits.lol"
)
  .trim()
  .replace(/\/+$/, "");
const BADGE_API_SECRET = String(process.env.BADGE_API_SECRET || "").trim();

async function fetchLiveBadges() {
  const res = await fetch(PRODUCTION_API_URL + "/api/badges", {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) {
    throw new Error(
      "Live /api/badges 404 — Netlify drag-drop does not deploy the API. Run DEPLOY-NETLIFY.bat once, then retry."
    );
  }
  if (!res.ok) throw new Error("GET live badges " + res.status);
  const body = await res.json();
  return Array.isArray(body.badges) ? body.badges : [];
}

async function pushLiveBadges(list) {
  if (!BADGE_API_SECRET) {
    return { ok: false, error: "BADGE_API_SECRET missing in bot/.env" };
  }
  const res = await fetch(PRODUCTION_API_URL + "/api/badges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Badge-Secret": BADGE_API_SECRET,
      Accept: "application/json",
    },
    body: JSON.stringify({ action: "sync", badges: list }),
  });
  const text = await res.text();
  if (!res.ok) {
    let hint = text;
    if (res.status === 405) {
      hint = "Live site old API (405). Redeploy latest zip on Netlify.";
    } else if (res.status === 401) {
      hint =
        "Unauthorized. Set BADGE_API_SECRET on Netlify (same as bot/.env) and redeploy.";
    }
    return { ok: false, status: res.status, error: hint };
  }
  console.log("LIVE SAVED →", PRODUCTION_API_URL, "badges:", list.length);
  // Local + static backups so emojis survive bot offline / Blobs wipe
  try {
    setBadges(list);
  } catch (_) {}
  try {
    const fs = require("fs");
    const path = require("path");
    const json = JSON.stringify(list, null, 2) + "\n";
    fs.writeFileSync(path.join(__dirname, "data", "custom-badges.json"), json);
    fs.writeFileSync(path.join(__dirname, "..", "badges.json"), json);
    fs.writeFileSync(
      path.join(__dirname, "..", "netlify", "functions", "badges-seed.json"),
      json
    );
  } catch (err) {
    console.warn("Could not write local badge backups:", err.message);
  }
  return { ok: true };
}

function badgeFromAttachment(att) {
  if (!att) return null;
  const url = String(att.url || att.proxyURL || "").trim();
  if (!url) return null;
  const name =
    String(att.name || "sticker")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9_]/g, "")
      .slice(0, 32) || "sticker";
  const id = String(att.id || name);
  const animated = /\.gif($|\?)/i.test(url);
  return {
    id: "att_" + id,
    name,
    animated,
    url,
    addedAt: new Date().toISOString(),
  };
}

function matchesRemoveQuery(b, parsed, raw) {
  if (parsed && parsed.id && String(b.id) === String(parsed.id)) return true;
  const q = String((parsed && parsed.name) || raw || "")
    .replace(/^:/, "")
    .replace(/:$/, "")
    .toLowerCase();
  if (!q) return false;
  if (String(b.name || "").toLowerCase() === q) return true;
  if (String(b.id || "").toLowerCase() === q) return true;
  return false;
}

function collectRemoveQueries(raw) {
  const s = String(raw || "");
  const queries = [];
  const custom = parseManyEmojis(s);
  for (const c of custom) queries.push(c);

  const stripped = s.replace(/<(a?):([a-zA-Z0-9_]+):(\d{15,22})>/g, " ");
  const parts = stripped.split(/[\s,;]+/).filter(Boolean);
  for (const p of parts) {
    const parsed = parseEmojiInput(p);
    if (parsed) queries.push(parsed);
  }
  return queries;
}

if (!TOKEN) {
  console.error("DISCORD_TOKEN missing in bot/.env");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (c) => {
  console.log("Discord bot ready as", c.user.tag);
  console.log("LIVE TARGET →", PRODUCTION_API_URL);
  console.log("Commands: /add /remove /massadd /massremove");

  // If live store was wiped (redeploy), push local cache back up
  try {
    const live = await fetchLiveBadges();
    const local = require("./store").getBadges();
    if ((!live || !live.length) && local && local.length) {
      console.log("Live badges empty — restoring", local.length, "from local cache...");
      const sync = await pushLiveBadges(local);
      if (sync.ok) console.log("Restored", local.length, "badges to live site.");
      else console.error("Restore failed:", sync.error);
    } else {
      console.log("Live badges:", (live && live.length) || 0);
    }
  } catch (err) {
    console.error("Startup badge check failed:", err.message || err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const name = interaction.commandName;
  if (!["add", "remove", "massadd", "massremove"].includes(name)) return;

  if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
    await interaction.reply({
      content: "Only the site owner can manage badge emojis.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    let list = await fetchLiveBadges();

    if (name === "add") {
      const raw = interaction.options.getString("emoji");
      const att = interaction.options.getAttachment("sticker");
      let badge = null;

      if (att) badge = badgeFromAttachment(att);
      else if (raw) {
        const parsed = parseEmojiInput(raw);
        if (parsed && parsed.id && parsed.url) {
          badge = {
            id: parsed.id,
            name: parsed.name,
            animated: !!parsed.animated,
            url: parsed.url,
            addedAt: new Date().toISOString(),
          };
        }
      }

      if (!badge) {
        await interaction.editReply(
          "Provide a **custom emoji** or attach a **sticker/image**."
        );
        return;
      }
      if (list.some((b) => String(b.id) === String(badge.id))) {
        await interaction.editReply(`:${badge.name}: is already on the live site.`);
        return;
      }
      list.push(badge);
      const sync = await pushLiveBadges(list);
      if (!sync.ok) {
        await interaction.editReply("Live save failed: " + sync.error);
        return;
      }
      await interaction.editReply(
        `Saved :${badge.name}: (${list.length} custom). Stays with bot off.`
      );
      return;
    }

    if (name === "massadd") {
      const raw = interaction.options.getString("emojis", true);
      const found = parseManyEmojis(raw);
      if (!found.length) {
        await interaction.editReply(
          "No custom emojis found. Paste several like `:one: :two: :three:` from your server."
        );
        return;
      }
      let added = 0;
      for (const e of found) {
        if (list.some((b) => String(b.id) === String(e.id))) continue;
        list.push({
          id: e.id,
          name: e.name,
          animated: !!e.animated,
          url: e.url,
          addedAt: new Date().toISOString(),
        });
        added++;
      }
      if (!added) {
        await interaction.editReply(
          `All ${found.length} emoji(s) were already on the live site.`
        );
        return;
      }
      const sync = await pushLiveBadges(list);
      if (!sync.ok) {
        await interaction.editReply("Live save failed: " + sync.error);
        return;
      }
      await interaction.editReply(
        `Mass-added **${added}** emoji(s) (${list.length} custom total). Stays with bot off.`
      );
      return;
    }

    if (name === "remove") {
      const raw = interaction.options.getString("emoji", true);
      const parsed = parseEmojiInput(raw);
      const before = list.length;
      list = list.filter((b) => !matchesRemoveQuery(b, parsed, raw));
      if (list.length === before) {
        await interaction.editReply("That item was not on the live site.");
        return;
      }
      const sync = await pushLiveBadges(list);
      if (!sync.ok) {
        await interaction.editReply("Live save failed: " + sync.error);
        return;
      }
      await interaction.editReply(
        `Removed (${list.length} custom left). Stays with bot off.`
      );
      return;
    }

    if (name === "massremove") {
      const raw = interaction.options.getString("emojis", true);
      const queries = collectRemoveQueries(raw);
      if (!queries.length) {
        await interaction.editReply(
          "Could not parse any emojis/names to remove."
        );
        return;
      }
      const before = list.length;
      list = list.filter((b) => {
        for (const q of queries) {
          if (matchesRemoveQuery(b, q, q.name || q.id || "")) return false;
        }
        return true;
      });
      const removed = before - list.length;
      if (!removed) {
        await interaction.editReply("None of those were on the live site.");
        return;
      }
      const sync = await pushLiveBadges(list);
      if (!sync.ok) {
        await interaction.editReply("Live save failed: " + sync.error);
        return;
      }
      await interaction.editReply(
        `Mass-removed **${removed}** (${list.length} custom left). Stays with bot off.`
      );
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply(
      "Error: " + (err && err.message ? err.message : err)
    );
  }
});

client.login(TOKEN).catch((err) => {
  console.error("Discord login failed:", err.message);
  process.exit(1);
});
