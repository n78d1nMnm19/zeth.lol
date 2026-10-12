const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA = path.join(__dirname, "data");
const TOKEN_PATH = path.join(DATA, "nowplaying-token.txt");
const STATE_PATH = path.join(DATA, "nowplaying.json");

function ensureDir() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
}

function getToken() {
  const env = String(process.env.NOWPLAYING_TOKEN || "").trim();
  if (env) return env;
  try {
    if (fs.existsSync(TOKEN_PATH)) return fs.readFileSync(TOKEN_PATH, "utf8").trim();
  } catch {
    /* ignore */
  }
  return "";
}

function ensureToken() {
  let t = getToken();
  if (t) return t;
  ensureDir();
  t = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(TOKEN_PATH, t, "utf8");
  return t;
}

function getState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function setState(data) {
  ensureDir();
  if (!data) {
    try {
      fs.unlinkSync(STATE_PATH);
    } catch {
      /* ignore */
    }
    return null;
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(data), "utf8");
  return data;
}

function toListening(np) {
  if (!np || !np.updatedAt) {
    return { listening: false, track: null, fresh: false, via: "bridge", configured: !!getToken(), ok: true };
  }
  const ageMs = Date.now() - Number(np.updatedAt);
  if (ageMs > 5000 || !np.playing || !np.title) {
    return {
      listening: false,
      track: null,
      fresh: false,
      via: "bridge",
      configured: true,
      ok: true,
      stale: ageMs > 8000,
    };
  }
  const durationSec = Number(np.durationSec) || 0;
  const positionSec = Math.max(0, Number(np.positionSec) || 0);
  const start = Date.now() - positionSec * 1000;
  return {
    listening: true,
    fresh: ageMs < 2000,
    via: "bridge",
    configured: true,
    ok: true,
    track: {
      source: "youtube music",
      title: String(np.title || ""),
      artist: String(np.artist || ""),
      album: String(np.album || ""),
      art: String(np.art || ""),
      videoId: String(np.videoId || ""),
      start,
      end: durationSec > 0 ? start + durationSec * 1000 : 0,
      durationSec,
      key: "ytm:" + (np.videoId || np.title),
    },
  };
}

module.exports = { getToken, ensureToken, getState, setState, toListening };
