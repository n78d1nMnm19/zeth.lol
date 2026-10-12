/**
 * Local site + API only (no Discord).
 * Run: npm run server
 */
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { getViews, bumpViews, getBadges } = require("./store");
const ytmusic = require("../lib/ytmusic");

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

/** Live YouTube Music listening (account history → now playing) */
app.get("/api/listening", async (_req, res) => {
  try {
    const data = await ytmusic.getListening();
    res.json(data);
  } catch (e) {
    res.status(500).json({ listening: false, error: "server", message: String(e.message || e) });
  }
});

/** Save YouTube Music cookie locally (dev setup page) */
app.post("/api/ytmusic/connect", (req, res) => {
  const cookie = String((req.body && req.body.cookie) || "").trim();
  if (!cookie || cookie.length < 20) {
    return res.status(400).json({ ok: false, error: "cookie required" });
  }
  if (cookie.toLowerCase().indexOf("sapisid=") === -1 && cookie.indexOf("__Secure-3PAPISID=") === -1) {
    return res.status(400).json({
      ok: false,
      error: "cookie missing SAPISID — copy the full Cookie header from music.youtube.com",
    });
  }
  ytmusic.saveHeaders(cookie, { authUser: (req.body && req.body.authUser) || "0" });
  res.json({ ok: true, configured: true });
});

app.get("/api/ytmusic/status", (_req, res) => {
  res.json({ configured: ytmusic.authConfigured() });
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log("Site + API on http://localhost:" + PORT);
  console.log(
    "YouTube Music: " + (ytmusic.authConfigured() ? "connected" : "not connected → /ytmusic-setup.html")
  );
});
