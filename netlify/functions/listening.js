const { json } = require("./_store");
const ytmusic = require("../../lib/ytmusic");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "GET") return json(405, { error: "method not allowed" });
  try {
    const data = await ytmusic.getListening();
    return json(200, data);
  } catch (e) {
    return json(500, { listening: false, error: "server", message: String(e.message || e) });
  }
};
