const {
  json,
  ensureNowPlayingToken,
  getNowPlayingToken,
  getNowPlaying,
  setNowPlaying,
  nowPlayingToListening,
} = require("./_store");

function pickToken(event, body) {
  const h =
    (event.headers &&
      (event.headers["x-nowplaying-token"] || event.headers["X-Nowplaying-Token"])) ||
    "";
  if (h) return String(h).trim();
  if (body && body.token) return String(body.token).trim();
  const q = event.queryStringParameters || {};
  if (q.token) return String(q.token).trim();
  return "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  // Setup: get or create the bridge token (no secrets in query from strangers — token itself is the secret once issued)
  if (event.httpMethod === "GET") {
    const action = (event.queryStringParameters && event.queryStringParameters.action) || "";
    if (action === "token" || action === "setup") {
      const token = await ensureNowPlayingToken();
      const np = await getNowPlaying();
      const live = nowPlayingToListening(np);
      return json(200, {
        ok: true,
        token,
        bridgeUrl: "/assets/ytmusic-bridge.user.js",
        listening: !!live.listening,
        track: live.track || null,
        api: "/api/nowplaying",
      });
    }
    // Public read of current push state (same as listening bridge source)
    const np = await getNowPlaying();
    return json(200, nowPlayingToListening(np));
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "invalid json" });
    }
    const expected = await getNowPlayingToken();
    if (!expected) {
      // First push can bootstrap token if body includes createToken (setup page only)
      if (body.bootstrap) {
        const token = await ensureNowPlayingToken();
        return json(200, { ok: true, token, bootstrapped: true });
      }
      return json(503, { ok: false, error: "token not initialized — open /ytmusic-setup.html" });
    }
    const got = pickToken(event, body);
    if (!got || got !== expected) {
      return json(401, { ok: false, error: "bad token" });
    }

    const playing = !!body.playing;
    const title = String(body.title || "").trim();
    const data = {
      playing,
      title,
      artist: String(body.artist || "").trim(),
      album: String(body.album || "").trim(),
      art: String(body.art || "").trim(),
      videoId: String(body.videoId || "").trim(),
      positionSec: Number(body.positionSec) || 0,
      durationSec: Number(body.durationSec) || 0,
      updatedAt: Date.now(),
    };
    // Persist (mem + blob). Mem makes same-instance reads instant.
    await setNowPlaying(data);
    // Keep /api/nowplaying working for old scripts; prefer /api/listening POST
    return json(200, {
      ok: true,
      listening: playing && !!title,
      t: data.updatedAt,
    });
  }

  return json(405, { error: "method not allowed" });
};
