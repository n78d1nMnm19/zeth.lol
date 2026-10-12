const { getViews, bumpViews, json } = require("./_store");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }
  if (event.httpMethod === "GET") {
    return json(200, { count: await getViews() });
  }
  if (event.httpMethod === "POST") {
    return json(200, { count: await bumpViews() });
  }
  return json(405, { error: "method not allowed" });
};
