/**
 * Live listening card (Spotify / Lanyard) + synced lyrics.
 * No YouTube mirror — site audio comes from config.soundUrl only.
 */
(function (w) {
  var lines = [];
  var activeIdx = -1;
  var trackKey = "";
  var trackMeta = null;
  var rafId = 0;
  var fetchSeq = 0;
  var lastFetchKey = "";
  var listeningListeners = [];
  var wasListening = false;
  var lastEmittedKey = "";
  var accountConfigured = false;
  var accountActive = false;
  var accountPollTimer = null;
  var trackSource = ""; // "account" | "lanyard"
  /** Don't yank the card off on brief Spotify 204 / false is_playing blips */
  var stickyClearTimer = null;
  var STICKY_CLEAR_MS = 5000;
  var lastAccountTrack = null;
  var isMobile =
    !!w.matchMedia &&
    (w.matchMedia("(pointer: coarse)").matches || w.matchMedia("(max-width: 768px)").matches);

  function emitListeningChange(meta) {
    var on = !!meta;
    var key = (meta && meta.key) || "";
    if (on === wasListening && key === lastEmittedKey) return;
    wasListening = on;
    lastEmittedKey = key;
    for (var i = 0; i < listeningListeners.length; i++) {
      try {
        listeningListeners[i](meta || null);
      } catch (e0) {}
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function hideMirrorUi() {
    var host = $("listen-yt-host");
    if (host) host.classList.add("hidden");
    var btn = $("listen-sound-btn");
    if (btn) btn.classList.add("hidden");
  }

  function discordAssetUrl(applicationId, asset) {
    var a = String(asset || "").trim();
    if (!a) return "";
    if (/^https?:\/\//i.test(a)) return a;
    if (a.indexOf("spotify:") === 0) {
      return "https://i.scdn.co/image/" + a.slice("spotify:".length);
    }
    if (a.indexOf("mp:external/") === 0) {
      var rest = a.slice("mp:external/".length);
      var m = rest.match(/^(?:[^/]+\/)?(https?)\/(.+)$/i);
      if (m) return m[1] + "://" + m[2];
      return "https://media.discordapp.net/external/" + rest;
    }
    var app = String(applicationId || "").trim();
    if (app) {
      return (
        "https://cdn.discordapp.com/app-assets/" +
        encodeURIComponent(app) +
        "/" +
        encodeURIComponent(a) +
        ".png"
      );
    }
    return "";
  }

  function isYoutubeMusicName(name) {
    var n = String(name || "").toLowerCase();
    return n.indexOf("youtube music") !== -1 || n === "youtube" || n.indexOf("youtubemusic") !== -1;
  }

  function extractListening(d) {
    if (!d) return null;

    if (d.listening_to_spotify && d.spotify) {
      var sp = d.spotify;
      var song = String(sp.song || "").trim();
      var artist = String(sp.artist || "").split(";")[0].trim();
      if (song) {
        return {
          source: "spotify",
          title: song,
          artist: artist,
          album: String(sp.album || "").trim(),
          art: String(sp.album_art_url || "").trim(),
          start: Number(sp.timestamps && sp.timestamps.start) || 0,
          end: Number(sp.timestamps && sp.timestamps.end) || 0,
          key: "spotify:" + String(sp.track_id || song + "|" + artist),
        };
      }
    }

    var activities = d.activities || [];
    var i;
    var a;
    var best = null;

    function fromActivity(act, sourceOverride) {
      var title = String(act.details || "").trim();
      var artistLine = String(act.state || "").trim();
      var artist = artistLine.split("·")[0].trim();
      var album = "";
      if (artistLine.indexOf("·") !== -1) {
        album = artistLine.split("·").slice(1).join("·").trim();
      }
      if (!title) return null;
      var name = String(act.name || "");
      var source =
        sourceOverride ||
        (isYoutubeMusicName(name) ? "youtube music" : name ? name.toLowerCase() : "listening");
      var start = Number(act.timestamps && act.timestamps.start) || 0;
      var end = Number(act.timestamps && act.timestamps.end) || 0;
      var art = "";
      if (act.assets) {
        art = discordAssetUrl(act.application_id, act.assets.large_image);
      }
      return {
        source: source,
        title: title,
        artist: artist,
        album: album,
        art: art,
        start: start,
        end: end,
        key: source + ":" + title + "|" + artist + "|" + start,
      };
    }

    for (i = 0; i < activities.length; i++) {
      a = activities[i];
      if (!a) continue;
      if (a.type === 2) {
        var listen = fromActivity(a);
        if (listen) {
          if (listen.source === "youtube music") return listen;
          if (!best) best = listen;
        }
      }
    }
    if (best) return best;

    for (i = 0; i < activities.length; i++) {
      a = activities[i];
      if (!a || a.type !== 3) continue;
      if (!isYoutubeMusicName(a.name) && String(a.name || "").toLowerCase().indexOf("youtube") === -1) {
        continue;
      }
      var watch = fromActivity(a, isYoutubeMusicName(a.name) ? "youtube music" : "youtube");
      if (watch) return watch;
    }
    return null;
  }

  function progressMs(meta) {
    if (!meta) return 0;
    if (meta.paused && typeof meta.progressMs === "number") {
      return Math.max(0, meta.progressMs);
    }
    if (meta.start) {
      var elapsed = Date.now() - meta.start;
      if (meta.end && meta.end > meta.start) {
        elapsed = Math.min(Math.max(0, elapsed), meta.end - meta.start);
      }
      return Math.max(0, elapsed);
    }
    if (typeof meta.progressMs === "number") {
      return Math.max(0, meta.progressMs);
    }
    return 0;
  }

  function resetLyricsScroll() {
    var track = $("lyrics-track");
    if (!track) return;
    var prev = track.style.transition;
    track.style.transition = "none";
    track.style.transform = "translate3d(0,0,0)";
    void track.offsetHeight;
    track.style.transition = prev || "";
  }

  function cancelStickyClear() {
    if (stickyClearTimer) {
      clearTimeout(stickyClearTimer);
      stickyClearTimer = null;
    }
  }

  function scheduleStickyClear() {
    if (stickyClearTimer) return;
    stickyClearTimer = w.setTimeout(function () {
      stickyClearTimer = null;
      lastAccountTrack = null;
      clearListeningUi();
    }, STICKY_CLEAR_MS);
  }

  function durationSec(meta) {
    if (!meta) return 0;
    if (meta.end && meta.start && meta.end > meta.start) {
      return Math.round((meta.end - meta.start) / 1000);
    }
    return Number(meta.durationSec) || 0;
  }

  function setListeningUi(meta) {
    hideMirrorUi();
    var idle = $("now-idle");
    var listen = $("now-listening");
    var panel = $("lyrics-panel");
    if (!meta) {
      if (idle) idle.classList.remove("hidden");
      if (listen) listen.classList.add("hidden");
      if (panel) panel.classList.add("hidden");
      return;
    }
    if (idle) idle.classList.add("hidden");
    if (listen) listen.classList.remove("hidden");
    if (panel) panel.classList.remove("hidden");

    var titleEl = $("listen-title");
    var artistEl = $("listen-artist");
    var artEl = $("listen-art");
    if (titleEl) titleEl.textContent = meta.title || "";
    if (artistEl) artistEl.textContent = meta.artist || "";
    if (artEl) {
      artEl.onerror = function () {
        artEl.classList.add("listen-art--fallback");
        artEl.removeAttribute("src");
      };
      if (meta.art) {
        artEl.classList.remove("listen-art--fallback");
        artEl.src = meta.art;
        artEl.classList.remove("hidden");
      } else {
        artEl.classList.add("listen-art--fallback");
        artEl.removeAttribute("src");
        artEl.classList.remove("hidden");
      }
    }
  }

  function renderLyricLines(list) {
    var track = $("lyrics-track");
    if (!track) return;
    track.textContent = "";
    resetLyricsScroll();
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "lyrics-empty";
      empty.textContent = "lyrics unavailable";
      track.appendChild(empty);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var p = document.createElement("p");
      p.className = "lyrics-line";
      p.setAttribute("data-i", String(i));
      p.textContent = list[i].text;
      track.appendChild(p);
    }
  }

  function indexForTime(ms) {
    if (!lines.length) return -1;
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].t <= ms) idx = i;
      else break;
    }
    return idx;
  }

  function scrollActiveIntoView(idx) {
    var panel = $("lyrics-panel");
    var track = $("lyrics-track");
    if (!panel || !track || idx < 0) return;
    var el = track.querySelector('.lyrics-line[data-i="' + idx + '"]');
    if (!el) return;
    var panelH = panel.clientHeight;
    var elTop = el.offsetTop;
    var elH = el.offsetHeight;
    var target = elTop - panelH / 2 + elH / 2;
    track.style.transform = "translate3d(0," + -Math.max(0, target) + "px,0)";
  }

  function paintActive(idx) {
    var track = $("lyrics-track");
    if (!track) return;
    var nodes = track.querySelectorAll(".lyrics-line");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var di = parseInt(n.getAttribute("data-i"), 10);
      n.classList.toggle("is-active", di === idx);
      n.classList.toggle("is-past", di < idx);
      n.classList.toggle("is-next", di === idx + 1);
    }
    scrollActiveIntoView(idx);
  }

  function tick() {
    rafId = 0;
    if (!trackMeta || !lines.length) return;
    var ms = progressMs(trackMeta);
    var idx = indexForTime(ms);
    if (idx !== activeIdx) {
      activeIdx = idx;
      paintActive(idx);
    }
    rafId = w.requestAnimationFrame(tick);
  }

  function startTicker() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = w.requestAnimationFrame(tick);
  }

  function stopTicker() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    activeIdx = -1;
  }

  function applyLyricsPayload(meta, body) {
    if (!trackMeta || trackMeta.key !== meta.key) return;
    if (body && body.instrumental) {
      lines = [];
      setListeningUi(trackMeta);
      var trackEl = $("lyrics-track");
      if (trackEl) {
        trackEl.textContent = "";
        resetLyricsScroll();
        var empty = document.createElement("p");
        empty.className = "lyrics-empty";
        empty.textContent = "instrumental";
        trackEl.appendChild(empty);
      }
      stopTicker();
      return;
    }
    lines = Array.isArray(body && body.lines) ? body.lines : [];
    setListeningUi(trackMeta);
    renderLyricLines(lines);
    activeIdx = -1;
    if (lines.length) {
      var idx = indexForTime(progressMs(trackMeta));
      activeIdx = idx;
      paintActive(idx);
    }
    startTicker();
  }

  function fetchLyrics(meta) {
    var seq = ++fetchSeq;
    if (meta && meta.lyrics && Array.isArray(meta.lyrics.lines) && meta.lyrics.lines.length) {
      applyLyricsPayload(meta, meta.lyrics);
      return Promise.resolve();
    }
    if (meta && meta.lyrics && meta.lyrics.instrumental) {
      applyLyricsPayload(meta, meta.lyrics);
      return Promise.resolve();
    }

    var title = meta.title || "";
    var artist = meta.artist || "";
    var album = meta.album || "";
    var dur = durationSec(meta);
    var q =
      "/api/lyrics?title=" +
      encodeURIComponent(title) +
      "&artist=" +
      encodeURIComponent(artist) +
      "&album=" +
      encodeURIComponent(album) +
      "&duration=" +
      encodeURIComponent(String(dur || 0)) +
      "&_=" +
      Date.now();

    return fetch(q, { credentials: "omit", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("lyrics " + r.status);
        return r.json();
      })
      .then(function (body) {
        if (seq !== fetchSeq) return;
        applyLyricsPayload(meta, body);
      })
      .catch(function () {
        if (seq !== fetchSeq || !trackMeta || trackMeta.key !== meta.key) return;
        lines = [];
        setListeningUi(trackMeta);
        renderLyricLines([]);
        stopTicker();
      });
  }

  function clearListeningUi() {
    cancelStickyClear();
    trackMeta = null;
    trackKey = "";
    lastFetchKey = "";
    trackSource = "";
    accountActive = false;
    lines = [];
    setListeningUi(null);
    stopTicker();
    var track = $("lyrics-track");
    if (track) {
      track.textContent = "";
      resetLyricsScroll();
    }
    emitListeningChange(null);
  }

  function applyTrack(meta, source) {
    if (!meta) {
      if (trackSource === source || !trackMeta) scheduleStickyClear();
      return null;
    }
    cancelStickyClear();

    var prevKey = trackKey;
    setListeningUi(meta);
    trackMeta = meta;
    trackSource = source || trackSource || "lanyard";
    if (source === "account") lastAccountTrack = meta;

    if (meta.key !== prevKey) {
      trackKey = meta.key;
      stopTicker();
      lines = [];
      activeIdx = -1;
      lastFetchKey = meta.key;
      var trackEl = $("lyrics-track");
      if (trackEl) {
        trackEl.textContent = "";
        resetLyricsScroll();
        var loading = document.createElement("p");
        loading.className = "lyrics-empty";
        loading.textContent = "loading lyrics…";
        trackEl.appendChild(loading);
      }
      fetchLyrics(meta);
      emitListeningChange(meta);
    } else {
      if (meta.lyrics && meta.lyrics.lines && meta.lyrics.lines.length && !lines.length) {
        applyLyricsPayload(meta, meta.lyrics);
      } else if (meta.lyrics && meta.lyrics.instrumental && lines.length) {
        applyLyricsPayload(meta, meta.lyrics);
      }
      if (lines.length) startTicker();
      emitListeningChange(meta);
    }
    return meta;
  }

  function applyFromLanyard(d) {
    if (accountConfigured) return trackMeta;
    var meta = extractListening(d);
    if (!meta) {
      if (trackSource === "lanyard") scheduleStickyClear();
      return null;
    }
    return applyTrack(meta, "lanyard");
  }

  function listeningApiUrl() {
    if (typeof location === "undefined") return "";
    if (location.protocol !== "http:" && location.protocol !== "https:") return "";
    var cfg = w.ZETH_CONFIG || {};
    var custom = String(cfg.listeningApiUrl || "").trim();
    if (custom) return custom;
    return "/api/listening";
  }

  var accountPollSeq = 0;
  var lastTopVideoId = "";

  function trackFromTop(top) {
    if (!top || !top.videoId) return null;
    var start = Date.now();
    var dur = Number(top.durationSec) || 0;
    return {
      source: "youtube music",
      title: top.title || "",
      artist: top.artist || "",
      album: "",
      art: "",
      videoId: top.videoId,
      start: start,
      end: dur > 0 ? start + dur * 1000 : 0,
      durationSec: dur,
      playedAgeSec: top.playedAgeSec,
      key: "ytm:" + top.videoId,
    };
  }

  function pollYoutubeMusicAccount() {
    var cfg = w.ZETH_CONFIG || {};
    if (cfg.youtubeMusicEnabled === false) return Promise.resolve();
    var url = listeningApiUrl();
    if (!url) return Promise.resolve();
    var seq = ++accountPollSeq;
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return fetch(url + sep + "_=" + Date.now(), {
      credentials: "omit",
      cache: "no-store",
    })
      .then(function (r) {
        if (!r.ok) throw new Error("listening " + r.status);
        return r.json();
      })
      .then(function (body) {
        if (seq !== accountPollSeq) return null;

        if (body && (body.error === "NO_AUTH" || body.error === "REAUTH")) {
          accountConfigured = false;
          if (body.error === "REAUTH" && trackSource === "account") {
            scheduleStickyClear();
          }
          return null;
        }

        accountConfigured = !!(body && body.configured);
        var top = body && body.top;
        var topId = (top && top.videoId) || "";

        if (body && body.listening && body.track) {
          var t = body.track;
          if (body.paused) t.paused = true;
          accountActive = true;
          lastTopVideoId = t.videoId || topId || lastTopVideoId;
          applyTrack(t, "account");
          return t;
        }

        if (body && body.paused && body.track) {
          var pt = body.track;
          pt.paused = true;
          accountActive = true;
          applyTrack(pt, "account");
          return pt;
        }

        if (topId && lastTopVideoId && topId !== lastTopVideoId) {
          var forced = trackFromTop(top);
          lastTopVideoId = topId;
          if (forced) {
            accountActive = true;
            applyTrack(forced, "account");
            return forced;
          }
        }
        if (topId) lastTopVideoId = topId;

        var wasAccount = accountActive || trackSource === "account" || !!lastAccountTrack;
        accountActive = false;
        if (wasAccount) scheduleStickyClear();
        return null;
      })
      .catch(function () {
        return null;
      });
  }

  function startAccountPolling() {
    var cfg = w.ZETH_CONFIG || {};
    if (cfg.youtubeMusicEnabled === false) return;
    if (accountPollTimer) {
      clearInterval(accountPollTimer);
      accountPollTimer = null;
    }
    var base =
      typeof cfg.youtubeMusicPollMs === "number" && cfg.youtubeMusicPollMs >= 300
        ? cfg.youtubeMusicPollMs
        : 1000;
    var ms = isMobile ? Math.max(base, 2000) : base;
    hideMirrorUi();
    pollYoutubeMusicAccount();
    w.setTimeout(pollYoutubeMusicAccount, isMobile ? 400 : 200);
    accountPollTimer = w.setInterval(pollYoutubeMusicAccount, ms);

    if (!startAccountPolling._visBound) {
      startAccountPolling._visBound = true;
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") pollYoutubeMusicAccount();
      });
      w.addEventListener("focus", function () {
        pollYoutubeMusicAccount();
      });
    }
  }

  w.ZETH_NOW_PLAYING = {
    applyFromLanyard: applyFromLanyard,
    applyTrack: applyTrack,
    extractListening: extractListening,
    startAccountPolling: startAccountPolling,
    pollYoutubeMusicAccount: pollYoutubeMusicAccount,
    onGateOpen: function () {},
    unlockListenSound: function () {
      return false;
    },
    isListening: function () {
      return !!trackMeta;
    },
    getTrack: function () {
      return trackMeta;
    },
    onListeningChange: function (fn) {
      if (typeof fn === "function") listeningListeners.push(fn);
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAccountPolling);
  } else {
    startAccountPolling();
  }
})(window);
