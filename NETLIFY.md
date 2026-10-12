# Publish on Netlify (site + emoji/views API in one drop)

Netlify **cannot** run a always-on Discord.js bot process. This project uses **Netlify Functions** instead, so when you drop/deploy the folder both the **site** and the **API / slash commands** go live together.

## 1. Deploy

1. Drag the whole `slits.lol` folder into Netlify (or connect Git)
2. Build settings are already in `netlify.toml` (publish `.`, functions in `netlify/functions`)

## 2. Environment variables (Netlify → Site settings → Environment variables)

| Variable | Where to get it |
|----------|-----------------|
| `DISCORD_PUBLIC_KEY` | Discord Developer Portal → your app → **General Information** → **Public Key** |
| `OWNER_ID` | Your Discord user ID (Developer Mode → Copy User ID) |
| `BADGE_API_SECRET` | Same random string as in `bot/.env` (lets your PC bot sync `/add` to the live site) |
| `DISCORD_TOKEN` | Bot token (only needed to **register** slash commands once) |
| `CLIENT_ID` | Application ID |
| `GUILD_ID` | Optional — your server ID for instant command register |

## 3. Point Discord at Netlify

Discord Developer Portal → your app → **General Information** → **Interactions Endpoint URL**:

```
https://YOUR-SITE.netlify.app/api/discord
```

(or `https://www.zethdl.lol/api/discord` if that domain is on this Netlify site)

Save — Discord will ping the endpoint; it must return OK.

## 4. Register slash commands (once, on your PC)

```powershell
cd bot
copy .env.example .env
```

Fill token / client / guild / owner, then:

```powershell
npm run register
```

## 5. Use

- Site: your Netlify URL  
- `/add` + `/remove` in Discord update badges on the live site  
- Views increment on “click to enter”

`config.js` already uses `apiBaseUrl: ""` so the site talks to the same Netlify domain automatically.
