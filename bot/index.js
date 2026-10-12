/**
 * Optional: start site/API + Discord bot together.
 * Prefer separate commands:
 *   npm run server   → site only
 *   npm run bot      → Discord bot only
 */
require("./server");
require("./discord-bot");
