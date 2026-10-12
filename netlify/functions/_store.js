/**
 * Shared store for views + custom badges (Netlify Blobs).
 * If Blobs is empty (redeploy wipe), seed from badges-seed.json so
 * emojis stay visible even when the Discord bot is offline.
 */
const fs = require("fs");
const path = require("path");
const { getStore } = require("@netlify/blobs");

const mem = {
  views: 0,
  badges: [],
};

function store() {
  try {
    return getStore("zeth-site");
  } catch {
    return null;
  }
}

function loadSeedBadges() {
  try {
    const seedPath = path.join(__dirname, "badges-seed.json");
    if (!fs.existsSync(seedPath)) return [];
    const data = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function getViews() {
  const floor = Number(process.env.VIEWS_START_AT || 3635);
  const base = Number.isFinite(floor) && floor > 0 ? Math.floor(floor) : 0;
  const s = store();
  if (!s) return Math.max(mem.views || 0, base);
  const raw = await s.get("views");
  if (raw == null) return base;
  const n = Number(typeof raw === "string" ? JSON.parse(raw).count ?? raw : raw.count);
  const v = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  return Math.max(v, base);
}

async function setViews(n) {
  const floor = Number(process.env.VIEWS_START_AT || 3635);
  const base = Number.isFinite(floor) && floor > 0 ? Math.floor(floor) : 0;
  const count = Math.max(base, Math.floor(Number(n) || 0));
  const s = store();
  if (s) await s.setJSON("views", { count });
  else mem.views = count;
  return count;
}

async function bumpViews() {
  const next = (await getViews()) + 1;
  return setViews(next);
}

async function getBadges() {
  const s = store();
  let data = undefined;
  let found = false;
  if (s) {
    try {
      data = await s.get("badges", { type: "json" });
      // null/undefined = key missing; [] is an intentional clear
      found = data !== null && data !== undefined;
    } catch {
      found = false;
      data = undefined;
    }
  } else {
    found = true;
    data = mem.badges;
  }

  if (found) return Array.isArray(data) ? data : [];

  // Blobs key missing / wiped → use seed baked into the deploy (bot not needed)
  const seed = loadSeedBadges();
  if (seed.length) {
    if (s) {
      try {
        await s.setJSON("badges", seed);
      } catch {
        /* ignore */
      }
    } else {
      mem.badges = seed.slice();
    }
    return seed;
  }

  return [];
}

async function setBadges(list) {
  const clean = Array.isArray(list) ? list : [];
  const s = store();
  if (s) await s.setJSON("badges", clean);
  else mem.badges = clean.slice();
  return clean;
}

function parseEmojiInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const custom = s.match(/^<(a?):([a-zA-Z0-9_]+):(\d{15,22})>$/);
  if (custom) {
    const animated = custom[1] === "a";
    const name = custom[2];
    const id = custom[3];
    return {
      id,
      name,
      animated,
      url:
        "https://cdn.discordapp.com/emojis/" +
        id +
        (animated ? ".gif" : ".png") +
        "?size=64&quality=lossless",
    };
  }

  if (/^\d{15,22}$/.test(s)) {
    return {
      id: s,
      name: s,
      animated: false,
      url: "https://cdn.discordapp.com/emojis/" + s + ".png?size=64&quality=lossless",
    };
  }

  const nameOnly = s.replace(/^:/, "").replace(/:$/, "");
  if (/^[a-zA-Z0-9_]{2,32}$/.test(nameOnly)) {
    return { name: nameOnly, id: null, animated: false, url: null };
  }

  return null;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Badge-Secret, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

module.exports = {
  getViews,
  setViews,
  bumpViews,
  getBadges,
  setBadges,
  parseEmojiInput,
  json,
};
