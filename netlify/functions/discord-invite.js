/**
 * Proxy Discord's public invite API (browser can't call discord.com — CORS).
 * GET /api/discord-invite?code=endings
 */
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=30",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "METHOD" }),
    };
  }

  const q = event.queryStringParameters || {};
  let code = String(q.code || q.invite || "").trim();
  if (!code) {
    code = String(process.env.DISCORD_INVITE_CODE || "endings").trim();
  }
  if (!/^[a-zA-Z0-9-]{2,40}$/.test(code)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "BAD_CODE" }),
    };
  }

  try {
    const url =
      "https://discord.com/api/v10/invites/" +
      encodeURIComponent(code) +
      "?with_counts=true&with_expiration=true";
    const r = await fetch(url, {
      headers: { "User-Agent": "slits.lol-discord-invite/1.0" },
    });
    const body = await r.text();
    if (!r.ok) {
      return {
        statusCode: r.status >= 500 ? 502 : r.status,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "DISCORD_" + r.status,
          message: body.slice(0, 200),
        }),
      };
    }
    const inv = JSON.parse(body);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        code: inv.code || code,
        guild: inv.guild || null,
        guild_id: inv.guild_id || (inv.guild && inv.guild.id) || "",
        profile: inv.profile || null,
        approximate_member_count: inv.approximate_member_count,
        approximate_presence_count: inv.approximate_presence_count,
      }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "PROXY",
        message: String(e.message || e),
      }),
    };
  }
};
