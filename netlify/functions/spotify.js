const {
  json,
  getSpotifyAuth,
  setSpotifyAuth,
  getSpotifyListenCache,
  setSpotifyListenCache,
  getLyricsCache,
  setLyricsCache,
} = require("./_store");
const spotify = require("../../lib/spotify");
const lyricsLib = require("../../lib/lyrics");

async function attachLyrics(track, opts) {
  if (!track) return track;
  const key = track.spotifyId || track.key || track.title;
  const allowFetch = !opts || opts.fetch !== false;
  try {
    let packed = await getLyricsCache(key);
    if (!packed && allowFetch) {
      const fetchPromise = (async () => {
        const record = await lyricsLib.findLyrics({
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationSec: track.durationSec,
        });
        const next = lyricsLib.toClientLines(record);
        if (next && (next.lines.length || next.instrumental)) {
          await setLyricsCache(key, next);
        }
        return next;
      })();
      packed = await Promise.race([
        fetchPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
    }
    if (packed) track.lyrics = packed;
  } catch (e) {
    console.error("[spotify] lyrics", e && e.message);
  }
  return track;
}

function siteOrigin(event) {
  const host =
    (event.headers && (event.headers["x-forwarded-host"] || event.headers.host)) || "slits.lol";
  const proto = (event.headers && event.headers["x-forwarded-proto"]) || "https";
  return proto + "://" + String(host).split(",")[0].trim();
}

function redirectUri(event) {
  return siteOrigin(event) + "/api/spotify/callback";
}

function advanceCachedTrack(track) {
  if (!track || !track.start) return track;
  const progressMs = Math.max(0, Date.now() - Number(track.start));
  return Object.assign({}, track, { progressMs: progressMs });
}

async function currentlyPlayingPayload() {
  const creds = await getSpotifyAuth();
  if (!creds || !creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return {
      listening: false,
      track: null,
      configured: false,
      ok: false,
      via: "spotify",
      error: "NO_AUTH",
      message: "Connect Spotify at /spotify-setup.html",
    };
  }
  try {
    const data = await spotify.getCurrentlyPlaying(creds);
    if (data.newRefreshToken) {
      await setSpotifyAuth({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: data.newRefreshToken,
      });
    }
    if (data.listening && data.track) {
      await attachLyrics(data.track);
      await setSpotifyListenCache({
        listening: true,
        paused: !!data.paused,
        track: data.track,
      });
      return {
        listening: true,
        track: data.track,
        configured: true,
        ok: true,
        via: "spotify",
        fresh: !!data.fresh,
        paused: !!data.paused,
      };
    }
    // Empty blip — serve last track briefly (Spotify API; no owner tab needed)
    const cached = await getSpotifyListenCache();
    if (cached && cached.track) {
      const track = advanceCachedTrack(cached.track);
      const durationMs =
        track.end && track.start
          ? Number(track.end) - Number(track.start)
          : (Number(track.durationSec) || 0) * 1000;
      // Don't keep a finished track alive — lets the next song show up cleanly
      if (!(durationMs > 0 && Number(track.progressMs) >= durationMs - 250)) {
        if (cached.paused) track.paused = true;
        else track.paused = false;
        if (!track.lyrics) await attachLyrics(track);
        return {
          listening: true,
          track,
          configured: true,
          ok: true,
          via: "spotify",
          fresh: false,
          paused: !!cached.paused,
          cached: true,
        };
      }
    }
    return {
      listening: false,
      track: null,
      configured: true,
      ok: true,
      via: "spotify",
      fresh: !!data.fresh,
      paused: !!data.paused,
    };
  } catch (e) {
    // Dead refresh token → clear it so setup shows “Connect” instead of a fake connected state
    if (e.code === "AUTH_FAILED" || e.status === 400 || e.status === 401) {
      try {
        await setSpotifyAuth({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          refreshToken: "",
        });
      } catch {
        /* ignore */
      }
      return {
        listening: false,
        track: null,
        configured: true,
        ok: false,
        via: "spotify",
        error: "REAUTH",
        message: "Spotify login expired — reconnect at /spotify-setup.html",
        needsReauth: true,
      };
    }
    return {
      listening: false,
      track: null,
      configured: true,
      ok: false,
      via: "spotify",
      error: e.code || "ERROR",
      message: e.message || "Spotify failed",
    };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  const path = String(event.path || "");
  const action = (event.queryStringParameters && event.queryStringParameters.action) || "";
  const qs = event.queryStringParameters || {};

  // Access token for Web Playback SDK (play audio in the browser)
  if (event.httpMethod === "GET" && action === "token") {
    const creds = await getSpotifyAuth();
    if (!creds || !creds.refreshToken) {
      return json(401, { ok: false, error: "NO_AUTH" });
    }
    try {
      const tok = await spotify.getClientAccessToken(creds);
      if (tok.newRefreshToken) {
        await setSpotifyAuth({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          refreshToken: tok.newRefreshToken,
        });
      }
      return json(200, {
        ok: true,
        accessToken: tok.accessToken,
        expiresIn: tok.expiresIn || 3600,
      });
    } catch (e) {
      return json(401, { ok: false, error: e.message || "token failed" });
    }
  }

  // Site polls this for now-playing (same function that stores OAuth tokens)
  if (
    event.httpMethod === "GET" &&
    (action === "now" || action === "listening" || path.indexOf("/listening") !== -1)
  ) {
    return json(200, await currentlyPlayingPayload());
  }

  // OAuth callback
  if (path.indexOf("callback") !== -1 || action === "callback") {
    const code = qs.code;
    const err = qs.error;
    if (err) {
      return {
        statusCode: 302,
        headers: { Location: "/spotify-setup.html?error=" + encodeURIComponent(err) },
        body: "",
      };
    }
    if (!code) {
      return {
        statusCode: 302,
        headers: { Location: "/spotify-setup.html?error=missing_code" },
        body: "",
      };
    }
    try {
      const creds = await getSpotifyAuth();
      if (!creds || !creds.clientId || !creds.clientSecret) {
        return {
          statusCode: 302,
          headers: { Location: "/spotify-setup.html?error=missing_client" },
          body: "",
        };
      }
      const tokens = await spotify.exchangeCode(creds, code, redirectUri(event));
      await setSpotifyAuth({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: tokens.refreshToken,
      });
      return {
        statusCode: 302,
        headers: { Location: "/spotify-setup.html?ok=1" },
        body: "",
      };
    } catch (e) {
      return {
        statusCode: 302,
        headers: {
          Location: "/spotify-setup.html?error=" + encodeURIComponent(e.message || "auth_failed"),
        },
        body: "",
      };
    }
  }

  // Start OAuth — always show consent so scopes are granted
  if (action === "authorize" || path.indexOf("authorize") !== -1) {
    const creds = await getSpotifyAuth();
    if (!creds || !creds.clientId || !creds.clientSecret) {
      return {
        statusCode: 302,
        headers: { Location: "/spotify-setup.html?error=save_credentials_first" },
        body: "",
      };
    }
    const url = spotify.authUrl(creds.clientId, redirectUri(event), "slits");
    return {
      statusCode: 302,
      headers: { Location: url },
      body: "",
    };
  }

  // Save client credentials (+ optional immediate authorize URL)
  if (event.httpMethod === "POST") {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "invalid json" });
    }
    const prev = await getSpotifyAuth();
    const clientId = String(body.clientId || (prev && prev.clientId) || "").trim();
    const clientSecret = String(body.clientSecret || (prev && prev.clientSecret) || "").trim();
    if (!clientId || !clientSecret) {
      return json(400, { ok: false, error: "clientId and clientSecret required" });
    }
    // Reconnect always clears the old refresh token
    const clearRefresh = body.clearRefresh !== false;
    try {
      await setSpotifyAuth({
        clientId,
        clientSecret,
        refreshToken: clearRefresh ? "" : (prev && prev.refreshToken) || "",
      });
    } catch (e) {
      return json(500, { ok: false, error: e.message || "Failed to save credentials" });
    }
    const check = await getSpotifyAuth();
    if (!check || !check.clientId) {
      return json(500, { ok: false, error: "Credentials did not persist — retry" });
    }
    return json(200, {
      ok: true,
      configured: true,
      authorizeUrl: "/api/spotify?action=authorize",
      redirectUri: redirectUri(event),
    });
  }

  // Status (+ live track if possible)
  if (event.httpMethod === "GET") {
    const creds = await getSpotifyAuth();
    const connected = !!(creds && creds.clientId && creds.clientSecret && creds.refreshToken);
    let listening = false;
    let track = null;
    let error = null;
    if (connected) {
      const now = await currentlyPlayingPayload();
      listening = !!now.listening;
      track = now.track || null;
      error = now.ok ? null : now.message || now.error;
    }
    const needsReauth =
      !!(creds && creds.clientId && creds.clientSecret && !creds.refreshToken) ||
      error === "REAUTH" ||
      (typeof error === "string" && /expired|reconnect|reauth/i.test(error));
    return json(200, {
      ok: connected && !error,
      configured: !!(creds && creds.clientId && creds.clientSecret),
      connected,
      hasRefreshToken: !!(creds && creds.refreshToken),
      needsReauth,
      redirectUri: redirectUri(event),
      listening,
      track,
      error,
    });
  }

  return json(405, { error: "method not allowed" });
};
