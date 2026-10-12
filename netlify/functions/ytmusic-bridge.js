const { ensureNowPlayingToken } = require("./_store");
const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
  const token = await ensureNowPlayingToken();
  const host =
    (event.headers && (event.headers["x-forwarded-host"] || event.headers.host)) || "slits.lol";
  const proto = (event.headers && event.headers["x-forwarded-proto"]) || "https";
  const api = proto + "://" + String(host).split(",")[0].trim() + "/api/listening";

  let src = "";
  try {
    src = fs.readFileSync(path.join(__dirname, "../../assets/ytmusic-bridge.user.js"), "utf8");
  } catch {
    src = "";
  }
  if (!src) {
    return { statusCode: 404, body: "bridge script missing" };
  }

  const out = src
    .replace(/%%NOWPLAYING_TOKEN%%/g, token)
    .replace(/%%NOWPLAYING_API%%/g, api);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: out,
  };
};
