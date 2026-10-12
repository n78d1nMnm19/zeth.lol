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
  ytmusicAuth: null,
  ytmusicListen: null,
  nowPlaying: null,
  nowPlayingToken: null,
  spotifyAuth: null,
  spotifyListen: null,
  lyricsCache: {},
};

function store() {
  try {
    // Prefer strong consistency; fall back if the runtime rejects it
    try {
      return getStore({ name: "zeth-site", consistency: "strong" });
    } catch {
      return getStore("zeth-site");
    }
  } catch (e) {
    console.error("[store] getStore failed", e && e.message);
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
      "Access-Control-Allow-Headers":
        "Content-Type, X-Badge-Secret, Authorization, X-Nowplaying-Token",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

async function getYtMusicAuth() {
  const s = store();
  if (!s) return mem.ytmusicAuth || null;
  try {
    let data = null;
    if (typeof s.getJSON === "function") {
      data = await s.getJSON("ytmusic-auth");
    } else {
      const raw = await s.get("ytmusic-auth");
      if (raw == null) data = null;
      else data = typeof raw === "string" ? JSON.parse(raw) : raw;
    }
    if (!data || !data.cookie) return mem.ytmusicAuth || null;
    mem.ytmusicAuth = data;
    return data;
  } catch (e) {
    console.error("[store] getYtMusicAuth", e && e.message);
    return mem.ytmusicAuth || null;
  }
}

async function setYtMusicAuth(auth) {
  const data = {
    cookie: String((auth && auth.cookie) || "").trim(),
    authUser: String((auth && auth.authUser) || "0"),
    updatedAt: new Date().toISOString(),
  };
  mem.ytmusicAuth = data;
  const s = store();
  if (!s) {
    console.error("[store] setYtMusicAuth: no blob store");
    return data;
  }
  try {
    if (typeof s.setJSON === "function") {
      await s.setJSON("ytmusic-auth", data);
    } else {
      await s.set("ytmusic-auth", JSON.stringify(data));
    }
  } catch (e) {
    console.error("[store] setYtMusicAuth failed", e && e.message);
    throw e;
  }
  return data;
}

async function getYtMusicListenState() {
  const s = store();
  if (!s) return mem.ytmusicListen || null;
  try {
    const raw = await s.get("ytmusic-listen");
    if (!raw) return mem.ytmusicListen || null;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    mem.ytmusicListen = data;
    return data;
  } catch {
    return mem.ytmusicListen || null;
  }
}

async function setYtMusicListenState(state) {
  mem.ytmusicListen = state || null;
  const s = store();
  if (!s) return;
  if (!state) {
    try {
      await s.delete("ytmusic-listen");
    } catch {
      /* ignore */
    }
    return;
  }
  await s.set("ytmusic-listen", JSON.stringify(state));
}

function randomToken() {
  const bytes = require("crypto").randomBytes(24);
  return bytes.toString("hex");
}

async function getNowPlayingToken() {
  // Env wins — same value in every function instance (required for bridge auth)
  const env = String(process.env.NOWPLAYING_TOKEN || "").trim();
  if (env) {
    mem.nowPlayingToken = env;
    return env;
  }
  if (mem.nowPlayingToken) return mem.nowPlayingToken;
  const s = store();
  if (s) {
    try {
      const raw = await s.get("nowplaying-token");
      if (raw) {
        const tok = String(typeof raw === "string" ? raw : raw.token || raw).trim();
        if (tok) {
          mem.nowPlayingToken = tok;
          return tok;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

async function ensureNowPlayingToken() {
  let tok = await getNowPlayingToken();
  if (tok) return tok;
  tok = randomToken();
  mem.nowPlayingToken = tok;
  const s = store();
  if (s) {
    try {
      await s.set("nowplaying-token", tok);
    } catch (e) {
      console.error("[store] token persist failed", e && e.message);
    }
  }
  return tok;
}

async function getNowPlaying() {
  const s = store();
  if (!s) return mem.nowPlaying || null;
  try {
    let data = null;
    if (typeof s.getJSON === "function") {
      data = await s.getJSON("nowplaying");
    } else {
      const raw = await s.get("nowplaying");
      if (raw == null) data = null;
      else data = typeof raw === "string" ? JSON.parse(raw) : raw;
    }
    if (data) mem.nowPlaying = data;
    return data || mem.nowPlaying || null;
  } catch (e) {
    console.error("[store] getNowPlaying failed", e && e.message);
    return mem.nowPlaying || null;
  }
}

async function setNowPlaying(data) {
  mem.nowPlaying = data || null;
  const s = store();
  if (!s) {
    console.error("[store] setNowPlaying: no blob store — state won't share across functions");
    return data;
  }
  if (!data) {
    try {
      await s.delete("nowplaying");
    } catch {
      /* ignore */
    }
    return null;
  }
  try {
    if (typeof s.setJSON === "function") {
      await s.setJSON("nowplaying", data);
    } else {
      await s.set("nowplaying", JSON.stringify(data));
    }
  } catch (e) {
    console.error("[store] setNowPlaying failed", e && e.message);
    throw e;
  }
  return data;
}

/** Fresh push from the browser bridge (seconds). Heartbeats every ~0.5–1s. */
const NOWPLAYING_FRESH_SEC = 12;

function nowPlayingToListening(np) {
  if (!np || !np.updatedAt) {
    return { listening: false, track: null, fresh: false, source: "bridge" };
  }
  const ageMs = Date.now() - Number(np.updatedAt);
  if (ageMs > NOWPLAYING_FRESH_SEC * 1000) {
    return {
      listening: false,
      track: null,
      fresh: false,
      source: "bridge",
      stale: true,
      configured: true,
      ok: true,
    };
  }
  if (!np.playing || !np.title) {
    return {
      listening: false,
      track: null,
      fresh: false,
      source: "bridge",
      configured: true,
      ok: true,
    };
  }
  const durationSec = Number(np.durationSec) || 0;
  const positionSec = Math.max(0, Number(np.positionSec) || 0);
  const start = Date.now() - positionSec * 1000;
  const end = durationSec > 0 ? start + durationSec * 1000 : 0;
  return {
    listening: true,
    fresh: ageMs < 2000,
    source: "bridge",
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
      end,
      durationSec,
      key: "ytm:" + (np.videoId || np.title),
    },
  };
}

async function readBlobJson(s, key) {
  if (!s) return null;
  try {
    if (typeof s.getJSON === "function") {
      const j = await s.getJSON(key);
      if (j) return j;
    }
  } catch {
    /* fall through */
  }
  try {
    const raw = await s.get(key);
    if (raw == null) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function getSpotifyAuth() {
  const envId = String(process.env.SPOTIFY_CLIENT_ID || "").trim();
  const envSecret = String(process.env.SPOTIFY_CLIENT_SECRET || "").trim();
  const envRefresh = String(process.env.SPOTIFY_REFRESH_TOKEN || "").trim();

  const s = store();
  let blob = (await readBlobJson(s, "spotify-auth")) || (await readBlobJson(s, "spotify-auth-backup"));
  if (!blob) blob = mem.spotifyAuth;

  const clientId = (blob && blob.clientId) || envId;
  const clientSecret = (blob && blob.clientSecret) || envSecret;
  const refreshToken = (blob && blob.refreshToken) || envRefresh;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    refreshToken: refreshToken || "",
    updatedAt: (blob && blob.updatedAt) || null,
  };
}

async function setSpotifyAuth(auth) {
  const prev = (await getSpotifyAuth()) || {};
  const data = {
    clientId: String((auth && auth.clientId) || prev.clientId || "").trim(),
    clientSecret: String((auth && auth.clientSecret) || prev.clientSecret || "").trim(),
    refreshToken: String(
      (auth && auth.refreshToken != null ? auth.refreshToken : prev.refreshToken) || ""
    ).trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!data.clientId || !data.clientSecret) {
    throw new Error("clientId and clientSecret required to save Spotify auth");
  }
  mem.spotifyAuth = data;
  const s = store();
  if (!s) {
    console.error("[store] setSpotifyAuth: blobs unavailable — credentials only in memory");
    return data;
  }
  try {
    const raw = JSON.stringify(data);
    // Write twice (JSON + string) — some runtimes only honor one path
    if (typeof s.setJSON === "function") await s.setJSON("spotify-auth", data);
    await s.set("spotify-auth", raw);
    await s.set("spotify-auth-backup", raw);
    let check = null;
    try {
      if (typeof s.getJSON === "function") check = await s.getJSON("spotify-auth");
    } catch {
      check = null;
    }
    if (!check) {
      const r2 = await s.get("spotify-auth");
      check = r2 == null ? null : typeof r2 === "string" ? JSON.parse(r2) : r2;
    }
    if (!check || check.clientId !== data.clientId) {
      console.error("[store] setSpotifyAuth: read-back mismatch", !!check);
    }
  } catch (e) {
    console.error("[store] setSpotifyAuth failed", e && e.message);
    throw e;
  }
  return data;
}

/** Last Spotify track cache — survives empty API blips; no owner tab required. */
/** Short TTL so skips aren't stuck on the previous song during Spotify 204 gaps */
const SPOTIFY_LISTEN_TTL_MS = 5 * 1000;

async function getSpotifyListenCache() {
  const s = store();
  let data = null;
  if (s) {
    try {
      if (typeof s.getJSON === "function") data = await s.getJSON("spotify-listen");
      else {
        const raw = await s.get("spotify-listen");
        data = raw == null ? null : typeof raw === "string" ? JSON.parse(raw) : raw;
      }
    } catch {
      data = null;
    }
  }
  if (!data) data = mem.spotifyListen;
  if (!data || !data.track || !data.at) return null;
  if (Date.now() - Number(data.at) > SPOTIFY_LISTEN_TTL_MS) return null;
  return data;
}

async function setSpotifyListenCache(payload) {
  const data = payload
    ? {
        at: Date.now(),
        listening: !!payload.listening,
        paused: !!payload.paused,
        track: payload.track || null,
      }
    : null;
  mem.spotifyListen = data;
  const s = store();
  if (s && data) {
    try {
      if (typeof s.setJSON === "function") await s.setJSON("spotify-listen", data);
      else await s.set("spotify-listen", JSON.stringify(data));
    } catch (e) {
      console.error("[store] setSpotifyListenCache", e && e.message);
    }
  }
  return data;
}

module.exports = {
  getViews,
  setViews,
  bumpViews,
  getBadges,
  setBadges,
  parseEmojiInput,
  json,
  getYtMusicAuth,
  setYtMusicAuth,
  getYtMusicListenState,
  setYtMusicListenState,
  getNowPlayingToken,
  ensureNowPlayingToken,
  getNowPlaying,
  setNowPlaying,
  nowPlayingToListening,
  NOWPLAYING_FRESH_SEC,
  getSpotifyAuth,
  setSpotifyAuth,
  getSpotifyListenCache,
  setSpotifyListenCache,
  SPOTIFY_LISTEN_TTL_MS,
  getLyricsCache,
  setLyricsCache,
};

async function getLyricsCache(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  if (mem.lyricsCache && mem.lyricsCache[k] && Date.now() - mem.lyricsCache[k].at < 1000 * 60 * 60 * 6) {
    return mem.lyricsCache[k].payload;
  }
  const s = store();
  const blob = await readBlobJson(s, "lyrics:" + k);
  if (blob && blob.payload && Date.now() - Number(blob.at || 0) < 1000 * 60 * 60 * 24) {
    mem.lyricsCache[k] = blob;
    return blob.payload;
  }
  return null;
}

async function setLyricsCache(key, payload) {
  const k = String(key || "").trim();
  if (!k || !payload) return;
  const row = { at: Date.now(), payload };
  mem.lyricsCache[k] = row;
  const s = store();
  if (!s) return;
  try {
    if (typeof s.setJSON === "function") await s.setJSON("lyrics:" + k, row);
    else await s.set("lyrics:" + k, JSON.stringify(row));
  } catch (e) {
    console.error("[store] setLyricsCache", e && e.message);
  }
}
