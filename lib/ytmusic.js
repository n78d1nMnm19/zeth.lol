/**
 * YouTube Music account client (unofficial Innertube).
 * Auth = browser Cookie from music.youtube.com (see /ytmusic-setup.html).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ORIGIN = "https://music.youtube.com";
const BROWSE_URL = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false";
const HEADERS_PATH = path.join(__dirname, "..", "bot", "data", "ytmusic-headers.json");

const CLIENT = {
  clientName: "WEB_REMIX",
  clientVersion: "1.20250310.01.00",
  hl: "en",
  gl: "US",
};

/** @type {null | { videoId: string, title: string, artist: string, album: string, art: string, durationSec: number, startedAt: number, dormant?: boolean }} */
let memoryTrack = null;

function readCookieFromEnv() {
  return String(process.env.YTMUSIC_COOKIE || "").trim();
}

function readStoredHeaders() {
  try {
    if (!fs.existsSync(HEADERS_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(HEADERS_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

function saveHeaders(cookie, extra) {
  const dir = path.dirname(HEADERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    cookie: String(cookie || "").trim(),
    authUser: String((extra && extra.authUser) || "0"),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(HEADERS_PATH, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function getCookie() {
  if (runtimeCookie) return runtimeCookie;
  const env = readCookieFromEnv();
  if (env) return env;
  const stored = readStoredHeaders();
  return stored && stored.cookie ? String(stored.cookie).trim() : "";
}

function getAuthUser() {
  if (runtimeAuthUser) return runtimeAuthUser;
  const stored = readStoredHeaders();
  return String((stored && stored.authUser) || process.env.YTMUSIC_AUTH_USER || "0");
}

/** @type {string} */
let runtimeCookie = "";
/** @type {string} */
let runtimeAuthUser = "";

function applyAuth(cookie, authUser) {
  runtimeCookie = String(cookie || "").trim();
  runtimeAuthUser = String(authUser || "0");
}

function pickSapisid(cookie) {
  const parts = String(cookie || "").split(/;\s*/);
  const prefer = ["__Secure-3PAPISID=", "__Secure-1PAPISID=", "SAPISID="];
  for (const prefix of prefer) {
    for (const p of parts) {
      if (p.toLowerCase().startsWith(prefix.toLowerCase())) {
        return p.slice(p.indexOf("=") + 1);
      }
    }
  }
  return "";
}

function cookieLooksValid(cookie) {
  const c = String(cookie || "");
  return c.length >= 40 && !!pickSapisid(c);
}

function sapisidHash(cookie) {
  const sapisid = pickSapisid(cookie);
  if (!sapisid) return "";
  const now = Math.floor(Date.now() / 1000);
  const dig = crypto.createHash("sha1").update(`${now} ${sapisid} ${ORIGIN}`).digest("hex");
  return `SAPISIDHASH ${now}_${dig}`;
}

function authConfigured() {
  return cookieLooksValid(getCookie());
}

async function browseHistory() {
  const cookie = getCookie();
  if (!cookie) {
    const err = new Error("YouTube Music not connected");
    err.code = "NO_AUTH";
    throw err;
  }
  const authorization = sapisidHash(cookie);
  if (!authorization) {
    const err = new Error("Cookie missing SAPISID — reconnect at /ytmusic-setup.html");
    err.code = "NO_SAPISID";
    throw err;
  }
  const headers = {
    Accept: "*/*",
    "Content-Type": "application/json",
    Cookie: cookie,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "X-Goog-AuthUser": getAuthUser(),
    "X-Origin": ORIGIN,
    Origin: ORIGIN,
    Referer: ORIGIN + "/",
    Authorization: authorization,
  };

  const res = await fetch(BROWSE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      context: { client: CLIENT },
      browseId: "FEmusic_history",
    }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    const err = new Error("Invalid YouTube Music response");
    err.code = "BAD_RESPONSE";
    throw err;
  }
  if (!res.ok) {
    const err = new Error("YouTube Music auth failed (" + res.status + ")");
    err.code = "AUTH_FAILED";
    err.status = res.status;
    throw err;
  }
  if (isSignedOutBody(body)) {
    const err = new Error("YouTube Music session expired — reconnect at /ytmusic-setup.html");
    err.code = "SIGNED_OUT";
    throw err;
  }
  return body;
}

function isSignedOutBody(body) {
  let signedOut = false;
  let loggedIn = null;
  walk(body, (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.params)) {
      for (const p of node.params) {
        if (p && p.key === "logged_in") loggedIn = String(p.value);
      }
    }
    if (node.messageRenderer && node.messageRenderer.text) {
      const t = textRuns(node.messageRenderer.text.runs || []).toLowerCase();
      if (t.indexOf("sign in") !== -1) signedOut = true;
    }
  });
  if (loggedIn === "0") return true;
  return signedOut;
}

function walk(obj, visit) {
  if (!obj || typeof obj !== "object") return;
  visit(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) walk(item, visit);
    return;
  }
  for (const k of Object.keys(obj)) walk(obj[k], visit);
}

function textRuns(runs) {
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => (r && r.text) || "")
    .join("")
    .trim();
}

function parseDurationSec(label) {
  const s = String(label || "").trim();
  if (!s) return 0;
  const parts = s.split(":").map((x) => parseInt(x, 10));
  if (parts.some((n) => !isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** Age still counts as a brand-new / in-progress play (seconds). */
const FRESH_MAX_SEC = 180;
/** If second-precision age stays frozen this long → paused/closed. */
const AGE_FROZEN_MS = 3000;

/** Parse YT Music "played X ago" labels (EN/NL/DE) → seconds, or null if unknown. */
function parsePlayedAgeSec(label) {
  const s = String(label || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "just now" || s === "zojuist" || s === "gerade eben") return 0;

  // Prefer numeric seconds ("32 seconds ago") — critical for instant pause sync
  let m = s.match(/(\d+)\s*(seconds?|seconden|secondes|sekunden?)/);
  if (m) return parseInt(m[1], 10);

  if (
    s.indexOf("yesterday") !== -1 ||
    s.indexOf("gisteren") !== -1 ||
    s.indexOf("gestern") !== -1 ||
    s.indexOf("last week") !== -1 ||
    s.indexOf("vorige week") !== -1 ||
    s.indexOf("last month") !== -1
  ) {
    return 86400;
  }
  m = s.match(/(\d+)\s*(min|mins|minute|minutes|minuut|minuten)/);
  if (m) return parseInt(m[1], 10) * 60;
  m = s.match(/(\d+)\s*(hour|hours|uur|uren|stunde|stunden)/);
  if (m) return parseInt(m[1], 10) * 3600;
  m = s.match(/(\d+)\s*(day|days|dag|dagen|tag|tage)/);
  if (m) return parseInt(m[1], 10) * 86400;
  // "Today" / "Vandaag" is too vague — treat as stale for auto-start
  if (s === "today" || s === "vandaag" || s === "heute") return 3600;
  return null;
}

function collectItemStrings(item) {
  const out = [];
  walk(item, (node) => {
    if (node && typeof node.text === "string" && node.text.trim()) out.push(node.text.trim());
    if (node && Array.isArray(node.runs)) {
      const t = textRuns(node.runs);
      if (t) out.push(t);
    }
  });
  return out;
}

function extractLatestTrack(browseBody) {
  const found = [];
  walk(browseBody, (node) => {
    if (!node.musicResponsiveListItemRenderer) return;
    const item = node.musicResponsiveListItemRenderer;
    const videoId =
      (item.playlistItemData && item.playlistItemData.videoId) ||
      (item.overlay &&
        item.overlay.musicItemThumbnailOverlayRenderer &&
        item.overlay.musicItemThumbnailOverlayRenderer.content &&
        item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer &&
        item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
          .playNavigationEndpoint &&
        item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
          .playNavigationEndpoint.watchEndpoint &&
        item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
          .playNavigationEndpoint.watchEndpoint.videoId) ||
      "";
    if (!videoId) return;

    const flex = item.flexColumns || [];
    let title = "";
    let artist = "";
    let album = "";
    let durationSec = 0;

    for (let i = 0; i < flex.length; i++) {
      const col =
        flex[i] &&
        flex[i].musicResponsiveListItemFlexColumnRenderer &&
        flex[i].musicResponsiveListItemFlexColumnRenderer.text &&
        flex[i].musicResponsiveListItemFlexColumnRenderer.text.runs;
      const t = textRuns(col);
      if (!t) continue;
      if (i === 0) title = t;
      else if (i === 1) {
        const bits = t.split("•").map((x) => x.trim()).filter(Boolean);
        artist = bits[0] || t;
        if (bits[1]) album = bits[1];
      }
    }

    const fixed = item.fixedColumns || [];
    for (const f of fixed) {
      const runs =
        f &&
        f.musicResponsiveListItemFixedColumnRenderer &&
        f.musicResponsiveListItemFixedColumnRenderer.text &&
        f.musicResponsiveListItemFixedColumnRenderer.text.runs;
      const d = parseDurationSec(textRuns(runs));
      if (d) durationSec = d;
    }

    let art = "";
    const thumbs =
      (item.thumbnail &&
        item.thumbnail.musicThumbnailRenderer &&
        item.thumbnail.musicThumbnailRenderer.thumbnail &&
        item.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) ||
      [];
    if (thumbs.length) {
      art = String(thumbs[thumbs.length - 1].url || "").trim();
    }

    let playedAgeSec = null;
    const strings = collectItemStrings(item);
    for (const s of strings) {
      // Only real relative-time labels — never bare "Today" / artist names containing "min"
      if (!/(\d+\s*(seconds?|seconden|min|mins|minutes?|minuut|minuten|hours?|uur|uren|days?|dag)|just now|zojuist|gerade eben|.+\sago$|.+\sgeleden$)/i.test(s)) {
        continue;
      }
      const age = parsePlayedAgeSec(s);
      if (age != null) {
        playedAgeSec = age;
        break;
      }
    }

    if (title) {
      found.push({
        videoId,
        title,
        artist,
        album,
        art,
        durationSec,
        playedAgeSec,
      });
    }
  });

  return found[0] || null;
}

function listeningTrackPayload(track, start, fresh) {
  const durMs = (Number(track.durationSec) || 0) * 1000;
  const end = durMs > 0 ? start + durMs : 0;
  return {
    listening: true,
    fresh: !!fresh,
    track: {
      source: "youtube music",
      title: track.title,
      artist: track.artist,
      album: track.album,
      art: track.art,
      videoId: track.videoId,
      start,
      end,
      durationSec: Number(track.durationSec) || 0,
      playedAgeSec: track.playedAgeSec,
      // Stable key per video so polls don't remount the player
      key: "ytm:" + track.videoId,
    },
  };
}

function markDormant(track) {
  memoryTrack = {
    ...track,
    startedAt: 0,
    dormant: true,
    lastAge: track.playedAgeSec,
    ageStuckSince: 0,
    lastPollAt: Date.now(),
  };
  return { listening: false, track: null, fresh: false, stale: true };
}

function activate(track, start, age, now) {
  memoryTrack = {
    ...track,
    startedAt: start,
    dormant: false,
    lastAge: age,
    ageStuckSince: 0,
    lastPollAt: now,
  };
  return listeningTrackPayload(track, start, true);
}

/** True when history age says this play is still inside the song. */
function ageWithinSong(age, dur) {
  if (age == null) return false;
  if (dur > 0) return age < dur + 8;
  return age <= FRESH_MAX_SEC;
}

/**
 * Now-playing from history (~2s after a play once history updates):
 * - start when top track changes OR age is within the song window
 * - stop when age exceeds song length / second-age freezes
 */
function toListeningPayload(track) {
  if (!track) {
    memoryTrack = null;
    return { listening: false, track: null, fresh: false };
  }

  const now = Date.now();
  const age = track.playedAgeSec;
  const dur = Number(track.durationSec) || 0;

  // Clearly finished / old
  if (age != null && dur > 0 && age >= dur + 8) {
    return markDormant(track);
  }
  if (age != null && !dur && age > FRESH_MAX_SEC) {
    return markDormant(track);
  }

  const same =
    memoryTrack &&
    memoryTrack.videoId === track.videoId &&
    memoryTrack.title === track.title;

  // First sighting: start when top-of-history looks like a current play
  if (!memoryTrack) {
    if (
      ageWithinSong(age, dur) ||
      (age == null && dur > 0) ||
      (age != null && age <= FRESH_MAX_SEC) ||
      age == null
    ) {
      const start = age != null ? now - age * 1000 : now;
      return activate(track, start, age, now);
    }
    memoryTrack = {
      ...track,
      startedAt: 0,
      dormant: true,
      lastAge: age,
      ageStuckSince: 0,
      lastPollAt: now,
    };
    return { listening: false, track: null, fresh: false, dormant: true };
  }

  // New song on top → start immediately
  if (!same) {
    const start = age != null ? now - age * 1000 : now;
    return activate(track, start, age, now);
  }

  // Same track, was dormant → wake on re-play / still-current top
  if (memoryTrack.dormant) {
    if (age != null && age <= FRESH_MAX_SEC) {
      return activate(track, now - age * 1000, age, now);
    }
    if (ageWithinSong(age, dur) || age == null) {
      return activate(track, age != null ? now - age * 1000 : now, age, now);
    }
    memoryTrack.lastAge = age;
    memoryTrack.lastPollAt = now;
    return { listening: false, track: null, fresh: false, dormant: true };
  }

  // --- actively listening ---
  if (age != null && memoryTrack.lastAge != null && age < 55) {
    if (age === memoryTrack.lastAge && age >= 2) {
      if (!memoryTrack.ageStuckSince) memoryTrack.ageStuckSince = memoryTrack.lastPollAt || now;
      if (now - memoryTrack.ageStuckSince >= AGE_FROZEN_MS) {
        return markDormant(track);
      }
    } else if (age > memoryTrack.lastAge) {
      memoryTrack.ageStuckSince = 0;
    }
  } else {
    memoryTrack.ageStuckSince = 0;
  }

  let start = memoryTrack.startedAt || now;
  if (age != null && age < 55) {
    start = now - age * 1000;
    memoryTrack.startedAt = start;
  }

  const durMs = dur * 1000;
  if (durMs > 0 && now - start >= durMs) {
    return markDormant(track);
  }
  if (!durMs && now - start > 3 * 60 * 1000) {
    return markDormant(track);
  }

  memoryTrack.lastAge = age;
  memoryTrack.lastPollAt = now;
  return listeningTrackPayload(track, start, false);
}

function hydrateState(state) {
  if (!state || !state.videoId) {
    memoryTrack = null;
    return;
  }
  memoryTrack = {
    videoId: state.videoId,
    title: state.title || "",
    artist: state.artist || "",
    album: state.album || "",
    art: state.art || "",
    durationSec: Number(state.durationSec) || 0,
    playedAgeSec: state.playedAgeSec,
    startedAt: Number(state.startedAt) || 0,
    dormant: !!state.dormant,
    lastAge: state.lastAge,
    ageStuckSince: Number(state.ageStuckSince) || 0,
    lastPollAt: Number(state.lastPollAt) || 0,
  };
}

function exportState() {
  if (!memoryTrack) return null;
  return {
    videoId: memoryTrack.videoId,
    title: memoryTrack.title,
    artist: memoryTrack.artist,
    album: memoryTrack.album,
    art: memoryTrack.art,
    durationSec: memoryTrack.durationSec,
    playedAgeSec: memoryTrack.playedAgeSec,
    startedAt: memoryTrack.startedAt,
    dormant: !!memoryTrack.dormant,
    lastAge: memoryTrack.lastAge,
    ageStuckSince: memoryTrack.ageStuckSince || 0,
    lastPollAt: memoryTrack.lastPollAt || 0,
  };
}

async function getListening() {
  if (!authConfigured()) {
    return { listening: false, track: null, configured: false, ok: false, error: "NO_AUTH" };
  }
  try {
    const body = await browseHistory();
    const latest = extractLatestTrack(body);
    const payload = toListeningPayload(latest);
    return {
      ...payload,
      configured: true,
      ok: true,
      // Always expose top history row so clients can see sync is alive
      top: latest
        ? {
            videoId: latest.videoId,
            title: latest.title,
            artist: latest.artist,
            playedAgeSec: latest.playedAgeSec,
            durationSec: latest.durationSec,
          }
        : null,
    };
  } catch (e) {
    return {
      listening: false,
      track: null,
      configured: true,
      ok: false,
      error: e.code || "ERROR",
      message: e.message || "failed",
    };
  }
}

/** Verify cookie can read history (used by setup). */
async function probeAuth(cookie, authUser) {
  applyAuth(cookie, authUser);
  if (!cookieLooksValid(cookie)) {
    return { ok: false, error: "NO_SAPISID", message: "Cookie must include SAPISID / __Secure-3PAPISID" };
  }
  try {
    const body = await browseHistory();
    const latest = extractLatestTrack(body);
    return {
      ok: true,
      signedIn: true,
      latest: latest
        ? { title: latest.title, artist: latest.artist, videoId: latest.videoId, playedAgeSec: latest.playedAgeSec }
        : null,
    };
  } catch (e) {
    return { ok: false, error: e.code || "ERROR", message: e.message || "failed" };
  }
}

module.exports = {
  authConfigured,
  getListening,
  saveHeaders,
  getCookie,
  applyAuth,
  hydrateState,
  exportState,
  cookieLooksValid,
  probeAuth,
  HEADERS_PATH,
};
