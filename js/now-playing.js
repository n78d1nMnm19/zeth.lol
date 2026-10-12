/**
 * Live listening (YouTube Music account API + Lanyard Spotify fallback) + synced lyrics.
 */
(function (w) {
  var C = w.ZETH_CONFIG || {};
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
  var listenYtPlayer = null;
  var listenYtReady = false;
  var listenYtVideoId = "";
  var listenYtWantPlay = false;
  var clientEndedVideoId = "";

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

  function parseLrc(raw) {
    var out = [];
    var text = String(raw || "");
    if (!text) return out;
    var re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g;
    var m;
    while ((m = re.exec(text))) {
      var min = parseInt(m[1], 10) || 0;
      var sec = parseInt(m[2], 10) || 0;
      var frac = m[3] || "0";
      if (frac.length === 1) frac += "00";
      else if (frac.length === 2) frac += "0";
      var ms = min * 60000 + sec * 1000 + (parseInt(frac, 10) || 0);
      var line = String(m[4] || "").trim();
      if (!line) continue;
      out.push({ t: ms, text: line });
    }
    out.sort(function (a, b) {
      return a.t - b.t;
    });
    return out;
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
      // HASH/https/host/path...  or media.discordapp.net/external/...
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
      // YouTube Music often: "Artist · Album" or just artist
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

    // Prefer YouTube Music / listening (type 2), then watching YouTube Music
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
    // Prefer live YouTube playback position when we're playing the song
    if (listenYtPlayer && listenYtReady) {
      try {
        var st = listenYtPlayer.getPlayerState();
        // 1 playing, 2 paused, 3 buffering
        if (st === 1 || st === 2 || st === 3) {
          var t = listenYtPlayer.getCurrentTime();
          if (isFinite(t) && t >= 0) return Math.floor(t * 1000);
        }
      } catch (eProg) {}
    }
    if (!meta || !meta.start) return 0;
    var now = Date.now();
    var elapsed = now - meta.start;
    if (meta.end && meta.end > meta.start) {
      elapsed = Math.min(Math.max(0, elapsed), meta.end - meta.start);
    }
    return Math.max(0, elapsed);
  }

  function ensureYoutubeApi(cb) {
    if (w.YT && w.YT.Player) {
      cb();
      return;
    }
    ensureYoutubeApi.q = ensureYoutubeApi.q || [];
    ensureYoutubeApi.q.push(cb);
    if (ensureYoutubeApi.loading) return;
    ensureYoutubeApi.loading = true;
    var tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    var first = document.getElementsByTagName("script")[0];
    first.parentNode.insertBefore(tag, first);
    var prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = function () {
      if (typeof prev === "function") prev();
      var q = ensureYoutubeApi.q || [];
      ensureYoutubeApi.q = [];
      for (var i = 0; i < q.length; i++) q[i]();
    };
  }

  function listenVolume() {
    var vol = Number((w.ZETH_CONFIG || {}).soundVolume);
    if (!isFinite(vol)) vol = 0.3;
    return Math.round(Math.max(0, Math.min(1, vol)) * 100);
  }

  function stopListenAudio() {
    listenYtWantPlay = false;
    listenYtVideoId = "";
    if (listenYtPlayer) {
      try {
        listenYtPlayer.stopVideo();
      } catch (eStop) {}
      try {
        listenYtPlayer.pauseVideo();
      } catch (ePause) {}
    }
  }

  function playListenAudio(meta) {
    var vid = meta && String(meta.videoId || "").trim();
    if (!vid) {
      stopListenAudio();
      return;
    }
    if (!w.ZETH_GATE_OPENED) {
      listenYtWantPlay = true;
      listenYtVideoId = vid;
      return;
    }
    listenYtWantPlay = true;

    function startPlayer() {
      if (!listenYtPlayer) {
        listenYtPlayer = new w.YT.Player("listen-yt-host", {
          width: 120,
          height: 68,
          videoId: vid,
          playerVars: {
            autoplay: 1,
            controls: 0,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            disablekb: 1,
          },
          events: {
            onReady: function (ev) {
              listenYtReady = true;
              listenYtVideoId = vid;
              try {
                ev.target.unMute();
                ev.target.setVolume(listenVolume());
                if (listenYtWantPlay) ev.target.playVideo();
              } catch (eReady) {}
            },
            onStateChange: function (ev) {
              // 0 = ended → stop listening UI + resume site MP3
              if (ev.data === 0) {
                clientEndedVideoId = listenYtVideoId || (trackMeta && trackMeta.videoId) || "";
                clearListeningUi();
              }
            },
            onError: function () {
              // Age-restricted / unavailable — keep lyrics, no audio
            },
          },
        });
        return;
      }
      if (listenYtVideoId === vid && listenYtReady) {
        try {
          listenYtPlayer.unMute();
          listenYtPlayer.setVolume(listenVolume());
          if (listenYtPlayer.getPlayerState() !== 1) listenYtPlayer.playVideo();
        } catch (ePlay) {}
        return;
      }
      listenYtVideoId = vid;
      try {
        listenYtPlayer.loadVideoById(vid);
        listenYtPlayer.unMute();
        listenYtPlayer.setVolume(listenVolume());
        listenYtPlayer.playVideo();
      } catch (eLoad) {}
    }

    ensureYoutubeApi(startPlayer);
  }

  function durationSec(meta) {
    if (!meta) return 0;
    if (meta.end && meta.start && meta.end > meta.start) {
      return Math.round((meta.end - meta.start) / 1000);
    }
    return 0;
  }

  function setListeningUi(meta) {
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
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "lyrics-empty";
      empty.textContent = "no synced lyrics found";
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

  function fetchLyrics(meta) {
    var seq = ++fetchSeq;
    var title = meta.title;
    var artist = meta.artist || "";
    var album = meta.album || "";
    var dur = durationSec(meta);

    function headers() {
      return {
        Accept: "application/json",
        "Lrclib-Client": "slits.lol listening widget",
      };
    }

    function fromGet() {
      var q =
        "https://lrclib.net/api/get?track_name=" +
        encodeURIComponent(title) +
        "&artist_name=" +
        encodeURIComponent(artist || "Unknown");
      if (album) q += "&album_name=" + encodeURIComponent(album);
      if (dur > 0) q += "&duration=" + encodeURIComponent(String(dur));
      return fetch(q, { credentials: "omit", headers: headers() }).then(function (r) {
        if (!r.ok) throw new Error("get " + r.status);
        return r.json();
      });
    }

    function fromSearch() {
      var q =
        "https://lrclib.net/api/search?track_name=" +
        encodeURIComponent(title) +
        "&artist_name=" +
        encodeURIComponent(artist || "");
      return fetch(q, { credentials: "omit", headers: headers() })
        .then(function (r) {
          if (!r.ok) throw new Error("search " + r.status);
          return r.json();
        })
        .then(function (list) {
          if (!Array.isArray(list) || !list.length) throw new Error("empty search");
          var best = null;
          for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].syncedLyrics) {
              best = list[i];
              break;
            }
          }
          if (!best) best = list[0];
          return best;
        });
    }

    return fromGet()
      .catch(function () {
        return fromSearch();
      })
      .then(function (body) {
        if (seq !== fetchSeq || !trackMeta || trackMeta.key !== meta.key) return;
        var synced = body && body.syncedLyrics;
        var plain = body && body.plainLyrics;
        lines = parseLrc(synced);
        if (!lines.length && plain) {
          lines = String(plain)
            .split(/\n/)
            .map(function (t, i) {
              return { t: i * 3000, text: String(t).trim() };
            })
            .filter(function (x) {
              return x.text;
            });
        }
        setListeningUi(trackMeta);
        renderLyricLines(lines);
        activeIdx = -1;
        startTicker();
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
    trackMeta = null;
    trackKey = "";
    lastFetchKey = "";
    trackSource = "";
    accountActive = false;
    lines = [];
    setListeningUi(null);
    stopTicker();
    stopListenAudio();
    var track = $("lyrics-track");
    if (track) track.textContent = "";
    emitListeningChange(null);
  }

  function applyTrack(meta, source) {
    if (!meta) {
      if (trackSource === source || !trackMeta) clearListeningUi();
      return null;
    }
    // Don't restart a track the user (or player) already finished
    if (meta.videoId && meta.videoId === clientEndedVideoId) {
      return null;
    }
    if (meta.videoId && meta.videoId !== clientEndedVideoId) {
      clientEndedVideoId = "";
    }

    setListeningUi(meta);
    trackMeta = meta;
    trackSource = source || trackSource || "lanyard";

    if (meta.key !== trackKey) {
      trackKey = meta.key;
      activeIdx = -1;
      if (meta.key !== lastFetchKey) {
        lastFetchKey = meta.key;
        var trackEl = $("lyrics-track");
        if (trackEl) {
          trackEl.textContent = "";
          var loading = document.createElement("p");
          loading.className = "lyrics-empty";
          loading.textContent = "loading lyrics…";
          trackEl.appendChild(loading);
        }
        fetchLyrics(meta);
      }
      playListenAudio(meta);
      emitListeningChange(meta);
    } else {
      // same song — keep audio going, sync lyrics clock
      playListenAudio(meta);
      startTicker();
      emitListeningChange(meta);
    }
    return meta;
  }

  function applyFromLanyard(d) {
    // Account YouTube Music wins over Discord presence for music
    if (accountConfigured && accountActive) return trackMeta;
    var meta = extractListening(d);
    if (!meta) {
      if (trackSource === "lanyard" || !trackSource) clearListeningUi();
      return null;
    }
    // Ignore YouTube-looking Discord activities when account API is connected
    if (accountConfigured && meta.source && String(meta.source).indexOf("youtube") !== -1) {
      return trackMeta;
    }
    return applyTrack(meta, "lanyard");
  }

  function listeningApiUrl() {
    if (typeof location === "undefined") return "";
    if (location.protocol !== "http:" && location.protocol !== "https:") return "";
    var base = String((w.ZETH_CONFIG || {}).apiBaseUrl || "").trim().replace(/\/+$/, "");
    // Prefer same-origin so local cookie auth on npm run server works
    if (!base || base.indexOf(location.host) !== -1) return "/api/listening";
    // If apiBaseUrl points elsewhere, still try same-origin first for YT Music
    return "/api/listening";
  }

  function pollYoutubeMusicAccount() {
    var cfg = w.ZETH_CONFIG || {};
    if (cfg.youtubeMusicEnabled === false) return Promise.resolve();
    var url = listeningApiUrl();
    if (!url) return Promise.resolve();
    return fetch(url, { credentials: "omit", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("listening " + r.status);
        return r.json();
      })
      .then(function (body) {
        accountConfigured = !!(body && body.configured);
        if (body && body.listening && body.track) {
          accountActive = true;
          // keep server start/end for lyric progress
          applyTrack(body.track, "account");
          return body.track;
        }
        var wasAccount = accountActive || trackSource === "account";
        accountActive = false;
        if (wasAccount) clearListeningUi();
        return null;
      })
      .catch(function () {
        // API missing (e.g. static serve) — leave Lanyard fallback alone
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
    pollYoutubeMusicAccount();
    var ms =
      typeof cfg.youtubeMusicPollMs === "number" && cfg.youtubeMusicPollMs >= 1000
        ? cfg.youtubeMusicPollMs
        : 1500;
    accountPollTimer = w.setInterval(pollYoutubeMusicAccount, ms);
  }

  w.ZETH_NOW_PLAYING = {
    applyFromLanyard: applyFromLanyard,
    applyTrack: applyTrack,
    extractListening: extractListening,
    startAccountPolling: startAccountPolling,
    pollYoutubeMusicAccount: pollYoutubeMusicAccount,
    onGateOpen: function () {
      if (trackMeta && trackMeta.videoId) playListenAudio(trackMeta);
      else if (listenYtWantPlay && listenYtVideoId) {
        playListenAudio({ videoId: listenYtVideoId });
      }
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

  // Auto-start account poll when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAccountPolling);
  } else {
    startAccountPolling();
  }
})(window);
