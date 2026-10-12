/**
 * Proxy + smarter LRCLIB lookup (avoids multi-artist Spotify misses).
 * GET /api/lyrics?title=&artist=&album=&duration=
 */
const lyrics = require("../../lib/lyrics");
const { getLyricsCache, setLyricsCache } = require("./_store");

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=120",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false }) };
  }

  const q = event.queryStringParameters || {};
  const title = String(q.title || q.track || "").trim();
  const artist = String(q.artist || "").trim();
  const album = String(q.album || "").trim();
  const durationSec = Number(q.duration || q.durationSec || 0) || 0;
  const cacheKey = String(q.key || q.spotifyId || title + "|" + artist).trim();

  if (!title) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "title required" }),
    };
  }

  try {
    const cached = await getLyricsCache(cacheKey);
    if (cached && (cached.lines || cached.instrumental)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          found: !!(cached.lines && cached.lines.length) || !!cached.instrumental,
          instrumental: !!cached.instrumental,
          synced: !!cached.synced,
          lines: cached.lines || [],
          cached: true,
        }),
      };
    }

    const record = await lyrics.findLyrics({ title, artist, album, durationSec });
    if (!record) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, found: false, lines: [] }),
      };
    }
    const packed = lyrics.toClientLines(record);
    await setLyricsCache(cacheKey, packed);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        found: packed.lines.length > 0 || packed.instrumental,
        instrumental: !!packed.instrumental,
        synced: !!packed.synced,
        lines: packed.lines,
        trackName: record.trackName || record.name || title,
        artistName: record.artistName || artist,
      }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        ok: false,
        error: String(e.message || e),
        lines: [],
      }),
    };
  }
};
