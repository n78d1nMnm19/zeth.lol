const nacl = require("tweetnacl");
const {
  getBadges,
  setBadges,
  parseEmojiInput,
  json,
} = require("./_store");

function hexToUint8Array(hex) {
  const matches = hex.match(/.{1,2}/g) || [];
  return new Uint8Array(matches.map((b) => parseInt(b, 16)));
}

function verifyDiscordRequest(event) {
  const publicKey = (process.env.DISCORD_PUBLIC_KEY || "").trim();
  if (!publicKey) return false;

  const signature = event.headers["x-signature-ed25519"] || event.headers["X-Signature-Ed25519"];
  const timestamp = event.headers["x-signature-timestamp"] || event.headers["X-Signature-Timestamp"];
  const body = event.body || "";

  if (!signature || !timestamp || !body) return false;

  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      hexToUint8Array(signature),
      hexToUint8Array(publicKey)
    );
  } catch {
    return false;
  }
}

function optionString(interaction, name) {
  const opts = (interaction.data && interaction.data.options) || [];
  const hit = opts.find((o) => o.name === name);
  return hit ? String(hit.value || "") : "";
}

async function handleAdd(interaction) {
  const ownerId = (process.env.OWNER_ID || "").trim();
  const userId = interaction.member?.user?.id || interaction.user?.id || "";
  if (!ownerId || userId !== ownerId) {
    return {
      type: 4,
      data: { content: "Only the site owner can manage badge emojis.", flags: 64 },
    };
  }

  const raw = optionString(interaction, "emoji");
  const parsed = parseEmojiInput(raw);
  if (!parsed || !parsed.id || !parsed.url) {
    return {
      type: 4,
      data: {
        content: "Send a **custom** server emoji (from the emoji picker).",
        flags: 64,
      },
    };
  }

  const list = await getBadges();
  if (list.some((b) => String(b.id) === String(parsed.id))) {
    return {
      type: 4,
      data: {
        content: `:${parsed.name}: is already on the site badges.`,
        flags: 64,
      },
    };
  }

  list.push({
    id: parsed.id,
    name: parsed.name,
    animated: !!parsed.animated,
    url: parsed.url,
    addedAt: new Date().toISOString(),
  });
  await setBadges(list);

  return {
    type: 4,
    data: {
      content: `Added :${parsed.name}: to site badges (${list.length} custom).`,
      flags: 64,
    },
  };
}

async function handleRemove(interaction) {
  const ownerId = (process.env.OWNER_ID || "").trim();
  const userId = interaction.member?.user?.id || interaction.user?.id || "";
  if (!ownerId || userId !== ownerId) {
    return {
      type: 4,
      data: { content: "Only the site owner can manage badge emojis.", flags: 64 },
    };
  }

  const raw = optionString(interaction, "emoji");
  const parsed = parseEmojiInput(raw);
  if (!parsed) {
    return {
      type: 4,
      data: { content: "Could not parse that emoji / name.", flags: 64 },
    };
  }

  const before = await getBadges();
  const after = before.filter((b) => {
    if (parsed.id && String(b.id) === String(parsed.id)) return false;
    if (
      parsed.name &&
      String(b.name || "").toLowerCase() === String(parsed.name).toLowerCase()
    ) {
      return false;
    }
    return true;
  });

  if (after.length === before.length) {
    return {
      type: 4,
      data: { content: "That emoji was not on the site badges.", flags: 64 },
    };
  }

  await setBadges(after);
  return {
    type: 4,
    data: {
      content: `Removed from site badges (${after.length} custom left).`,
      flags: 64,
    },
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  if (event.httpMethod !== "POST") {
    return json(405, { error: "method not allowed" });
  }

  if (!verifyDiscordRequest(event)) {
    return { statusCode: 401, body: "invalid request signature" };
  }

  let interaction;
  try {
    interaction = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "bad json" });
  }

  // Discord ping
  if (interaction.type === 1) {
    return json(200, { type: 1 });
  }

  // Application command
  if (interaction.type === 2) {
    const name = interaction.data && interaction.data.name;
    let response;
    if (name === "add") response = await handleAdd(interaction);
    else if (name === "remove") response = await handleRemove(interaction);
    else {
      response = {
        type: 4,
        data: { content: "Unknown command.", flags: 64 },
      };
    }
    return json(200, response);
  }

  return json(200, { type: 1 });
};
