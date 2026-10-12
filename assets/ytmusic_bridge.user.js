// ==UserScript==
// @name         slits.lol YouTube Music bridge
// @namespace    https://slits.lol
// @version      1.4.0
// @description  Pushes what you're playing on YouTube Music to slits.lol
// @match        *://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      slits.lol
// @connect      *.netlify.app
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // These get filled when you use Copy script on slits.lol/ytmusic-setup.html
  var API = "%%NOWPLAYING_API%%";
  var TOKEN = "%%NOWPLAYING_TOKEN%%";

  if (!API || API.indexOf("%%") !== -1) API = "https://slits.lol/api/listening";
  if (!TOKEN || TOKEN.indexOf("%%") !== -1) TOKEN = "";

  try {
    var saved = typeof GM_getValue === "function" ? GM_getValue("token", "") : "";
    if (saved) TOKEN = saved;
    var savedApi = typeof GM_getValue === "function" ? GM_getValue("api", "") : "";
    if (savedApi) API = savedApi;
  } catch (e0) {}

  try {
    var u = new URL(location.href);
    var qTok = u.searchParams.get("slits_token");
    var qApi = u.searchParams.get("slits_api");
    if (qTok && qTok.length > 8) {
      TOKEN = qTok;
      if (typeof GM_setValue === "function") GM_setValue("token", qTok);
      u.searchParams.delete("slits_token");
      if (qApi) {
        API = qApi;
        if (typeof GM_setValue === "function") GM_setValue("api", qApi);
        u.searchParams.delete("slits_api");
      }
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch (e1) {}

  // Persist baked-in token so reloads keep working
  if (TOKEN && typeof GM_setValue === "function") {
    try {
      GM_setValue("token", TOKEN);
      GM_setValue("api", API);
    } catch (e2) {}
  }

  var lastSig = "";
  var lastSent = 0;
  var inFlight = false;
  var badge = null;

  function setBadge(text, ok) {
    try {
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "slits-bridge-badge";
        badge.style.cssText =
          "position:fixed;z-index:999999;left:10px;bottom:90px;padding:6px 10px;" +
          "border-radius:8px;font:12px/1.3 sans-serif;background:#111;color:#fff;" +
          "border:1px solid #333;opacity:0.92;pointer-events:none;";
        (document.body || document.documentElement).appendChild(badge);
      }
      badge.textContent = "slits.lol · " + text;
      badge.style.borderColor = ok ? "#4ade80" : "#fbbf24";
    } catch (e3) {}
  }

  function textOf(sel) {
    var el = document.querySelector(sel);
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isPlayingUi() {
    var video = document.querySelector("video");
    if (video && !video.paused && !video.ended) return true;

    var btn = document.querySelector(
      "#play-pause-button, .play-pause-button, ytmusic-play-button-renderer#play-pause-button"
    );
    var label = (
      (btn &&
        (btn.getAttribute("title") ||
          btn.getAttribute("aria-label") ||
          btn.getAttribute("aria-pressed") ||
          "")) ||
      ""
    ).toLowerCase();
    // EN: pause / NL: pauze / pauzeren / DE: pausieren
    if (/pauze|pause|anhalten/.test(label)) return true;
    // If label is play/afspelen → not playing
    if (/^(play|afspelen|wiedergabe)/.test(label) || /\bplay\b/.test(label)) return false;
    if (btn && btn.getAttribute("aria-pressed") === "true") return true;

    // Fallback: progress moving / time display exists with title
    return false;
  }

  function readPlayer() {
    var title =
      textOf("yt-formatted-string.title.ytmusic-player-bar") ||
      textOf(".title.ytmusic-player-bar") ||
      textOf("ytmusic-player-bar yt-formatted-string.title") ||
      textOf("ytmusic-player-bar .title");
    var byline =
      textOf("yt-formatted-string.byline.ytmusic-player-bar") ||
      textOf(".byline.ytmusic-player-bar") ||
      textOf("ytmusic-player-bar .byline");
    // YT Music may use · or •
    var parts = byline.split(/\s*[•·]\s*/);
    var artist = (parts[0] || "").trim();
    var album = parts.length > 1 ? parts.slice(1).join(" · ").trim() : "";

    var videoId = "";
    var link =
      document.querySelector("ytmusic-player-bar a.yt-simple-endpoint[href*='watch']") ||
      document.querySelector("a.ytmusic-player-bar[href*='watch']") ||
      document.querySelector("ytmusic-player-bar a[href*='watch']");
    if (link && link.href) {
      try {
        videoId = new URL(link.href, location.origin).searchParams.get("v") || "";
      } catch (e4) {}
    }
    if (!videoId) {
      var m = location.href.match(/[?&]v=([\w-]{11})/);
      if (m) videoId = m[1];
    }

    var art = "";
    var img =
      document.querySelector("ytmusic-player-bar img.ytmusic-player-bar") ||
      document.querySelector("ytmusic-player-bar img");
    if (img && (img.src || img.currentSrc)) art = img.currentSrc || img.src;

    var video = document.querySelector("video");
    var positionSec = video ? Number(video.currentTime) || 0 : 0;
    var durationSec = video ? Number(video.duration) || 0 : 0;
    if (!isFinite(durationSec)) durationSec = 0;

    try {
      if (navigator.mediaSession && navigator.mediaSession.metadata) {
        var md = navigator.mediaSession.metadata;
        title = title || md.title || "";
        artist = artist || md.artist || "";
        album = album || md.album || "";
        if (!art && md.artwork && md.artwork.length) {
          art = md.artwork[md.artwork.length - 1].src || "";
        }
      }
    } catch (e5) {}

    var playing = isPlayingUi();
    // On a watch page with a title, treat as playing unless clearly paused
    if (!playing && title && videoId && video && video.paused === false) playing = true;
    if (!playing && title && videoId && positionSec > 0 && durationSec > 0) {
      // progress bar present mid-song — likely playing (covers odd locales)
      var btn2 = document.querySelector("#play-pause-button");
      var lab2 = ((btn2 && (btn2.getAttribute("title") || btn2.getAttribute("aria-label"))) || "").toLowerCase();
      if (!/^(play|afspelen)/.test(lab2) && lab2.indexOf("afspelen") === -1) {
        if (/pauze|pause|anhalten/.test(lab2) || !lab2) playing = true;
      }
    }

    return {
      playing: !!(playing && title),
      title: title,
      artist: artist,
      album: album,
      art: art,
      videoId: videoId,
      positionSec: Math.floor(positionSec),
      durationSec: Math.floor(durationSec),
    };
  }

  function post(payload) {
    if (!TOKEN) {
      setBadge("no key — re-copy script from setup", false);
      return;
    }
    var sig =
      (payload.playing ? "1" : "0") +
      "|" +
      (payload.videoId || "") +
      "|" +
      (payload.title || "");
    var now = Date.now();
    var changed = sig !== lastSig;
    if (!changed && now - lastSent < 1000) return;
    if (inFlight && !changed) return;

    lastSig = sig;
    lastSent = now;
    inFlight = true;

    var body = JSON.stringify(Object.assign({ token: TOKEN }, payload));

    function done(ok, extra) {
      inFlight = false;
      if (!ok) {
        setBadge("push failed " + (extra || ""), false);
        return;
      }
      if (payload.playing) setBadge("live · " + (payload.title || "playing"), true);
      else setBadge("idle", false);
    }

    if (typeof GM_xmlhttpRequest === "function") {
      GM_xmlhttpRequest({
        method: "POST",
        url: API,
        headers: {
          "Content-Type": "application/json",
          "X-Nowplaying-Token": TOKEN,
        },
        data: body,
        timeout: 5000,
        onload: function (res) {
          done(res.status >= 200 && res.status < 300, "HTTP " + res.status);
        },
        onerror: function () {
          done(false, "network");
        },
        ontimeout: function () {
          done(false, "timeout");
        },
      });
      return;
    }

    fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nowplaying-Token": TOKEN,
      },
      body: body,
      mode: "cors",
      keepalive: true,
    })
      .then(function (r) {
        done(r.ok, "HTTP " + r.status);
      })
      .catch(function () {
        done(false, "network");
      });
  }

  function tick() {
    try {
      var p = readPlayer();
      post(p);
    } catch (e6) {
      setBadge("error", false);
    }
  }

  if (!TOKEN) {
    setBadge("no key — copy script from slits.lol/ytmusic-setup.html", false);
  } else {
    setBadge("starting…", false);
  }

  setInterval(tick, 500);
  document.addEventListener("play", tick, true);
  document.addEventListener("pause", tick, true);
  document.addEventListener("visibilitychange", tick);

  try {
    var bar = document.querySelector("ytmusic-player-bar") || document.body;
    var obsTimer = 0;
    new MutationObserver(function () {
      if (obsTimer) clearTimeout(obsTimer);
      obsTimer = setTimeout(tick, 60);
    }).observe(bar, { subtree: true, childList: true, characterData: true });
  } catch (e7) {}

  setTimeout(tick, 300);
  setTimeout(tick, 1000);
  console.info("[slits.lol] bridge v1.4 · api=" + API + " · token=" + (TOKEN ? "yes" : "NO"));
})();
