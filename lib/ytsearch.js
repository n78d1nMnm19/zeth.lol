/**
 * Find a YouTube video for a Spotify track (site audio mirror).
 * Spotify Connect can't play on two devices at once — YT plays on the site
 * while the Spotify app keeps playing independently.
 */

const SEARCH_URL = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";

const CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20250312.00.00",
  hl: "en",
  gl: "US",
};

/** @type {Map<string, { videoId: string, at: number }>} */
const cache = new Map();
const CACHE_MS = 1000 * 60 * 60 * 12;

function textRuns(runs) {
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => (r && r.text) || "")
    .join("")
    .trim();
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

function extractFirstVideoId(body) {
  let found = "";
  walk(body, (node) => {
    if (found) return;
    if (node.videoRenderer && node.videoRenderer.videoId) {
      found = String(node.videoRenderer.videoId);
      return;
    }
    if (
      node.playlistVideoRenderer &&
      node.playlistVideoRenderer.videoId
    ) {
      found = String(node.playlistVideoRenderer.videoId);
    }
  });
  return found;
}

async function searchYoutubeVideoId(title, artist) {
  const q = [title, artist, "audio"].filter(Boolean).join(" ").trim();
  if (!q) return "";

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.videoId;

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      context: { client: CLIENT },
      query: q,
    }),
  });

  if (!res.ok) return "";
  const body = await res.json().catch(() => null);
  if (!body) return "";

  const videoId = extractFirstVideoId(body);
  if (videoId) cache.set(key, { videoId, at: Date.now() });
  return videoId || "";
}

module.exports = { searchYoutubeVideoId };
