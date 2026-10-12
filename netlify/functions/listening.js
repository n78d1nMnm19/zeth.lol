/** @deprecated Prefer /api/spotify?action=now — kept as alias for old clients */
const { json, getSpotifyAuth, setSpotifyAuth } = require("./_store");
const spotify = require("../../lib/spotify");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "GET") return json(405, { error: "method not allowed" });

  const creds = await getSpotifyAuth();
  if (!creds || !creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return json(200, {
      listening: false,
      track: null,
      configured: false,
      ok: false,
      via: "spotify",
      error: "NO_AUTH",
      message: "Connect Spotify at /spotify-setup.html",
    });
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
    return json(200, {
      listening: !!data.listening,
      track: data.track || null,
      configured: true,
      ok: true,
      via: "spotify",
      fresh: !!data.fresh,
      paused: !!data.paused,
    });
  } catch (e) {
    return json(200, {
      listening: false,
      track: null,
      configured: true,
      ok: false,
      via: "spotify",
      error: e.code || "ERROR",
      message: e.message || "Spotify failed",
    });
  }
};
