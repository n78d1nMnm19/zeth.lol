/**
 * Spotify Web API — currently playing (official).
 * Auth: Client ID/Secret + refresh token (OAuth once at /spotify-setup.html).
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_URL = "https://api.spotify.com/v1/me/player/currently-playing";
// Site only reads what's playing (YouTube mirrors audio). No Connect/streaming scopes.
const SCOPES = ["user-read-currently-playing", "user-read-playback-state"].join(" ");

/** @type {{ accessToken: string, expiresAt: number } | null} */
let tokenCache = null;

function basicAuth(clientId, clientSecret) {
  return Buffer.from(String(clientId) + ":" + String(clientSecret)).toString("base64");
}

async function refreshAccessToken(creds) {
  const clientId = String(creds.clientId || "").trim();
  const clientSecret = String(creds.clientSecret || "").trim();
  const refreshToken = String(creds.refreshToken || "").trim();
  if (!clientId || !clientSecret || !refreshToken) {
    const err = new Error("Spotify not connected");
    err.code = "NO_AUTH";
    throw err;
  }

  if (tokenCache && tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 30000) {
    return { accessToken: tokenCache.accessToken, newRefreshToken: null };
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const err = new Error(body.error_description || body.error || "Spotify token refresh failed");
    err.code = "AUTH_FAILED";
    err.status = res.status;
    throw err;
  }

  tokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  };

  return {
    accessToken: body.access_token,
    newRefreshToken: body.refresh_token || null,
  };
}

async function getCurrentlyPlaying(creds) {
  const refreshed = await refreshAccessToken(creds);
  const accessToken = refreshed.accessToken;
  const newRefreshToken = refreshed.newRefreshToken;

  const res = await fetch(NOW_URL + "?additional_types=track", {
    headers: { Authorization: "Bearer " + accessToken },
  });

  // 204 = nothing playing
  if (res.status === 204) {
    return {
      listening: false,
      track: null,
      configured: true,
      ok: true,
      via: "spotify",
      newRefreshToken,
    };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error && body.error.message ? body.error.message : "Spotify API error");
    err.code = "API_ERROR";
    err.status = res.status;
    throw err;
  }

  const item = body.item;
  const isPlaying = !!body.is_playing;
  if (!item || item.type !== "track") {
    return {
      listening: false,
      track: null,
      configured: true,
      ok: true,
      via: "spotify",
      paused: false,
      newRefreshToken,
    };
  }

  const artists = (item.artists || [])
    .map((a) => a && a.name)
    .filter(Boolean)
    .join(", ");
  const art =
    item.album && item.album.images && item.album.images.length
      ? item.album.images[0].url
      : "";
  const durationMs = Number(item.duration_ms) || 0;
  const progressMs = Number(body.progress_ms) || 0;
  const start = Date.now() - progressMs;
  const end = durationMs > 0 ? start + durationMs : 0;

  // No YouTube mirror — site plays config.soundUrl; card is metadata + lyrics only
  const track = {
    source: "spotify",
    title: String(item.name || ""),
    artist: artists,
    album: (item.album && item.album.name) || "",
    art: art,
    videoId: "",
    spotifyId: item.id || "",
    spotifyUri: item.uri || (item.id ? "spotify:track:" + item.id : ""),
    previewUrl: item.preview_url || "",
    progressMs: progressMs,
    start,
    end,
    durationSec: Math.round(durationMs / 1000),
    key: "spotify:" + (item.id || item.name),
    paused: !isPlaying,
  };

  // Keep track on pause so the site UI doesn't flicker off between Spotify polls
  return {
    listening: true,
    paused: !isPlaying,
    fresh: progressMs < 3000,
    configured: true,
    ok: true,
    via: "spotify",
    newRefreshToken,
    track,
  };
}

/** Fresh access token for the Web Playback SDK (browser). */
async function getClientAccessToken(creds) {
  const refreshed = await refreshAccessToken(creds);
  return {
    accessToken: refreshed.accessToken,
    newRefreshToken: refreshed.newRefreshToken,
    expiresIn: 3600,
  };
}

function authUrl(clientId, redirectUri, state) {
  const u = new URL("https://accounts.spotify.com/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state || "slits");
  // Always re-prompt so user-read-currently-playing is actually granted
  u.searchParams.set("show_dialog", "true");
  return u.toString();
}

async function exchangeCode(creds, code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + basicAuth(creds.clientId, creds.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: redirectUri,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const err = new Error(body.error_description || body.error || "Spotify code exchange failed");
    err.code = "AUTH_FAILED";
    throw err;
  }
  // Re-auth sometimes omits refresh_token — keep the previous one if Spotify doesn't send a new one
  const refreshToken = body.refresh_token || String(creds.refreshToken || "").trim();
  if (!refreshToken) {
    const err = new Error("No refresh token returned — approve again with show_dialog");
    err.code = "AUTH_FAILED";
    throw err;
  }
  return {
    refreshToken,
    accessToken: body.access_token,
    expiresIn: body.expires_in,
  };
}

module.exports = {
  getCurrentlyPlaying,
  getClientAccessToken,
  authUrl,
  exchangeCode,
  SCOPES,
};
