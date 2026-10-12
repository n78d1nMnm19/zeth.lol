/**
 * Local site + API only (no Discord).
 * Run: npm run server
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { getViews, bumpViews, getBadges } = require("./store");
const ytmusic = require("../lib/ytmusic");
const npStore = require("./nowplaying-store");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8787;

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "server", ytmusic: ytmusic.authConfigured() });
});

app.get("/api/views", (_req, res) => {
  res.json({ count: getViews() });
});

app.post("/api/views", (_req, res) => {
  res.json({ count: bumpViews() });
});

app.get("/api/badges", (_req, res) => {
  res.json({ badges: getBadges() });
});

/** Live listening — browser bridge GET + POST (same path the userscript uses) */
app.get("/api/listening", async (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  try {
    npStore.ensureToken();
    const bridge = npStore.toListening(npStore.getState());
    if (bridge.listening && bridge.track) {
      return res.json(bridge);
    }
    return res.json({
      listening: false,
      track: null,
      configured: !!npStore.getToken(),
      ok: true,
      via: "bridge",
      message: "Install bridge at /ytmusic-setup.html",
    });
  } catch (e) {
    res.status(500).json({ listening: false, error: "server", message: String(e.message || e) });
  }
});

app.post("/api/listening", (req, res) => {
  const expected = npStore.ensureToken();
  const got =
    String(req.get("x-nowplaying-token") || "").trim() ||
    String((req.body && req.body.token) || "").trim();
  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, error: "bad token" });
  }
  const body = req.body || {};
  const playing = !!body.playing;
  const title = String(body.title || "").trim();
  npStore.setState({
    playing,
    title,
    artist: String(body.artist || "").trim(),
    album: String(body.album || "").trim(),
    art: String(body.art || "").trim(),
    videoId: String(body.videoId || "").trim(),
    positionSec: Number(body.positionSec) || 0,
    durationSec: Number(body.durationSec) || 0,
    updatedAt: Date.now(),
  });
  res.json({ ok: true, listening: playing && !!title, persisted: true });
});

app.get("/api/nowplaying", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.query.action === "setup" || req.query.action === "token") {
    const token = npStore.ensureToken();
    const live = npStore.toListening(npStore.getState());
    return res.json({
      ok: true,
      token,
      listening: !!live.listening,
      track: live.track || null,
      api: "/api/nowplaying",
    });
  }
  res.json(npStore.toListening(npStore.getState()));
});

app.post("/api/nowplaying", (req, res) => {
  const expected = npStore.ensureToken();
  const got =
    String(req.get("x-nowplaying-token") || "").trim() ||
    String((req.body && req.body.token) || "").trim();
  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, error: "bad token" });
  }
  const body = req.body || {};
  const playing = !!body.playing;
  const title = String(body.title || "").trim();
  npStore.setState({
    playing,
    title,
    artist: String(body.artist || "").trim(),
    album: String(body.album || "").trim(),
    art: String(body.art || "").trim(),
    videoId: String(body.videoId || "").trim(),
    positionSec: Number(body.positionSec) || 0,
    durationSec: Number(body.durationSec) || 0,
    updatedAt: Date.now(),
  });
  res.json({ ok: true, listening: playing && !!title });
});

app.get("/api/ytmusic-bridge", (_req, res) => {
  const token = npStore.ensureToken();
  const file = path.join(ROOT, "assets", "ytmusic-bridge.user.js");
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/%%NOWPLAYING_TOKEN%%/g, token);
  res.set("Content-Type", "text/javascript; charset=utf-8");
  res.set("Content-Disposition", 'inline; filename="ytmusic-bridge.user.js"');
  res.send(src);
});

/** Save YouTube Music cookie locally (dev setup page) */
app.post("/api/ytmusic/connect", async (req, res) => {
  const cookie = String((req.body && req.body.cookie) || "").trim();
  const authUser = (req.body && req.body.authUser) || "0";
  if (!cookie || cookie.length < 40) {
    return res.status(400).json({ ok: false, error: "cookie required" });
  }
  if (!ytmusic.cookieLooksValid(cookie)) {
    return res.status(400).json({
      ok: false,
      error:
        "cookie missing SAPISID — copy the full Cookie header from music.youtube.com (must include SAPISID or __Secure-3PAPISID)",
    });
  }
  const probe = await ytmusic.probeAuth(cookie, authUser);
  if (!probe.ok) {
    return res.status(400).json({
      ok: false,
      error: probe.message || probe.error || "auth failed",
      code: probe.error,
    });
  }
  ytmusic.saveHeaders(cookie, { authUser });
  ytmusic.applyAuth(cookie, authUser);
  res.json({ ok: true, configured: true, latest: probe.latest });
});

app.get("/api/ytmusic/status", (_req, res) => {
  res.json({ configured: ytmusic.authConfigured() });
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log("Site + API on http://localhost:" + PORT);
  console.log("YouTube Music bridge → /ytmusic-setup.html");
});
