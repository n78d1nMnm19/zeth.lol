const { getBadges, setBadges, parseEmojiInput, json } = require("./_store");

function authorized(event) {
  const secret = String(process.env.BADGE_API_SECRET || "").trim();
  if (!secret) return false;
  const header =
    event.headers["x-badge-secret"] ||
    event.headers["X-Badge-Secret"] ||
    "";
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  return header === secret || bearer === secret;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  if (event.httpMethod === "GET") {
    return json(200, { badges: await getBadges() });
  }

  // Local PC bot pushes badge changes here (protected)
  if (event.httpMethod === "POST") {
    if (!authorized(event)) {
      return json(401, { error: "unauthorized" });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "bad json" });
    }

    const action = String(body.action || "sync").toLowerCase();

    if (action === "sync" && Array.isArray(body.badges)) {
      const cleaned = await setBadges(body.badges);
      return json(200, { badges: cleaned });
    }

    if (action === "add") {
      const parsed =
        body.badge && body.badge.id
          ? body.badge
          : parseEmojiInput(body.emoji || "");
      if (!parsed || !parsed.id || !parsed.url) {
        return json(400, { error: "need custom emoji / badge" });
      }
      const list = await getBadges();
      if (!list.some((b) => String(b.id) === String(parsed.id))) {
        list.push({
          id: String(parsed.id),
          name: String(parsed.name || parsed.id),
          animated: !!parsed.animated,
          url: String(parsed.url),
          addedAt: parsed.addedAt || new Date().toISOString(),
        });
        await setBadges(list);
      }
      return json(200, { badges: await getBadges() });
    }

    if (action === "remove") {
      const parsed = parseEmojiInput(body.emoji || "");
      const id = body.id || (parsed && parsed.id) || "";
      const name = body.name || (parsed && parsed.name) || "";
      const before = await getBadges();
      const after = before.filter((b) => {
        if (id && String(b.id) === String(id)) return false;
        if (name && String(b.name || "").toLowerCase() === String(name).toLowerCase()) {
          return false;
        }
        return true;
      });
      await setBadges(after);
      return json(200, { badges: after });
    }

    return json(400, { error: "unknown action" });
  }

  return json(405, { error: "method not allowed" });
};
