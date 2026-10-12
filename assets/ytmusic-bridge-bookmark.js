/**
 * Compact bridge for bookmarklet / console paste (no Tampermonkey).
 * Placeholders replaced by /api/ytmusic-bridge-bookmark
 */
(function () {
  var API = "%%API%%";
  var TOKEN = "%%TOKEN%%";
  if (window.__SLITS_BRIDGE__) {
    window.__SLITS_BRIDGE__.stop && window.__SLITS_BRIDGE__.stop();
  }
  function $(s) {
    return document.querySelector(s);
  }
  function txt(s) {
    var el = $(s);
    return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }
  function playing() {
    var v = $("video");
    if (v && !v.paused && !v.ended) return true;
    var b = $("#play-pause-button");
    var a = ((b && (b.getAttribute("title") || b.getAttribute("aria-label"))) || "").toLowerCase();
    return /pauze|pause|anhalten/.test(a);
  }
  function read() {
    var title =
      txt("yt-formatted-string.title.ytmusic-player-bar") ||
      txt(".title.ytmusic-player-bar") ||
      txt("ytmusic-player-bar .title");
    var by = txt("yt-formatted-string.byline.ytmusic-player-bar") || txt(".byline.ytmusic-player-bar");
    var bits = by.split(/\s*[•·]\s*/);
    var artist = (bits[0] || "").trim();
    var album = bits.length > 1 ? bits.slice(1).join(" · ") : "";
    var videoId = "";
    var a = $("ytmusic-player-bar a[href*='watch']") || $("a.ytmusic-player-bar[href*='watch']");
    if (a && a.href) {
      try {
        videoId = new URL(a.href).searchParams.get("v") || "";
      } catch (e) {}
    }
    if (!videoId) {
      var m = location.href.match(/[?&]v=([\w-]{11})/);
      if (m) videoId = m[1];
    }
    var img = $("ytmusic-player-bar img");
    var art = img ? img.currentSrc || img.src || "" : "";
    var v = $("video");
    var pos = v ? Math.floor(v.currentTime || 0) : 0;
    var dur = v && isFinite(v.duration) ? Math.floor(v.duration) : 0;
    try {
      if ((!title || !artist) && navigator.mediaSession && navigator.mediaSession.metadata) {
        var md = navigator.mediaSession.metadata;
        title = title || md.title || "";
        artist = artist || md.artist || "";
        album = album || md.album || "";
      }
    } catch (e2) {}
    var on = playing() && !!title;
    if (!on && title && videoId && v && v.paused === false) on = true;
    return {
      playing: on,
      title: title,
      artist: artist,
      album: album,
      art: art,
      videoId: videoId,
      positionSec: pos,
      durationSec: dur,
      token: TOKEN,
    };
  }
  var badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;z-index:2147483647;left:12px;bottom:96px;padding:8px 12px;border-radius:10px;font:13px/1.3 system-ui,sans-serif;background:#0a0a0a;color:#fff;border:2px solid #4ade80;box-shadow:0 8px 24px rgba(0,0,0,.5)";
  badge.textContent = "slits.lol bridge ON";
  document.documentElement.appendChild(badge);
  var last = "";
  var timer = setInterval(function () {
    var p = read();
    var sig = (p.playing ? "1" : "0") + "|" + p.videoId + "|" + p.title;
    if (sig === last && Date.now() - (timer._t || 0) < 900) return;
    last = sig;
    timer._t = Date.now();
    badge.style.borderColor = p.playing ? "#4ade80" : "#fbbf24";
    badge.textContent = p.playing ? "slits.lol · " + p.title : "slits.lol · paused";
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Nowplaying-Token": TOKEN },
      body: JSON.stringify(p),
      mode: "cors",
      keepalive: true,
    }).catch(function () {
      badge.style.borderColor = "#f87171";
      badge.textContent = "slits.lol · push failed";
    });
  }, 500);
  window.__SLITS_BRIDGE__ = {
    stop: function () {
      clearInterval(timer);
      badge.remove();
    },
  };
})();
