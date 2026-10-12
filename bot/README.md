# slits.lol bot + live views / custom badges

Keeps a **shared view counter** and lets you add/remove **custom Discord emojis** on the site badge row with slash commands.

## 1. Create the Discord app

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **Bot** → Add Bot → copy **Token**
3. **General Information** → copy **Application ID**
4. Enable **Developer Mode** in Discord → right‑click your profile → **Copy User ID**
5. Invite the bot to your server (OAuth2 → URL Generator):
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: none required for slash commands (or Administrator while testing)

## 2. Configure

```bash
cd bot
copy .env.example .env
```

Edit `.env`:

- `DISCORD_TOKEN` — bot token  
- `CLIENT_ID` — application ID  
- `OWNER_ID` — your Discord user ID  
- `GUILD_ID` — your server ID (optional but makes `/add` `/remove` show up instantly)  
- `PORT` — default `8787`

## 3. Install & register commands

```bash
cd bot
npm install
npm run register
npm start
```

Open **http://localhost:8787** (this serves the site + API).

## 4. Slash commands

| Command | What it does |
|--------|----------------|
| `/add emoji:` | Adds that custom emoji to the site badge row |
| `/remove emoji:` | Removes it (by emoji or name) |

Only `OWNER_ID` can use these.

The site polls `GET /api/badges` every 30s, so new emojis show without a hard refresh.

## 5. Point the site at the API

In `config.js`:

```js
apiBaseUrl: "http://localhost:8787",
```

When you deploy the bot (Railway, VPS, etc.), set `apiBaseUrl` to that public URL.

## API

- `GET /api/views` → `{ "count": 123 }`
- `POST /api/views` → increments and returns `{ "count": 124 }`
- `GET /api/badges` → `{ "badges": [ { "id", "name", "url", "animated" } ] }`
