/**
 * Shared local JSON store (views + custom badges).
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const VIEWS_FILE = path.join(DATA_DIR, "views.json");
const BADGES_FILE = path.join(DATA_DIR, "custom-badges.json");

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(VIEWS_FILE)) {
    fs.writeFileSync(VIEWS_FILE, JSON.stringify({ count: 0 }, null, 2));
  }
  if (!fs.existsSync(BADGES_FILE)) {
    fs.writeFileSync(BADGES_FILE, "[]\n");
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function getViews() {
  const data = readJson(VIEWS_FILE, { count: 0 });
  const n = Number(data.count);
  const floor = Number(process.env.VIEWS_START_AT || 3635);
  const base = Number.isFinite(floor) && floor > 0 ? Math.floor(floor) : 0;
  const v = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  return Math.max(v, base);
}

function setViews(n) {
  const floor = Number(process.env.VIEWS_START_AT || 3635);
  const base = Number.isFinite(floor) && floor > 0 ? Math.floor(floor) : 0;
  const next = Math.max(base, Math.floor(Number(n) || 0));
  writeJson(VIEWS_FILE, { count: next });
  return next;
}

function bumpViews() {
  return setViews(getViews() + 1);
}

function getBadges() {
  const list = readJson(BADGES_FILE, []);
  return Array.isArray(list) ? list : [];
}

function setBadges(list) {
  writeJson(BADGES_FILE, list);
  return list;
}

/** Parse <:name:id> or <a:name:id> or bare snowflake / name */
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

/** Pull every custom emoji token out of a blob of text */
function parseManyEmojis(raw) {
  const s = String(raw || "");
  const out = [];
  const seen = new Set();
  const re = /<(a?):([a-zA-Z0-9_]+):(\d{15,22})>/g;
  let m;
  while ((m = re.exec(s))) {
    const animated = m[1] === "a";
    const name = m[2];
    const id = m[3];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      animated,
      url:
        "https://cdn.discordapp.com/emojis/" +
        id +
        (animated ? ".gif" : ".png") +
        "?size=64&quality=lossless",
    });
  }
  return out;
}

ensureDataFiles();

module.exports = {
  getViews,
  bumpViews,
  getBadges,
  setBadges,
  parseEmojiInput,
  parseManyEmojis,
};
