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
  const env = readCookieFromEnv();
  if (env) return env;
  const stored = readStoredHeaders();
  return stored && stored.cookie ? String(stored.cookie).trim() : "";
}

function pickSapisid(cookie) {
  const parts = String(cookie || "").split(/;\s*/);
  for (const p of parts) {
    if (p.startsWith("__Secure-3PAPISID=")) return p.slice("__Secure-3PAPISID=".length);
    if (p.startsWith("SAPISID=")) return p.slice("SAPISID=".length);
  }
  return "";
}

function sapisidHash(cookie) {
  const sapisid = pickSapisid(cookie);
  if (!sapisid) return "";
  const now = Math.floor(Date.now() / 1000);
  const dig = crypto.createHash("sha1").update(`${now} ${sapisid} ${ORIGIN}`).digest("hex");
  return `SAPISIDHASH ${now}_${dig}`;
}

function authConfigured() {
  return !!getCookie();
}

async function browseHistory() {
  const cookie = getCookie();
  if (!cookie) {
    const err = new Error("YouTube Music not connected");
    err.code = "NO_AUTH";
    throw err;
  }
  const stored = readStoredHeaders() || {};
  const authorization = sapisidHash(cookie);
  const headers = {
    Accept: "*/*",
    "Content-Type": "application/json",
    Cookie: cookie,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "X-Goog-AuthUser": String(stored.authUser || process.env.YTMUSIC_AUTH_USER || "0"),
    "X-Origin": ORIGIN,
    Origin: ORIGIN,
    Referer: ORIGIN + "/",
  };
  if (authorization) headers.Authorization = authorization;

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
  return body;
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

/** Parse YT Music "played X ago" style labels → seconds, or null if unknown. */
function parsePlayedAgeSec(label) {
  const s = String(label || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "just now" || s.indexOf("second") !== -1) return 0;
  if (s.indexOf("yesterday") !== -1 || s.indexOf("last week") !== -1 || s.indexOf("last month") !== -1) {
    return 86400;
  }
  let m = s.match(/(\d+)\s*min/);
  if (m) return parseInt(m[1], 10) * 60;
  m = s.match(/(\d+)\s*hour/);
  if (m) return parseInt(m[1], 10) * 3600;
  m = s.match(/(\d+)\s*day/);
  if (m) return parseInt(m[1], 10) * 86400;
  if (s === "today") return 3600; // ambiguous — treat as not "just started"
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
      const low = s.toLowerCase();
      if (
        low.indexOf("ago") !== -1 ||
        low === "just now" ||
        low === "today" ||
        low === "yesterday" ||
        low.indexOf("last week") !== -1
      ) {
        const age = parsePlayedAgeSec(s);
        if (age != null) {
          playedAgeSec = age;
          break;
        }
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

function listeningTrackPayload(track, start) {
  const durMs = (Number(track.durationSec) || 0) * 1000;
  const end = durMs > 0 ? start + durMs : 0;
  return {
    listening: true,
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
      key: "ytm:" + track.videoId + ":" + start,
    },
  };
}

/**
 * History stays after you close YT Music — only treat as "now playing" when:
 * - top track just changed (new play), or
 * - played-age says it was very recent, and we're still within song duration
 */
function toListeningPayload(track) {
  if (!track) {
    memoryTrack = null;
    return { listening: false, track: null };
  }

  const now = Date.now();
  const age = track.playedAgeSec;
  // Explicitly old history → not listening
  if (age != null && age > 90) {
    memoryTrack = {
      ...track,
      startedAt: 0,
      dormant: true,
    };
    return { listening: false, track: null, stale: true };
  }

  const same =
    memoryTrack &&
    memoryTrack.videoId === track.videoId &&
    memoryTrack.title === track.title;

  // First sighting of whatever is on top: don't assume it's playing unless fresh
  if (!memoryTrack) {
    if (age != null && age <= 90) {
      memoryTrack = { ...track, startedAt: now, dormant: false };
      return listeningTrackPayload(track, now);
    }
    memoryTrack = { ...track, startedAt: 0, dormant: true };
    return { listening: false, track: null, dormant: true };
  }

  // Top track changed → user started a new song
  if (!same) {
    memoryTrack = { ...track, startedAt: now, dormant: false };
    return listeningTrackPayload(track, now);
  }

  // Same track still on top
  if (memoryTrack.dormant) {
    return { listening: false, track: null, dormant: true };
  }

  const start = memoryTrack.startedAt || now;
  const durMs = (Number(track.durationSec) || 0) * 1000;
  // Song finished (or YT closed mid-track long enough) → stop
  if (durMs > 0 && now - start > durMs + 8000) {
    memoryTrack = { ...track, startedAt: 0, dormant: true };
    return { listening: false, track: null, stale: true };
  }
  // No duration known: stop after 4 minutes on the same track
  if (!durMs && now - start > 4 * 60 * 1000) {
    memoryTrack = { ...track, startedAt: 0, dormant: true };
    return { listening: false, track: null, stale: true };
  }

  return listeningTrackPayload(track, start);
}

async function getListening() {
  if (!authConfigured()) {
    return { listening: false, track: null, configured: false };
  }
  try {
    const body = await browseHistory();
    const latest = extractLatestTrack(body);
    const payload = toListeningPayload(latest);
    return { ...payload, configured: true, ok: true };
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

module.exports = {
  authConfigured,
  getListening,
  saveHeaders,
  getCookie,
  HEADERS_PATH,
};
