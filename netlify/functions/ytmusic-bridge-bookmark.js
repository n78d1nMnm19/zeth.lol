const { ensureNowPlayingToken } = require("./_store");
const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
  const token = await ensureNowPlayingToken();
  const host =
    (event.headers && (event.headers["x-forwarded-host"] || event.headers.host)) || "slits.lol";
  const proto = (event.headers && event.headers["x-forwarded-proto"]) || "https";
  const api = proto + "://" + String(host).split(",")[0].trim() + "/api/listening";

  let src = fs.readFileSync(
    path.join(__dirname, "../../assets/ytmusic-bridge-bookmark.js"),
    "utf8"
  );
  src = src.replace(/%%TOKEN%%/g, token).replace(/%%API%%/g, api);

  const format = (event.queryStringParameters && event.queryStringParameters.format) || "js";

  if (format === "bookmarklet") {
    // Single-line javascript: URL
    const compact = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    const href = "javascript:" + encodeURIComponent("void " + compact);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: href,
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: src,
  };
};
