/**
 * LRCLIB lyrics lookup with retries + title/artist cleanup.
 */

const BASE = "https://lrclib.net/api";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "slits.lol-lyrics/1.0",
  "Lrclib-Client": "slits.lol listening widget",
};

function cleanTitle(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  t = t
    .replace(/\s*[(\[][^)\]]*(remaster|remix|version|edit|live|radio|bonus|deluxe|explicit|clean)[^)\]]*[)\]]/gi, "")
    .replace(/\s*[-–—]\s*(remaster(ed)?|radio edit|live).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

function primaryArtist(raw) {
  let a = String(raw || "").trim();
  if (!a) return "";
  a = a.split(/[,;&/]| featuring | feat\.? | ft\.? | x /i)[0].trim();
  return a;
}

function parseLrc(raw) {
  const out = [];
  const text = String(raw || "");
  if (!text) return out;
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g;
  let m;
  while ((m = re.exec(text))) {
    const min = parseInt(m[1], 10) || 0;
    const sec = parseInt(m[2], 10) || 0;
    let frac = m[3] || "0";
    if (frac.length === 1) frac += "00";
    else if (frac.length === 2) frac += "0";
    const ms = min * 60000 + sec * 1000 + (parseInt(frac, 10) || 0);
    const line = String(m[4] || "")
      .replace(/<\d+:\d+\.\d+>/g, "")
      .trim();
    if (!line) continue;
    out.push({ t: ms, text: line });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, tries) {
  tries = tries || 3;
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 404) return null;
      if (r.status === 503 || r.status === 429) {
        lastErr = new Error("lrclib " + r.status);
        await sleep(250 * (i + 1));
        continue;
      }
      if (!r.ok) throw new Error("lrclib " + r.status);
      return r.json();
    } catch (e) {
      lastErr = e;
      await sleep(200 * (i + 1));
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

function pickBest(list, durationSec) {
  if (!Array.isArray(list) || !list.length) return null;
  const withSync = list.filter((x) => x && x.syncedLyrics);
  const pool = withSync.length ? withSync : list;
  if (!(durationSec > 0)) return pool[0];
  let best = pool[0];
  let bestDiff = Infinity;
  for (const item of pool) {
    const d = Number(item.duration) || 0;
    const diff = d > 0 ? Math.abs(d - durationSec) : 999;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = item;
    }
  }
  // Reject absurd duration mismatches when we have a target
  if (durationSec > 0 && bestDiff > 45 && withSync.length === 0) return pool[0];
  return best;
}

async function findLyrics({ title, artist, album, durationSec }) {
  const track = cleanTitle(title);
  const art = primaryArtist(artist);
  if (!track) return null;

  const dur = durationSec > 0 ? Math.round(durationSec) : 0;
  let plainFallback = null;

  const queries = [];
  if (art) queries.push(art + " " + track);
  queries.push(track + (art ? " " + art : ""));
  queries.push(track);

  for (const q of queries) {
    try {
      const list = await fetchJson(BASE + "/search?q=" + encodeURIComponent(q));
      const synced = pickBest(
        (list || []).filter((x) => x && x.syncedLyrics),
        dur
      );
      if (synced) return synced;
      const any = pickBest(list, dur);
      if (any && any.plainLyrics && !plainFallback) plainFallback = any;
    } catch {
      /* next */
    }
  }

  if (art) {
    try {
      const list = await fetchJson(
        BASE +
          "/search?track_name=" +
          encodeURIComponent(track) +
          "&artist_name=" +
          encodeURIComponent(art)
      );
      const synced = pickBest(
        (list || []).filter((x) => x && x.syncedLyrics),
        dur
      );
      if (synced) return synced;
      const any = pickBest(list, dur);
      if (any && any.plainLyrics && !plainFallback) plainFallback = any;
    } catch {
      /* continue */
    }
  }

  // Title-only search
  try {
    const list = await fetchJson(
      BASE + "/search?track_name=" + encodeURIComponent(track)
    );
    const synced = pickBest(
      (list || []).filter((x) => x && x.syncedLyrics),
      dur
    );
    if (synced) return synced;
    const any = pickBest(list, dur);
    if (any && any.plainLyrics && !plainFallback) plainFallback = any;
  } catch {
    /* none */
  }

  if (art) {
    let url =
      BASE +
      "/get?track_name=" +
      encodeURIComponent(track) +
      "&artist_name=" +
      encodeURIComponent(art);
    if (dur > 0) url += "&duration=" + encodeURIComponent(String(dur));
    try {
      const hit = await fetchJson(url);
      if (hit && hit.syncedLyrics) return hit;
      if (hit && hit.plainLyrics && !plainFallback) plainFallback = hit;
    } catch {
      /* none */
    }
  }

  return plainFallback;
}

function toClientLines(record) {
  if (!record) return { lines: [], instrumental: false, synced: false };
  if (record.instrumental) return { lines: [], instrumental: true, synced: false };
  let lines = parseLrc(record.syncedLyrics);
  const synced = lines.length > 0;
  if (!lines.length && record.plainLyrics) {
    lines = String(record.plainLyrics)
      .split(/\n/)
      .map((t, i) => ({ t: i * 3000, text: String(t).trim() }))
      .filter((x) => x.text);
  }
  return { lines, instrumental: false, synced };
}

module.exports = {
  findLyrics,
  toClientLines,
  parseLrc,
  cleanTitle,
  primaryArtist,
};
