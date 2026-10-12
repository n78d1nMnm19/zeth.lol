const { json, getYtMusicAuth, setYtMusicAuth } = require("./_store");
const ytmusic = require("../../lib/ytmusic");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  const path = String(event.path || "");
  const isStatus = path.indexOf("status") !== -1 || event.queryStringParameters?.action === "status";
  const isConnect =
    event.httpMethod === "POST" ||
    path.indexOf("connect") !== -1 ||
    event.queryStringParameters?.action === "connect";

  if (event.httpMethod === "GET" && (isStatus || !isConnect)) {
    const auth = await getYtMusicAuth();
    const env = String(process.env.YTMUSIC_COOKIE || "").trim();
    let cookie = "";
    let authUser = "0";
    if (auth && ytmusic.cookieLooksValid(auth.cookie)) {
      cookie = auth.cookie;
      authUser = auth.authUser || "0";
    } else if (ytmusic.cookieLooksValid(env)) {
      cookie = env;
      authUser = process.env.YTMUSIC_AUTH_USER || "0";
    }
    if (!cookie) {
      return json(200, { configured: false, ok: false });
    }
    const probe = await ytmusic.probeAuth(cookie, authUser);
    return json(200, {
      configured: !!probe.ok,
      ok: !!probe.ok,
      error: probe.ok ? undefined : probe.error,
      message: probe.ok ? undefined : probe.message,
      latest: probe.latest || null,
    });
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "invalid json" });
    }
    const cookie = String(body.cookie || "").trim();
    const authUser = String(body.authUser || "0");
    if (!cookie || cookie.length < 40) {
      return json(400, { ok: false, error: "cookie required" });
    }
    if (!ytmusic.cookieLooksValid(cookie)) {
      return json(400, {
        ok: false,
        error: "cookie missing SAPISID — copy the full Cookie header from music.youtube.com (must include SAPISID or __Secure-3PAPISID)",
      });
    }
    const probe = await ytmusic.probeAuth(cookie, authUser);
    if (!probe.ok) {
      return json(400, {
        ok: false,
        error: probe.message || probe.error || "auth failed",
        code: probe.error,
      });
    }
    await setYtMusicAuth({ cookie, authUser });
    return json(200, {
      ok: true,
      configured: true,
      latest: probe.latest,
    });
  }

  return json(405, { error: "method not allowed" });
};
