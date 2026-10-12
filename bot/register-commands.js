/**
 * Register slash commands.
 * Run: npm run register
 */
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = (process.env.GUILD_ID || "").trim();

if (!token || !clientId) {
  console.error("Set DISCORD_TOKEN and CLIENT_ID in bot/.env");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add one emoji/sticker to the live site")
    .addStringOption((opt) =>
      opt
        .setName("emoji")
        .setDescription("Custom server emoji (optional if you attach a file)")
        .setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt
        .setName("sticker")
        .setDescription("Sticker or image file to add")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove one emoji/sticker from the live site")
    .addStringOption((opt) =>
      opt
        .setName("emoji")
        .setDescription("Emoji name, id, or sticker name")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("massadd")
    .setDescription("Mass-add many custom emojis at once")
    .addStringOption((opt) =>
      opt
        .setName("emojis")
        .setDescription("Paste many custom emojis in one message")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("massremove")
    .setDescription("Mass-remove many custom emojis at once")
    .addStringOption((opt) =>
      opt
        .setName("emojis")
        .setDescription("Paste many emojis or names (space/comma separated)")
        .setRequired(true)
    )
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log("Registered guild commands for", guildId);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("Registered global commands (can take up to ~1 hour to appear)");
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
