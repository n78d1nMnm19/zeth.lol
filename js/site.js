      (function () {
        var C = window.ZETH_CONFIG || {};
        var VIEWS_KEY = "zeth-total-views";

        function fmt(t) {
          if (!isFinite(t) || t < 0) return "0:00";
          var m = Math.floor(t / 60);
          var s = Math.floor(t % 60);
          return m + ":" + (s < 10 ? "0" : "") + s;
        }

        var mobileAvSync =
          !!window.matchMedia &&
          (window.matchMedia("(max-width: 768px)").matches || window.matchMedia("(pointer: coarse)").matches);

        var sameBgAsAudio = false;
        var lastMobileVidSync = 0;
        var audioFadeTimer = null;

        function applySoundVolume(el, target, fadeMs) {
          if (!el) return;
          var goal = Number(target);
          if (!isFinite(goal)) goal = 0.16;
          goal = Math.max(0, Math.min(1, goal));
          if (audioFadeTimer) {
            clearInterval(audioFadeTimer);
            audioFadeTimer = null;
          }
          var ms = typeof fadeMs === "number" ? fadeMs : 0;
          if (!ms || ms < 50) {
            el.volume = goal;
            return;
          }
          // Soft start — avoids the mobile “spike” when playback begins/resumes
          try {
            el.volume = Math.min(goal, 0.02);
          } catch (eVol0) {}
          var steps = Math.max(6, Math.floor(ms / 40));
          var i = 0;
          audioFadeTimer = window.setInterval(function () {
            i++;
            var t = Math.min(1, i / steps);
            try {
              el.volume = goal * t;
            } catch (eVol) {}
            if (t >= 1) {
              clearInterval(audioFadeTimer);
              audioFadeTimer = null;
            }
          }, 40);
        }

        function setPlayButtonPlaying(playing) {
          var el = document.getElementById("btn-play");
          if (!el) return;
          var p = el.querySelector(".pb-play-label");
          var q = el.querySelector(".pb-pause-label");
          if (p && q) {
            p.classList.toggle("hidden", playing);
            q.classList.toggle("hidden", !playing);
          }
          el.setAttribute("aria-label", playing ? "Pause" : "Play");
        }

        function discordBadgeIconUrl(hash) {
          var h = (hash || "").trim();
          if (!h) return "";
          return "https://cdn.discordapp.com/badge-icons/" + encodeURIComponent(h) + ".png";
        }

        function apiUrl(path) {
          var base = String(C.apiBaseUrl || "").trim().replace(/\/+$/, "");
          var p = path.charAt(0) === "/" ? path : "/" + path;
          if (base) return base + p;
          // Same origin when the bot serves the site (npm start / deployed host)
          if (
            typeof location !== "undefined" &&
            (location.protocol === "http:" || location.protocol === "https:")
          ) {
            return p;
          }
          return "";
        }

        function viewsFloor() {
          var n = Number(C.viewsStartAt);
          return isFinite(n) && n > 0 ? Math.floor(n) : 0;
        }

        function formatViews(n) {
          var v = Math.floor(Number(n));
          if (!isFinite(v) || v < 0) v = 0;
          var floor = viewsFloor();
          if (v < floor) v = floor;
          try {
            return v.toLocaleString("en-US");
          } catch (e) {
            return String(v);
          }
        }

        function setViewCountDisplay(n) {
          var el = document.getElementById("view-count");
          if (!el) return;
          el.textContent = formatViews(n);
        }

        function fetchLiveViews() {
          var url = apiUrl("/api/views");
          if (!url) {
            setViewCountDisplay(localStorage.getItem(VIEWS_KEY) || "0");
            return Promise.resolve();
          }
          return fetch(url, { credentials: "omit", cache: "no-store" })
            .then(function (r) {
              if (!r.ok) throw new Error("views " + r.status);
              return r.json();
            })
            .then(function (body) {
              var n = body && body.count;
              if (isFinite(Number(n))) {
                localStorage.setItem(VIEWS_KEY, String(Math.floor(Number(n))));
                setViewCountDisplay(n);
              }
            })
            .catch(function () {
              setViewCountDisplay(localStorage.getItem(VIEWS_KEY) || "0");
            });
        }

        function bumpLiveViews() {
          var floor = viewsFloor();
          var url = apiUrl("/api/views");
          if (!url) {
            var cur = parseInt(localStorage.getItem(VIEWS_KEY) || "0", 10);
            if (!isFinite(cur) || cur < floor) cur = floor;
            var n = cur + 1;
            localStorage.setItem(VIEWS_KEY, String(n));
            setViewCountDisplay(n);
            return Promise.resolve(n);
          }
          return fetch(url, {
            method: "POST",
            credentials: "omit",
            cache: "no-store",
            headers: { Accept: "application/json" },
          })
            .then(function (r) {
              if (!r.ok) throw new Error("views post " + r.status);
              return r.json();
            })
            .then(function (body) {
              var n = body && body.count;
              if (isFinite(Number(n))) {
                var v = Math.floor(Number(n));
                if (v < floor) v = floor;
                localStorage.setItem(VIEWS_KEY, String(v));
                setViewCountDisplay(v);
                return v;
              }
              throw new Error("bad views body");
            })
            .catch(function () {
              var cur = parseInt(localStorage.getItem(VIEWS_KEY) || "0", 10);
              if (!isFinite(cur) || cur < floor) cur = floor;
              var n = cur + 1;
              localStorage.setItem(VIEWS_KEY, String(n));
              setViewCountDisplay(n);
              return n;
            });
        }

        function appendBadgeEl(wrap, src, desc) {
          if (!wrap || !src) return;
          var img = document.createElement("img");
          img.alt = desc || "badge";
          img.title = desc || "badge";
          img.src = src;
          img.width = 28;
          img.height = 28;
          img.loading = "lazy";
          img.decoding = "async";
          var holder = document.createElement("span");
          holder.className = "badge-ico";
          holder.appendChild(img);
          wrap.appendChild(holder);
        }

        function isNitroBadge(b) {
          if (!b) return false;
          // Only hide Discord profile Nitro/premium — keep custom nitro_badge icons
          var id = String(b.id || "").toLowerCase();
          var desc = String(b.description || "").toLowerCase();
          if (id === "premium") return true;
          if (desc.indexOf("subscriber since") !== -1) return true;
          return false;
        }

        function renderBadgeList(discordList, customList) {
          var wrap = document.getElementById("badges");
          if (!wrap) return;
          wrap.textContent = "";
          var track = document.createElement("div");
          track.className = "badge-track";
          wrap.appendChild(track);

          var set = document.createElement("div");
          set.className = "badge-set";
          track.appendChild(set);

          var shown = 0;
          var i;
          var b;

          discordList = (discordList || []).filter(function (x) {
            return !isNitroBadge(x);
          });
          customList = (customList || []).filter(function (x) {
            return !isNitroBadge(x);
          });

          for (i = 0; i < discordList.length; i++) {
            b = discordList[i] || {};
            var desc = String(b.description || b.id || "badge");
            var hs = (b.icon || "").trim();
            if (!hs) continue;
            appendBadgeEl(set, discordBadgeIconUrl(hs), desc);
            shown++;
          }

          for (i = 0; i < customList.length; i++) {
            b = customList[i] || {};
            var src = String(b.url || "").trim();
            if (!src && b.id) {
              src =
                "https://cdn.discordapp.com/emojis/" +
                encodeURIComponent(String(b.id)) +
                (b.animated ? ".gif" : ".png") +
                "?size=64&quality=lossless";
            }
            if (!src) continue;
            appendBadgeEl(set, src, ":" + (b.name || "emoji") + ":");
            shown++;
          }

          // Identical second set — padding-right on each set keeps -50% seamless
          if (shown > 0) {
            var clone = set.cloneNode(true);
            clone.setAttribute("aria-hidden", "true");
            track.appendChild(clone);
          }

          wrap.classList.toggle("hidden", shown === 0);
        }

        var cachedDiscordBadges = [];
        var cachedCustomBadges = [];
        var customBadgesTimer = null;

        function loadCustomBadges() {
          function applyList(list) {
            cachedCustomBadges = Array.isArray(list) ? list : [];
            renderBadgeList(cachedDiscordBadges, cachedCustomBadges);
          }

          function fromStaticFile() {
            return fetch("/badges.json", { credentials: "omit", cache: "no-store" })
              .then(function (r) {
                if (!r.ok) throw new Error("static badges " + r.status);
                return r.json();
              })
              .then(function (data) {
                applyList(Array.isArray(data) ? data : (data && data.badges) || []);
              });
          }

          var url = apiUrl("/api/badges");
          if (!url) {
            return fromStaticFile().catch(function () {
              applyList(cachedCustomBadges);
            });
          }

          return fetch(url, { credentials: "omit", cache: "no-store" })
            .then(function (r) {
              if (!r.ok) throw new Error("custom badges " + r.status);
              return r.json();
            })
            .then(function (body) {
              var list = (body && body.badges) || [];
              if (list.length) {
                applyList(list);
                return;
              }
              // API empty → static backup (works with bot offline)
              return fromStaticFile();
            })
            .catch(function () {
              return fromStaticFile().catch(function () {
                applyList(cachedCustomBadges);
              });
            });
        }

        function startCustomBadgesPolling() {
          if (customBadgesTimer) {
            clearInterval(customBadgesTimer);
            customBadgesTimer = null;
          }
          loadCustomBadges();
          var ms =
            typeof C.customBadgesPollMs === "number" && C.customBadgesPollMs >= 5000
              ? C.customBadgesPollMs
              : 30000;
          customBadgesTimer = window.setInterval(loadCustomBadges, ms);
        }

        function loadDiscordBadges() {
          var wrap = document.getElementById("badges");
          if (!wrap) return;
          var url = (C.discordBadgesProfileUrl || "").trim();
          if (!url) {
            cachedDiscordBadges = [];
            renderBadgeList(cachedDiscordBadges, cachedCustomBadges);
            return;
          }
          fetch(url, { credentials: "omit" })
            .then(function (r) {
              if (!r.ok) throw new Error("badges " + r.status);
              return r.json();
            })
            .then(function (data) {
              cachedDiscordBadges = (data && data.badges) || [];
              renderBadgeList(cachedDiscordBadges, cachedCustomBadges);
            })
            .catch(function () {
              cachedDiscordBadges = [];
              renderBadgeList(cachedDiscordBadges, cachedCustomBadges);
            });
        }

        var lanyardTimer = null;
        var avatarPollTimer = null;
        var lanyardSocket = null;
        var lanyardHeartbeat = null;
        var lastHeroAvatarHash = "";
        var heroAvatarLive = false;
        var staleAvatarHashes = Object.create(null);

        function discordUserAvatarUrl(userId, avatarHash, size) {
          var uid = String(userId || "").trim();
          var h = String(avatarHash || "").trim();
          var sz = size || 128;
          if (!uid) return "";
          if (!h) return discordDefaultAvatarUrl(uid);
          var ext = h.indexOf("a_") === 0 ? "gif" : "webp";
          return (
            "https://cdn.discordapp.com/avatars/" +
            encodeURIComponent(uid) +
            "/" +
            encodeURIComponent(h) +
            "." +
            ext +
            "?size=" +
            encodeURIComponent(String(sz))
          );
        }

        function discordDefaultAvatarUrl(userId) {
          var idStr = String(userId || "").trim();
          if (!idStr) return "";
          var idx = 0;
          try {
            idx = Number((BigInt(idStr) >> 22n) % 6n);
          } catch (eAv) {
            idx = 0;
          }
          return "https://cdn.discordapp.com/embed/avatars/" + idx + ".png";
        }

        function lanyardCustomEmojiPrefix(emoji) {
          if (!emoji || typeof emoji !== "object") return "";
          if (emoji.name && !emoji.id) return String(emoji.name) + " ";
          return "";
        }

        function formatLanyardStatus(d) {
          if (!d) return "";
          var activities = d.activities || [];
          var i;
          var a;
          for (i = 0; i < activities.length; i++) {
            a = activities[i];
            if (!a || a.type !== 4) continue;
            var line = (lanyardCustomEmojiPrefix(a.emoji) + (a.state || "")).trim();
            if (line) return line;
          }
          if (d.listening_to_spotify && d.spotify) {
            var sp = d.spotify;
            var song = String((sp && sp.song) || "").trim();
            var artistFull = String((sp && sp.artist) || "").trim();
            var artist = artistFull.split(";")[0].trim();
            if (song) return artist ? song + " · " + artist : song;
          }
          for (i = 0; i < activities.length; i++) {
            a = activities[i];
            if (!a) continue;
            if (a.type === 4) continue;
            if (a.type === 0) {
              if (a.details) return String(a.details);
              if (a.name) return "Playing " + a.name;
            }
            if (a.type === 2 && a.details) return "Listening to " + a.details;
            if (a.type === 3 && a.name) return "Watching " + a.name;
            if (a.type === 1 && a.name) return "Streaming " + a.name;
          }
          var st = String(d.discord_status || "offline").toLowerCase();
          if (st === "dnd") return "Do Not Disturb";
          if (st === "idle") return "Away";
          if (st === "online") return "Online";
          return "Offline";
        }

        function setBuildDiscordAvatar(src) {
          var el = document.getElementById("build-discord-av");
          if (!el || !src) return;
          if (el.getAttribute("data-src") === src) return;
          el.setAttribute("data-src", src);
          el.src = src;
        }

        function setHeroAvatar(url, avatarHash) {
          var hi = document.getElementById("hero-img");
          if (!hi) return;
          var src = String(url || "").trim();
          if (!src) {
            hi.removeAttribute("src");
            hi.classList.add("hidden");
            return;
          }
          var hash = String(avatarHash || "").trim();
          if (
            hash &&
            hash === lastHeroAvatarHash &&
            hi.getAttribute("data-src") === src
          ) {
            hi.classList.remove("hidden");
            setBuildDiscordAvatar(src);
            return;
          }
          if (!hash && hi.getAttribute("data-src") === src) {
            hi.classList.remove("hidden");
            setBuildDiscordAvatar(src);
            return;
          }
          // Preload so we don't flash empty / old while swapping
          var preload = new Image();
          preload.onload = function () {
            if (hash && staleAvatarHashes[hash]) return;
            if (hash && lastHeroAvatarHash && hash !== lastHeroAvatarHash) {
              // Another newer hash won while we were loading
              if (lastHeroAvatarHash && !staleAvatarHashes[hash]) {
                /* still apply if this is the intended hash */
              }
            }
            if (hash) lastHeroAvatarHash = hash;
            hi.setAttribute("data-src", src);
            hi.src = src;
            hi.classList.remove("hidden");
            setBuildDiscordAvatar(src);
            heroAvatarLive = true;
          };
          preload.onerror = function () {};
          if (hash) lastHeroAvatarHash = hash;
          hi.setAttribute("data-src", src);
          preload.src = src;
          // Also set immediately so first paint isn't blank
          hi.src = src;
          hi.classList.remove("hidden");
          setBuildDiscordAvatar(src);
          heroAvatarLive = true;
        }

        function setStatusDot(status) {
          var el = document.getElementById("status-dot");
          if (!el) return;
          var st = String(status || "offline").toLowerCase();
          if (st !== "online" && st !== "idle" && st !== "dnd" && st !== "offline") {
            st = "offline";
          }
          el.className = "status-dot status-dot--" + st;
        }

        function setDiscordHandle(username) {
          var handle = String(username || "").trim().replace(/^@/, "");
          var el = document.getElementById("discord-handle");
          if (el && handle) el.textContent = "@" + handle;
          var buildName = document.getElementById("build-discord-name");
          if (buildName && handle) buildName.textContent = handle;
        }

        function applyRightNow(d, listeningActive) {
          var titleEl = document.getElementById("now-title");
          var subEl = document.getElementById("now-sub");
          if (!titleEl && !subEl) return;
          // Now-playing + lyrics UI owns the "right now" slot while listening
          if (listeningActive) return;
          var fallbackTitle = String(C.rightNowTitle || "doing nothing.").trim();
          var fallbackSub = String(C.rightNowSub || "probably somewhere on discord").trim();
          if (!d) {
            if (titleEl) titleEl.textContent = fallbackTitle;
            if (subEl) subEl.textContent = fallbackSub;
            return;
          }
          var activities = d.activities || [];
          var i;
          var a;
          for (i = 0; i < activities.length; i++) {
            a = activities[i];
            if (!a || a.type !== 4) continue;
            var custom = (lanyardCustomEmojiPrefix(a.emoji) + (a.state || "")).trim();
            if (custom) {
              if (titleEl) titleEl.textContent = custom;
              if (subEl) subEl.textContent = "custom status";
              return;
            }
          }
          for (i = 0; i < activities.length; i++) {
            a = activities[i];
            if (!a || a.type === 4) continue;
            if (a.type === 0) {
              if (titleEl) titleEl.textContent = a.name ? "playing " + a.name : "in a game";
              if (subEl) subEl.textContent = String(a.details || a.state || "right now").trim();
              return;
            }
            if (a.type === 3) {
              if (titleEl) titleEl.textContent = a.name ? "watching " + a.name : "watching";
              if (subEl) subEl.textContent = String(a.details || a.state || "").trim() || fallbackSub;
              return;
            }
          }
          var st = String(d.discord_status || "offline").toLowerCase();
          if (titleEl) titleEl.textContent = fallbackTitle;
          if (subEl) {
            if (st === "dnd") subEl.textContent = "do not disturb";
            else if (st === "idle") subEl.textContent = "away";
            else if (st === "online") subEl.textContent = fallbackSub;
            else subEl.textContent = fallbackSub;
          }
        }

        /**
         * source: "ws" | "lanyard" | "japi" | "dstn"
         * After the first live PFP, only Lanyard/WS may change the hash —
         * cached japi/dstn responses were flipping back to the old avatar.
         */
        function applyDiscordUserAvatar(u, source) {
          if (!u || !u.id) return false;
          var want = String(C.profileDiscordUserId || "").trim();
          var uid = String(u.id);
          if (want && want !== uid) return false;
          var hash = String(u.avatar || "").trim();
          var key = hash || ("default:" + uid);

          if (staleAvatarHashes[key]) return false;

          var trusted = source === "ws" || source === "lanyard";
          if (heroAvatarLive && !trusted && key !== lastHeroAvatarHash) {
            // Stale CDN/API still serving the previous avatar — ignore
            staleAvatarHashes[key] = true;
            return false;
          }

          if (key === lastHeroAvatarHash && heroAvatarLive) return true;

          if (
            lastHeroAvatarHash &&
            key !== lastHeroAvatarHash &&
            trusted
          ) {
            staleAvatarHashes[lastHeroAvatarHash] = true;
          }

          var url = u.avatar
            ? discordUserAvatarUrl(uid, u.avatar, 256)
            : discordDefaultAvatarUrl(uid);
          if (!url) return false;
          setHeroAvatar(url, key);
          return true;
        }

        function fetchJsonNoStore(url) {
          return fetch(url, { credentials: "omit", cache: "no-store" }).then(function (r) {
            if (!r.ok) throw new Error("http " + r.status);
            return r.json();
          });
        }

        function applyDiscordProfileUser(u, source) {
          if (!u || !u.id) return false;
          var uname = String(u.username || "").trim();
          if (uname) setDiscordHandle(uname);
          if (C.syncProfileAvatar === false) return !!uname;
          return applyDiscordUserAvatar(u, source || "japi") || !!uname;
        }

        function loadDiscordProfileAvatar() {
          if (C.syncProfileAvatar === false && !document.getElementById("discord-handle")) {
            return Promise.resolve();
          }
          var uid = String(C.profileDiscordUserId || "").trim();
          if (!uid) return Promise.resolve();

          // Prefer Lanyard for full presence (status + PFP + handle). Fall back for avatar only.
          return fetchJsonNoStore(
            "https://api.lanyard.rest/v1/users/" + encodeURIComponent(uid)
          )
            .then(function (body) {
              if (body && body.success && body.data && body.data.discord_user) {
                applyLanyardPresence(body, "lanyard");
                return body.data.discord_user;
              }
              throw new Error("lanyard empty");
            })
            .catch(function () {
              // After first live PFP, don't let stale japi/dstn flip the avatar back
              if (heroAvatarLive) return null;
              return Promise.any([
                fetchJsonNoStore(
                  "https://japi.rest/discord/v1/user/" + encodeURIComponent(uid)
                ).then(function (body) {
                  var u = (body && body.data) || body;
                  if (!applyDiscordProfileUser(u, "japi")) throw new Error("no avatar");
                  return u;
                }),
                fetchJsonNoStore(
                  "https://dcdn.dstn.to/profile/" + encodeURIComponent(uid)
                ).then(function (data) {
                  var u = data && data.user;
                  if (!applyDiscordProfileUser(u, "dstn")) throw new Error("no avatar");
                  return u;
                }),
              ]);
            })
            .catch(function () {});
        }

        function startAvatarPolling() {
          if (C.syncProfileAvatar === false) return;
          if (avatarPollTimer) {
            clearInterval(avatarPollTimer);
            avatarPollTimer = null;
          }
          loadDiscordProfileAvatar();
          var ms =
            typeof C.profileAvatarPollMs === "number" && C.profileAvatarPollMs >= 3000
              ? C.profileAvatarPollMs
              : 5000;
          avatarPollTimer = window.setInterval(loadDiscordProfileAvatar, ms);
        }

        function stopLanyardSocket() {
          if (lanyardHeartbeat) {
            clearInterval(lanyardHeartbeat);
            lanyardHeartbeat = null;
          }
          if (lanyardSocket) {
            try {
              lanyardSocket.close();
            } catch (eWs) {}
            lanyardSocket = null;
          }
        }

        function startLanyardSocket() {
          var uid = String(C.profileDiscordUserId || "").trim();
          if (!uid || typeof WebSocket === "undefined") return;
          stopLanyardSocket();

          var ws;
          try {
            ws = new WebSocket("wss://api.lanyard.rest/socket");
          } catch (eOpen) {
            return;
          }
          lanyardSocket = ws;

          ws.onmessage = function (ev) {
            var msg;
            try {
              msg = JSON.parse(ev.data);
            } catch (eParse) {
              return;
            }
            if (!msg) return;

            if (msg.op === 1) {
              var interval = (msg.d && msg.d.heartbeat_interval) || 30000;
              if (lanyardHeartbeat) clearInterval(lanyardHeartbeat);
              lanyardHeartbeat = window.setInterval(function () {
                if (ws.readyState === 1) ws.send(JSON.stringify({ op: 3 }));
              }, interval);
              ws.send(
                JSON.stringify({
                  op: 2,
                  d: { subscribe_to_id: uid },
                })
              );
              return;
            }

            if (msg.op === 0) {
              var data = msg.d;
              if (msg.t === "INIT_STATE" && data && !data.discord_user && data[uid]) {
                data = data[uid];
              }
              if (data && data.discord_user) {
                applyLanyardPresence({ success: true, data: data }, "ws");
              }
            }
          };

          ws.onclose = function () {
            if (lanyardHeartbeat) {
              clearInterval(lanyardHeartbeat);
              lanyardHeartbeat = null;
            }
            lanyardSocket = null;
            // Reconnect quickly so avatar stays live
            window.setTimeout(startLanyardSocket, 2500);
          };
        }

        function applyLanyardPresence(body, source) {
          var d = body && body.data;
          var u = d && d.discord_user;
          if (!u || !u.id) return;
          var uid = String(u.id);

          // Live site PFP — WS/Lanyard only (prevents old-avatar flicker)
          if (C.syncProfileAvatar !== false) {
            applyDiscordUserAvatar(u, source || "lanyard");
          }

          var uname = String(u.username || "").trim();
          if (uname) setDiscordHandle(uname);

          var st = String(d.discord_status || "offline").toLowerCase();
          setStatusDot(st);
          var statusEl = document.getElementById("discord-status");
          if (statusEl) {
            statusEl.setAttribute("data-live", "1");
            statusEl.textContent = st || "offline";
          }

          var listening = null;
          if (window.ZETH_NOW_PLAYING && typeof window.ZETH_NOW_PLAYING.applyFromLanyard === "function") {
            listening = window.ZETH_NOW_PLAYING.applyFromLanyard(d);
          }
          applyRightNow(d, !!listening);

          var nameEl = document.getElementById("pres-name");
          var statEl = document.getElementById("pres-status");
          var pi = document.getElementById("pres-img");
          var pw = document.getElementById("pres-wrap");
          var dnd = document.getElementById("pres-dnd");
          if (nameEl) {
            nameEl.textContent = u.global_name || u.display_name || u.username || "";
          }
          if (statEl) statEl.textContent = formatLanyardStatus(d);
          var avUrl = u.avatar ? discordUserAvatarUrl(uid, u.avatar, 128) : discordDefaultAvatarUrl(uid);
          if (pi && avUrl) {
            pi.src = avUrl;
            if (pw) pw.classList.remove("hidden");
          }
          if (dnd) {
            var isDnd = st === "dnd";
            dnd.classList.toggle("hidden", !isDnd || !avUrl);
          }
        }

        function fetchLanyardOnce() {
          var url = (C.lanyardUserUrl || "").trim();
          if (!url) return Promise.resolve();
          return fetch(url, { credentials: "omit", cache: "no-store" })
            .then(function (r) {
              if (!r.ok) throw new Error("lanyard " + r.status);
              return r.json();
            })
            .then(function (body) {
              if (!body || !body.success || !body.data) return;
              applyLanyardPresence(body, "lanyard");
            })
            .catch(function () {});
        }

        function startLanyardPolling() {
          var url = (C.lanyardUserUrl || "").trim();
          if (!url) return;
          if (lanyardTimer) {
            clearInterval(lanyardTimer);
            lanyardTimer = null;
          }
          fetchLanyardOnce();
          var ms =
            typeof C.lanyardPollMs === "number" && C.lanyardPollMs >= 15000
              ? C.lanyardPollMs
              : 45000;
          lanyardTimer = window.setInterval(fetchLanyardOnce, ms);
        }

        function applyFriendAvatar(card, userId, avatarHash, directUrl) {
          if (!card) return;
          var wrap = card.querySelector(".pres-av-wrap");
          var img = card.querySelector("img");
          if (!img || !wrap) return;
          var uid = String(userId || "").trim();
          var url = String(directUrl || "").trim();
          if (!url) {
            url = avatarHash
              ? discordUserAvatarUrl(uid, avatarHash, 128)
              : uid
                ? discordDefaultAvatarUrl(uid)
                : "";
          }
          if (!url) return;
          img.src = url;
          wrap.classList.remove("hidden");
        }

        function loadFriendProfile(card, userId) {
          var uid = String(userId || "").trim();
          if (!uid || !/^\d{15,22}$/.test(uid)) return;

          function applyUser(u) {
            if (!u || !u.id) return;
            var direct = String(u.avatarURL || u.avatarUrl || "").trim();
            if (direct && direct.indexOf("cdn.discordapp.com") !== -1) {
              // Prefer webp sized avatar when we have a hash
              if (u.avatar) direct = discordUserAvatarUrl(u.id, u.avatar, 128);
            } else {
              direct = "";
            }
            applyFriendAvatar(card, u.id, u.avatar, direct);
            var nameEl = card.querySelector("strong");
            var uname = String(u.username || "").trim();
            if (nameEl && uname) nameEl.textContent = "@" + uname;
          }

          // japi resolves public Discord profiles; dstn often returns empty for non-Lanyard users
          fetch("https://japi.rest/discord/v1/user/" + encodeURIComponent(uid), {
            credentials: "omit",
          })
            .then(function (r) {
              if (!r.ok) throw new Error("japi " + r.status);
              return r.json();
            })
            .then(function (body) {
              var u = (body && body.data) || body;
              if (u && u.id) {
                applyUser(u);
                return;
              }
              throw new Error("japi empty");
            })
            .catch(function () {
              return fetch("https://dcdn.dstn.to/profile/" + encodeURIComponent(uid), {
                credentials: "omit",
              })
                .then(function (r) {
                  if (!r.ok) throw new Error("dstn " + r.status);
                  return r.json();
                })
                .then(function (data) {
                  applyUser(data && data.user);
                })
                .catch(function () {});
            });
        }

        function renderFriendWidgets() {
          var grid = document.getElementById("subcards");
          if (!grid) return;
          var old = grid.querySelectorAll(".sub--friend");
          for (var o = 0; o < old.length; o++) old[o].remove();

          var list = Array.isArray(C.friendWidgets) ? C.friendWidgets : [];
          for (var i = 0; i < list.length; i++) {
            var f = list[i] || {};
            var uname = String(f.username || "").trim().replace(/^@/, "");
            if (!uname) continue;
            var uid = String(f.id || "").trim();
            var fallbackAv = String(f.avatarUrl || "").trim();

            var card = document.createElement("div");
            card.className = "sub sub--friend";
            card.setAttribute("data-username", uname);

            var wrap = document.createElement("div");
            wrap.className = "pres-av-wrap";

            var img = document.createElement("img");
            img.alt = "@" + uname;
            img.width = 40;
            img.height = 40;
            img.loading = "lazy";
            img.decoding = "async";
            if (fallbackAv) {
              img.src = fallbackAv;
            } else if (uid) {
              img.src = discordDefaultAvatarUrl(uid);
            } else {
              img.src =
                "https://api.dicebear.com/7.x/initials/svg?seed=" +
                encodeURIComponent(uname) +
                "&backgroundColor=1f2937&textColor=ffffff";
            }
            wrap.appendChild(img);

            var body = document.createElement("div");
            var strong = document.createElement("strong");
            strong.textContent = "@" + uname;
            var p = document.createElement("p");
            p.textContent = "Discord";
            body.appendChild(strong);
            body.appendChild(p);

            card.appendChild(wrap);
            card.appendChild(body);
            grid.appendChild(card);

            if (uid) loadFriendProfile(card, uid);
          }
        }

        function renderSocials() {
          var wrap = document.getElementById("socials");
          if (!wrap) return;
          wrap.textContent = "";
          var tiktok = String(C.tiktokUrl || "").trim();
          if (!tiktok) {
            wrap.classList.add("hidden");
            return;
          }
          wrap.classList.remove("hidden");
          var a = document.createElement("a");
          a.href = tiktok;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.className = "social-ico social-ico--tiktok";
          a.setAttribute("aria-label", "TikTok");
          a.title = "TikTok";
          var img = document.createElement("img");
          img.src = "./assets/tiktok-icon.svg";
          img.alt = "";
          img.width = 18;
          img.height = 18;
          img.className = "social-ico-img";
          a.appendChild(img);
          wrap.appendChild(a);
        }

        var useYoutube = false;
        var ytPlayer = null;
        var ytReady = false;
        var ytInitVideoId = "";
        var ytQueuedGatePlay = false;
        var ytQueuedGateFromStart = false;

        function destroyYoutubePlayer() {
          ytReady = false;
          ytInitVideoId = "";
          if (ytPlayer) {
            try {
              ytPlayer.destroy();
            } catch (e0) {}
            ytPlayer = null;
          }
          var host = document.getElementById("yt-player-embed");
          if (host) host.innerHTML = "";
        }

        function ensureYoutubeApi(callback) {
          if (window.YT && window.YT.Player) {
            callback();
            return;
          }
          ensureYoutubeApi.queue = ensureYoutubeApi.queue || [];
          ensureYoutubeApi.queue.push(callback);
          if (ensureYoutubeApi.loading) return;
          ensureYoutubeApi.loading = true;
          var tag = document.createElement("script");
          tag.src = "https://www.youtube.com/iframe_api";
          var s = document.getElementsByTagName("script")[0];
          s.parentNode.insertBefore(tag, s);
          var prev = window.onYouTubeIframeAPIReady;
          window.onYouTubeIframeAPIReady = function () {
            if (typeof prev === "function") prev();
            var q = ensureYoutubeApi.queue || [];
            ensureYoutubeApi.queue = [];
            q.forEach(function (fn) {
              fn();
            });
          };
        }

        function initYoutubeTrack(videoId) {
          if (!videoId) return;
          if (ytInitVideoId === videoId && ytPlayer) return;
          destroyYoutubePlayer();
          ytInitVideoId = videoId;
          ensureYoutubeApi(function () {
            if (ytInitVideoId !== videoId) return;
            ytPlayer = new YT.Player("yt-player-embed", {
              videoId: videoId,
              width: 160,
              height: 90,
              playerVars: {
                autoplay: 0,
                controls: 0,
                rel: 0,
                playsinline: 1,
                modestbranding: 1,
              },
              events: {
                onReady: function () {
                  ytReady = true;
                  var yv = Number(C.soundVolume);
                  ytPlayer.setVolume(
                    isFinite(yv) ? Math.round(Math.max(0, Math.min(1, yv)) * 100) : 28
                  );
                  if (ytQueuedGatePlay) {
                    var fs = ytQueuedGateFromStart;
                    ytQueuedGatePlay = false;
                    if (fs) ytPlayer.seekTo(0, true);
                    ytPlayer.unMute();
                    ytPlayer.playVideo();
                  }
                },
                onStateChange: function () {},
              },
            });
          });
        }

        function tryYoutubeGatePlay(fromStart) {
          ytQueuedGatePlay = true;
          ytQueuedGateFromStart = fromStart;
          if (ytPlayer && ytReady) {
            ytQueuedGatePlay = false;
            if (fromStart) ytPlayer.seekTo(0, true);
            ytPlayer.unMute();
            var yv2 = Number(C.soundVolume);
            ytPlayer.setVolume(
              isFinite(yv2) ? Math.round(Math.max(0, Math.min(1, yv2)) * 100) : 28
            );
            ytPlayer.playVideo();
          }
        }

        function buildNameBits() {
          var host = document.querySelector(".name-bits");
          if (!host || host.getAttribute("data-built") === "1") return;
          host.setAttribute("data-built", "1");
          var n = 28;
          var html = "";
          for (var i = 0; i < n; i++) {
            // Keep bits on/around the letters — not into the badge on the right
            var left = 4 + Math.random() * 72;
            var top = 8 + Math.random() * 78;
            var w = 1 + Math.random() * 2.4;
            var h = 1 + Math.random() * 2.8;
            if (Math.random() > 0.55) {
              w = 1.2 + Math.random() * 3.2;
              h = 0.8 + Math.random() * 1.4;
            }
            var r = Math.floor(Math.random() * 360);
            var d = (1.8 + Math.random() * 2.4).toFixed(2) + "s";
            var delay = (-Math.random() * 3).toFixed(2) + "s";
            var x1 = (-4 + Math.random() * 8).toFixed(1) + "px";
            var y1 = (-6 + Math.random() * -2).toFixed(1) + "px";
            var x2 = (-5 + Math.random() * 10).toFixed(1) + "px";
            var y2 = (-10 + Math.random() * -2).toFixed(1) + "px";
            var x3 = (-3 + Math.random() * 6).toFixed(1) + "px";
            var y3 = (-5 + Math.random() * 4).toFixed(1) + "px";
            html +=
              '<i style="left:' +
              left.toFixed(1) +
              "%;top:" +
              top.toFixed(1) +
              "%;width:" +
              w.toFixed(1) +
              "px;height:" +
              h.toFixed(1) +
              "px;--r:" +
              r +
              "deg;--d:" +
              d +
              ";--delay:" +
              delay +
              ";--x1:" +
              x1 +
              ";--y1:" +
              y1 +
              ";--x2:" +
              x2 +
              ";--y2:" +
              y2 +
              ";--x3:" +
              x3 +
              ";--y3:" +
              y3 +
              ';"></i>';
          }
          host.innerHTML = html;
        }

        function applyBuildingLinks() {
          var robloxUrl = String(C.robloxProfileUrl || "").trim();
          var robloxCard = document.getElementById("roblox-card");
          if (robloxCard && robloxUrl) robloxCard.href = robloxUrl;

          var uid = String(C.profileDiscordUserId || "").trim();
          var discCard = document.getElementById("discord-user-card");
          if (discCard && uid) {
            discCard.href = "https://discord.com/users/" + encodeURIComponent(uid);
          }

          var join = String(C.serverJoinUrl || "").trim();
          if (join && join.indexOf("http") !== 0) join = "https://" + join.replace(/^\/\//, "");
          var serverCard = document.getElementById("server-card");
          if (serverCard && join) serverCard.href = join;

          var vanityEl = document.getElementById("srv-vanity");
          var vanity = String(C.serverVanity || "").trim();
          if (vanityEl && vanity) vanityEl.textContent = vanity;

          var badgeEl = document.getElementById("srv-badge");
          var badge = String(C.serverBadge || "").trim();
          if (badgeEl && badge) badgeEl.textContent = badge;

          var nowTitle = document.getElementById("now-title");
          var nowSub = document.getElementById("now-sub");
          if (nowTitle && C.rightNowTitle) nowTitle.textContent = C.rightNowTitle;
          if (nowSub && C.rightNowSub) nowSub.textContent = C.rightNowSub;
        }

        function loadRobloxAvatar() {
          var img = document.getElementById("roblox-av");
          var userId = String(C.robloxUserId || "").trim();
          if (!img || !userId) return;
          var localFallback = "/assets/roblox-av.png?v=2";
          if (!img.getAttribute("src") || img.getAttribute("src").indexOf("data:") === 0) {
            img.src = localFallback;
          }
          // Official Roblox thumbnail API blocks browser CORS — use roproxy, then local file
          var endpoints = [
            "https://thumbnails.roproxy.com/v1/users/avatar-headshot?userIds=" +
              encodeURIComponent(userId) +
              "&size=150x150&format=Png&isCircular=false",
            "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
              encodeURIComponent(userId) +
              "&size=150x150&format=Png&isCircular=false",
          ];
          function tryEndpoint(i) {
            if (i >= endpoints.length) {
              if (img.getAttribute("data-src") !== localFallback) {
                img.setAttribute("data-src", localFallback);
                img.src = localFallback;
              }
              return;
            }
            fetch(endpoints[i], { credentials: "omit", cache: "no-store" })
              .then(function (r) {
                if (!r.ok) throw new Error("roblox " + r.status);
                return r.json();
              })
              .then(function (body) {
                var list = (body && body.data) || [];
                var first = list[0];
                var url = first && first.imageUrl ? String(first.imageUrl).trim() : "";
                if (!url) throw new Error("no image");
                // rbxcdn sometimes 404s stale hashes — probe before swapping
                var probe = new Image();
                probe.onload = function () {
                  img.setAttribute("data-src", url);
                  img.src = url;
                };
                probe.onerror = function () {
                  tryEndpoint(i + 1);
                };
                probe.src = url;
              })
              .catch(function () {
                tryEndpoint(i + 1);
              });
          }
          tryEndpoint(0);
        }

        function apply() {
          document.documentElement.style.setProperty("--z-font", C.fontFamily || "Inter, system-ui, sans-serif");

          var cu = (C.cursorPngUrl || "").trim();
          var curWrap = document.getElementById("cursor-3d");
          var curImg = document.getElementById("cursor-img");
          if (cu && curWrap && curImg) {
            curImg.onerror = function () {
              document.body.classList.remove("cursor-none");
              curWrap.classList.add("hidden");
              curImg.removeAttribute("src");
              curImg.removeAttribute("data-src");
            };
            document.body.classList.add("cursor-none");
            curWrap.classList.remove("hidden");
            if (curImg.getAttribute("data-src") !== cu) {
              curImg.setAttribute("data-src", cu);
              curImg.src = cu;
            }
          } else if (curWrap && curImg) {
            curImg.onerror = null;
            document.body.classList.remove("cursor-none");
            curWrap.classList.add("hidden");
            curImg.removeAttribute("src");
            curImg.removeAttribute("data-src");
          }

          var gateLabel = document.getElementById("gate-label");
          if (gateLabel) gateLabel.textContent = C.gateText || "click to enter";
          var nameText = document.getElementById("name");
          if (nameText) {
            nameText.textContent = C.displayName || "refuse";
          }
          var nameEl = document.querySelector(".display-name");
          if (nameEl) {
            nameEl.classList.toggle("display-name--rainbow", !!C.rainbowName);
          }
          buildNameBits();
          var nameColor = String(C.displayNameColor || "").trim();
          if (nameColor) {
            document.documentElement.style.setProperty("--name", nameColor);
          }
          var accent = String(C.accentColor || C.displayNameColor || "").trim();
          if (accent) {
            document.documentElement.style.setProperty("--accent", accent);
          }
          var nameGlow = String(C.nameGlowColor || "").trim();
          if (nameGlow) {
            document.documentElement.style.setProperty("--name-glow", nameGlow);
          }
          var iconsEl = document.getElementById("name-icons");
          if (iconsEl) iconsEl.classList.toggle("hidden", !C.showDiamond);
          var bioEl = document.getElementById("bio");
          var joinedEl = document.getElementById("joined");
          if (bioEl) {
            bioEl.textContent = C.bioQuote || "";
            bioEl.classList.toggle("hidden", !C.bioQuote);
          }
          if (joinedEl) {
            joinedEl.textContent = C.joinedLine || "";
            joinedEl.classList.toggle("hidden", !C.joinedLine);
          }

          applyBuildingLinks();

          var hi = document.getElementById("hero-img");
          var hp = (C.profileImageUrl || "").trim();
          // Don't stomp a live Discord PFP with the static fallback
          if (hi && !heroAvatarLive) {
            if (hp) {
              hi.src = hp;
              hi.classList.remove("hidden");
              setBuildDiscordAvatar(hp);
            } else {
              hi.removeAttribute("src");
              hi.classList.add("hidden");
            }
          }

          if (C.presenceName) setDiscordHandle(String(C.presenceName).replace(/^@/, ""));
          var statusEl = document.getElementById("discord-status");
          var statusLive = statusEl && statusEl.getAttribute("data-live") === "1";
          if (!statusLive) {
            var statusFallback = String(C.presenceStatus || "offline").toLowerCase();
            if (statusEl) statusEl.textContent = statusFallback;
            setStatusDot(statusFallback);
          }

          document.getElementById("pres-name") &&
            (document.getElementById("pres-name").textContent = C.presenceName || "");
          document.getElementById("pres-status") &&
            (document.getElementById("pres-status").textContent = C.presenceStatus || "");
          var pw = document.getElementById("pres-wrap");
          var pi = document.getElementById("pres-img");
          var pa = (C.presenceAvatarUrl || "").trim();
          if (pi && pw) {
            if (pa) {
              pi.src = pa;
              pw.classList.remove("hidden");
            } else {
              pi.removeAttribute("src");
              pw.classList.add("hidden");
            }
          }
          var dndEl = document.getElementById("pres-dnd");
          if (dndEl) dndEl.classList.toggle("hidden", !C.presenceDnd || !pa);

          var bgv = document.getElementById("bg-video");
          var bf = document.getElementById("bg-fallback");
          var vurl = (C.backgroundVideoUrl || "").trim();
          if (vurl) {
            bgv.classList.remove("hidden");
            bf.classList.add("hidden");
            if (bgv.getAttribute("data-src") !== vurl) {
              bgv.setAttribute("data-src", vurl);
              bgv.src = vurl;
              bgv.muted = true;
              bgv.playsInline = true;
              bgv.play().catch(function () {});
            } else {
              bgv.muted = true;
            }
          } else {
            bgv.classList.add("hidden");
            bgv.removeAttribute("src");
            bf.classList.remove("hidden");
          }

          var a1 = document.getElementById("audio1");
          var raw =
            (C.soundUrl || C.sound1YoutubeUrl || C.sound1Url || "").trim();
          var sound =
            (window.ZETH_SOUND && window.ZETH_SOUND.resolve(raw)) || { kind: "none" };
          useYoutube = sound.kind === "youtube";
          if (useYoutube) {
            a1.pause();
            a1.removeAttribute("src");
            a1.removeAttribute("data-src");
            initYoutubeTrack(sound.youtubeId);
          } else {
            destroyYoutubePlayer();
            if (sound.kind === "audio" && sound.src) {
              var nextSrc = sound.src;
              if (a1.getAttribute("data-src") !== nextSrc || !a1.getAttribute("src")) {
                a1.setAttribute("data-src", nextSrc);
                a1.src = nextSrc;
                try {
                  a1.load();
                } catch (eLoad) {}
              }
              var vol = Number(C.soundVolume);
              if (!isFinite(vol)) vol = 0.16;
              // Don't hard-set volume every apply() while playing (causes mobile spikes)
              if (a1.paused || a1.volume === 0 || a1.volume === 1) {
                a1.volume = Math.max(0, Math.min(1, vol));
              }
            } else {
              a1.removeAttribute("src");
              a1.removeAttribute("data-src");
            }
          }

          sameBgAsAudio = false;
          if (!useYoutube && sound.kind === "audio" && sound.src && vurl && a1 && bgv) {
            var dsV = bgv.getAttribute("data-src") || "";
            var dsA = a1.getAttribute("data-src") || "";
            sameBgAsAudio = !!dsV && dsV === dsA;
          }

        }

        setViewCountDisplay(localStorage.getItem(VIEWS_KEY) || viewsFloor());
        fetchLiveViews();

        apply();
        loadRobloxAvatar();
        startAvatarPolling();
        startLanyardSocket();
        loadDiscordBadges();
        startCustomBadgesPolling();
        startLanyardPolling();
        renderFriendWidgets();
        renderSocials();
        if (window.ZETH_DISCORD_SERVER && typeof window.ZETH_DISCORD_SERVER.init === "function") {
          window.ZETH_DISCORD_SERVER.init();
        }

        /* Title typewriter when view.html is top-level (iframe parent handles it otherwise) */
        (function startTitleType() {
          if (window !== window.top) return;
          var frames = [
            "s",
            "sl",
            "sli",
            "slit",
            "slits",
            "slits.",
            "slits.l",
            "slits.lo",
            "slits.lol",
            "slits.lol",
            "slits.lo",
            "slits.l",
            "slits.",
            "slits",
            "slit",
            "sli",
            "sl",
            "s",
            ".",
            ".",
          ];
          var i = 0;
          function tick() {
            document.title = frames[i];
            var cur = frames[i];
            var hold = cur === "slits.lol" || cur === "." ? 700 : 160;
            i = (i + 1) % frames.length;
            setTimeout(tick, hold);
          }
          tick();
        })();

        /* trail + 3D tilt + custom cursor (single RAF) */
        var trailOn = !!C.cursorTrail;
        var tiltDeg = typeof C.cursor3DTiltDeg === "number" ? C.cursor3DTiltDeg : 14;
        var curPivotX =
          typeof C.cursorPivotXPct === "number" && isFinite(C.cursorPivotXPct)
            ? C.cursorPivotXPct
            : 50;
        var curPivotY =
          typeof C.cursorPivotYPct === "number" && isFinite(C.cursorPivotYPct)
            ? C.cursorPivotYPct
            : 50;
        var canvas = document.getElementById("trail-canvas");
        var ctx = canvas.getContext("2d");
        var rainCanvas = document.getElementById("rain-canvas");
        var rctx = rainCanvas.getContext("2d");
        var rainOn = C.rainEnabled !== false;
        var useSnow = C.snowflakes !== false;
        var rainMul =
          typeof C.rainIntensity === "number" && C.rainIntensity > 0 ? C.rainIntensity : 1;
        var drops = [];
        var pts = [];
        var maxPts = 48;
        var mx = window.innerWidth / 2;
        var my = window.innerHeight / 2;
        var curX = mx;
        var curY = my;

        function accentRgb() {
          var hex = String(C.accentColor || C.displayNameColor || "#140B97").trim();
          var m = hex.match(/^#?([0-9a-f]{6})$/i);
          if (!m) return { r: 20, g: 11, b: 151 };
          var n = parseInt(m[1], 16);
          return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        }

        function sizeCanvas() {
          var d = window.devicePixelRatio || 1;
          canvas.width = window.innerWidth * d;
          canvas.height = window.innerHeight * d;
          canvas.style.width = window.innerWidth + "px";
          canvas.style.height = window.innerHeight + "px";
          ctx.setTransform(d, 0, 0, d, 0, 0);
        }

        function buildRain() {
          drops = [];
          if (!rainOn) return;
          var w = window.innerWidth;
          var h = window.innerHeight;
          var base = Math.floor(((w * h) / 14000) * rainMul);
          var n = useSnow
            ? Math.min(220, Math.max(40, Math.floor(base * 0.55)))
            : Math.min(900, Math.max(80, base));
          for (var i = 0; i < n; i++) {
            if (useSnow) {
              drops.push({
                x: Math.random() * w,
                y: Math.random() * h,
                size: 2.2 + Math.random() * 3.4,
                vy: 0.35 + Math.random() * 0.85,
                vx: -0.35 + Math.random() * 0.7,
                rot: Math.random() * Math.PI,
                spin: -0.02 + Math.random() * 0.04,
                a: 0.35 + Math.random() * 0.45,
              });
            } else {
              drops.push({
                x: Math.random() * w,
                y: Math.random() * h,
                len: 12 + Math.random() * 24,
                vy: 10 + Math.random() * 18,
                vx: -2.2 - Math.random() * 2.2,
                w: 0.5 + Math.random() * 0.6,
                a: 0.14 + Math.random() * 0.2,
              });
            }
          }
        }

        function sizeRainCanvas() {
          var d = window.devicePixelRatio || 1;
          rainCanvas.width = window.innerWidth * d;
          rainCanvas.height = window.innerHeight * d;
          rainCanvas.style.width = window.innerWidth + "px";
          rainCanvas.style.height = window.innerHeight + "px";
          rctx.setTransform(d, 0, 0, d, 0, 0);
          buildRain();
        }

        function drawSnowflake(x, y, size, rot, a, rgb) {
          rctx.save();
          rctx.translate(x, y);
          rctx.rotate(rot);
          rctx.strokeStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + a + ")";
          rctx.fillStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + a * 0.85 + ")";
          rctx.lineWidth = Math.max(0.7, size * 0.22);
          rctx.lineCap = "round";
          var arm = size;
          for (var k = 0; k < 6; k++) {
            rctx.rotate(Math.PI / 3);
            rctx.beginPath();
            rctx.moveTo(0, 0);
            rctx.lineTo(0, -arm);
            rctx.moveTo(0, -arm * 0.45);
            rctx.lineTo(-arm * 0.22, -arm * 0.65);
            rctx.moveTo(0, -arm * 0.45);
            rctx.lineTo(arm * 0.22, -arm * 0.65);
            rctx.stroke();
          }
          rctx.beginPath();
          rctx.arc(0, 0, Math.max(0.6, size * 0.18), 0, Math.PI * 2);
          rctx.fill();
          rctx.restore();
        }

        function drawRain() {
          var d = window.devicePixelRatio || 1;
          var w = window.innerWidth;
          var h = window.innerHeight;
          if (!rainOn) {
            rctx.setTransform(1, 0, 0, 1, 0, 0);
            rctx.clearRect(0, 0, rainCanvas.width, rainCanvas.height);
            rctx.setTransform(d, 0, 0, d, 0, 0);
            return;
          }
          rctx.clearRect(0, 0, w, h);
          var rgb = accentRgb();
          if (useSnow) {
            for (var i = 0; i < drops.length; i++) {
              var s = drops[i];
              s.y += s.vy;
              s.x += s.vx + Math.sin(s.y * 0.02 + i) * 0.15;
              s.rot += s.spin;
              if (s.y > h + 12) {
                s.y = -12 - Math.random() * 40;
                s.x = Math.random() * w;
              }
              if (s.x < -20) s.x = w + 10;
              if (s.x > w + 20) s.x = -10;
              drawSnowflake(s.x, s.y, s.size, s.rot, s.a, rgb);
            }
            return;
          }
          rctx.lineCap = "round";
          for (var j = 0; j < drops.length; j++) {
            var o = drops[j];
            o.y += o.vy;
            o.x += o.vx * 0.35;
            if (o.y > h + o.len) {
              o.y = -o.len - Math.random() * 100;
              o.x = Math.random() * w;
            }
            if (o.x < -40) o.x = w + 20;
            rctx.beginPath();
            rctx.strokeStyle =
              "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + o.a + ")";
            rctx.lineWidth = o.w;
            rctx.moveTo(o.x, o.y);
            rctx.lineTo(o.x + o.vx * 1.2, o.y + o.len);
            rctx.stroke();
          }
        }

        sizeCanvas();
        sizeRainCanvas();
        window.addEventListener("resize", function () {
          sizeCanvas();
          sizeRainCanvas();
        });

        var tiltHover = false;
        var tiltTargetX = 0;
        var tiltTargetY = 0;
        var tiltCurX = 0;
        var tiltCurY = 0;
        var tiltScene = document.getElementById("tilt-scene");
        var tiltPad = 28;

        function updateTiltFromPointer(clientX, clientY) {
          if (!tiltDeg || !tiltScene) {
            tiltHover = false;
            tiltTargetX = 0;
            tiltTargetY = 0;
            return;
          }
          var rect = tiltScene.getBoundingClientRect();
          var inX = clientX >= rect.left - tiltPad && clientX <= rect.right + tiltPad;
          var inY = clientY >= rect.top - tiltPad && clientY <= rect.bottom + tiltPad;
          tiltHover = inX && inY;
          if (!tiltHover) {
            tiltTargetX = 0;
            tiltTargetY = 0;
            return;
          }
          var cx = rect.left + rect.width / 2;
          var cy = rect.top + rect.height / 2;
          var nx = (clientX - cx) / Math.max(rect.width / 2, 1);
          var ny = (clientY - cy) / Math.max(rect.height / 2, 1);
          nx = Math.max(-1, Math.min(1, nx));
          ny = Math.max(-1, Math.min(1, ny));
          tiltTargetX = ny * -tiltDeg;
          tiltTargetY = nx * tiltDeg;
        }

        window.addEventListener("mousemove", function (e) {
          mx = e.clientX;
          my = e.clientY;
          updateTiltFromPointer(mx, my);
          if (trailOn) {
            pts.push({ x: mx, y: my, t: Date.now() });
            while (pts.length > maxPts) pts.shift();
          }
        });

        window.addEventListener("mouseleave", function () {
          tiltHover = false;
          tiltTargetX = 0;
          tiltTargetY = 0;
        });

        function drawTrail() {
          if (!trailOn) return;
          ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
          if (pts.length < 2) return;
          var now = Date.now();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          for (var i = 1; i < pts.length; i++) {
            var a = pts[i - 1];
            var b = pts[i];
            var age = (now - b.t) / 600;
            var alpha = Math.max(0, 0.35 - age * 0.35);
            var w = 0.6 + (i / pts.length) * 2.2;
            ctx.strokeStyle = "rgba(255,255,255," + alpha + ")";
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        function tickMotion() {
          var w = window.innerWidth;
          var h = window.innerHeight;
          curX += (mx - curX) * 0.28;
          curY += (my - curY) * 0.28;

          tiltCurX += (tiltTargetX - tiltCurX) * 0.16;
          tiltCurY += (tiltTargetY - tiltCurY) * 0.16;
          var rotX = tiltCurX;
          var rotY = tiltCurY;

          var scene = tiltScene || document.getElementById("tilt-scene");
          if (scene) {
            scene.style.transform =
              "rotateX(" +
              rotX.toFixed(3) +
              "deg) rotateY(" +
              rotY.toFixed(3) +
              "deg) translateZ(12px)";
          }

          var cw = document.getElementById("cursor-3d");
          if (cw && !cw.classList.contains("hidden")) {
            var amp = 1.35;
            cw.style.transform =
              "translate3d(" +
              curX +
              "px," +
              curY +
              "px,0) translate(-" +
              curPivotX +
              "%,-" +
              curPivotY +
              "%) perspective(120px) rotateX(" +
              -rotY * amp +
              "deg) rotateY(" +
              rotX * amp +
              "deg)";
          }

          if (useYoutube && ytPlayer && ytReady) {
            var st = ytPlayer.getPlayerState();
            setPlayButtonPlaying(st === 1);
            var seekEl = document.getElementById("seek");
            var tCurrEl = document.getElementById("t-curr");
            var tDurEl = document.getElementById("t-dur");
            var dYt = ytPlayer.getDuration();
            var cYt = ytPlayer.getCurrentTime();
            if (!drag && seekEl && tCurrEl && tDurEl && isFinite(dYt) && dYt > 0) {
              seekEl.value = String((cYt / dYt) * 1000);
              tCurrEl.textContent = fmt(cYt);
              tDurEl.textContent = fmt(dYt);
            }
          }

          drawTrail();
          drawRain();

          if (mobileAvSync && gateOpened && !useYoutube) {
            var aEl = document.getElementById("audio1");
            var bv = document.getElementById("bg-video");
            var nowMs = Date.now();
            // Audio is master — never seek the song (seeking audio on mobile = stutter/spike loop).
            // Only nudge the muted background video toward the track, throttled.
            if (aEl && aEl.src && !aEl.paused && bv && bv.src && !bv.paused) {
              if (nowMs - lastMobileVidSync >= 1200) {
                var drift = Math.abs(aEl.currentTime - bv.currentTime);
                if (drift > 0.85) {
                  lastMobileVidSync = nowMs;
                  try {
                    var capV =
                      isFinite(bv.duration) && bv.duration > 0
                        ? Math.max(0, bv.duration - 0.04)
                        : aEl.currentTime;
                    bv.currentTime = Math.min(Math.max(0, aEl.currentTime), capV);
                  } catch (eSyncV) {}
                }
              }
            }
            // If iOS paused audio during a stutter, gently resume (no seek) — throttled
            if (aEl && aEl.src && aEl.paused) {
              if (nowMs - lastMobileVidSync >= 800) {
                lastMobileVidSync = nowMs;
                aEl.play().catch(function () {});
              }
            }
          }

          requestAnimationFrame(tickMotion);
        }
        requestAnimationFrame(tickMotion);

        /* hidden audio (no player UI) */
        var audio1 = document.getElementById("audio1");
        var seek = document.getElementById("seek");
        var tCurr = document.getElementById("t-curr");
        var tDur = document.getElementById("t-dur");
        var btnPlay = document.getElementById("btn-play");
        var btnPrev = document.getElementById("btn-prev");
        var btnNext = document.getElementById("btn-next");
        var drag = false;
        var hasPlayerUi = !!(seek && tCurr && tDur && btnPlay);

        function syncBgVideoToAudio() {
          if (!mobileAvSync) return;
          var bv = document.getElementById("bg-video");
          var a = document.getElementById("audio1");
          if (!bv || !bv.src || !a || !a.src) return;
          if (sameBgAsAudio) {
            var d = Math.abs((a.currentTime || 0) - (bv.currentTime || 0));
            if (d < 0.08) return;
          }
          try {
            var t = a.currentTime || 0;
            var capV =
              isFinite(bv.duration) && bv.duration > 0 ? Math.max(0, bv.duration - 0.04) : t;
            bv.currentTime = Math.min(Math.max(0, t), capV);
          } catch (eBv) {}
        }

        function syncIcon() {
          if (!hasPlayerUi || useYoutube) return;
          setPlayButtonPlaying(!audio1.paused);
        }

        function syncSeek() {
          if (!hasPlayerUi || useYoutube) return;
          var d = audio1.duration;
          if (!isFinite(d) || d <= 0) return;
          if (!drag) seek.value = String((audio1.currentTime / d) * 1000);
          tCurr.textContent = fmt(audio1.currentTime);
          tDur.textContent = fmt(d);
        }

        if (hasPlayerUi) {
          audio1.addEventListener("timeupdate", syncSeek);
          audio1.addEventListener("loadedmetadata", function () {
            tDur.textContent = fmt(audio1.duration);
            syncSeek();
          });
          audio1.addEventListener("play", syncIcon);
          audio1.addEventListener("pause", syncIcon);

          seek.addEventListener("input", function () {
            drag = true;
            if (useYoutube && ytPlayer && ytReady) {
              var dY = ytPlayer.getDuration();
              if (isFinite(dY) && dY > 0) tCurr.textContent = fmt((parseFloat(seek.value) / 1000) * dY);
              return;
            }
            var d = audio1.duration;
            if (isFinite(d) && d > 0) tCurr.textContent = fmt((parseFloat(seek.value) / 1000) * d);
          });
          seek.addEventListener("change", function () {
            if (useYoutube && ytPlayer && ytReady) {
              var dY = ytPlayer.getDuration();
              if (isFinite(dY) && dY > 0) ytPlayer.seekTo((parseFloat(seek.value) / 1000) * dY, true);
              drag = false;
              return;
            }
            var d = audio1.duration;
            if (isFinite(d) && d > 0) audio1.currentTime = (parseFloat(seek.value) / 1000) * d;
            syncBgVideoToAudio();
            drag = false;
          });

          btnPlay.addEventListener("click", function () {
            if (useYoutube && ytPlayer && ytReady) {
              if (ytPlayer.getPlayerState() === 1) ytPlayer.pauseVideo();
              else ytPlayer.playVideo();
              return;
            }
            if (audio1.paused) audio1.play().catch(function () {});
            else audio1.pause();
          });
          if (btnPrev) {
            btnPrev.addEventListener("click", function () {
              if (useYoutube && ytPlayer && ytReady) {
                var c = ytPlayer.getCurrentTime();
                ytPlayer.seekTo(Math.max(0, c - 10), true);
                return;
              }
              audio1.currentTime = Math.max(0, audio1.currentTime - 10);
              syncBgVideoToAudio();
            });
          }
          if (btnNext) {
            btnNext.addEventListener("click", function () {
              if (useYoutube && ytPlayer && ytReady) {
                var dY = ytPlayer.getDuration();
                var c = ytPlayer.getCurrentTime();
                if (isFinite(dY) && dY > 0) ytPlayer.seekTo(Math.min(dY, c + 10), true);
                else ytPlayer.seekTo(c + 10, true);
                return;
              }
              if (isFinite(audio1.duration))
                audio1.currentTime = Math.min(audio1.duration, audio1.currentTime + 10);
              else audio1.currentTime += 10;
              syncBgVideoToAudio();
            });
          }
          syncIcon();
        }

        /* gate */
        var gate = document.getElementById("gate");
        var gateOpened = false;
        var siteMusicPausedForListen = false;

        function isListeningNow() {
          return !!(
            window.ZETH_NOW_PLAYING &&
            typeof window.ZETH_NOW_PLAYING.isListening === "function" &&
            window.ZETH_NOW_PLAYING.isListening()
          );
        }

        function playFromUserGesture(el, fromStart) {
          if (!el || !el.src) return;
          if (fromStart) {
            try {
              el.currentTime = 0;
            } catch (eStart) {}
          }
          el.muted = false;
          var vol = Number(C.soundVolume);
          applySoundVolume(el, isFinite(vol) ? vol : 0.16, fromStart || mobileAvSync ? 500 : 0);
          var p = el.play();
          if (p && typeof p.catch === "function") {
            p.catch(function () {
              function onReady() {
                el.removeEventListener("canplay", onReady);
                applySoundVolume(el, isFinite(vol) ? vol : 0.16, 400);
                el.play().catch(function () {});
              }
              el.addEventListener("canplay", onReady);
            });
          }
        }

        function pauseSiteMusicForListening() {
          if (C.pauseSiteMusicWhenListening === false) return;
          siteMusicPausedForListen = true;
          if (useYoutube && ytPlayer && ytReady) {
            try {
              ytPlayer.pauseVideo();
            } catch (eYtP) {}
            return;
          }
          if (audio1 && !audio1.paused) {
            try {
              audio1.pause();
            } catch (eA) {}
          }
        }

        function resumeSiteMusicIfIdle() {
          if (C.pauseSiteMusicWhenListening === false) return;
          if (!gateOpened) return;
          if (isListeningNow()) return;
          siteMusicPausedForListen = false;
          if (useYoutube) {
            tryYoutubeGatePlay(false);
            return;
          }
          if (audio1 && audio1.src && audio1.paused) {
            playFromUserGesture(audio1, false);
          }
        }

        function openGate() {
          var firstOpen = !gateOpened;
          if (!gateOpened) {
            gateOpened = true;
            bumpLiveViews();
          }
          window.ZETH_GATE_OPENED = true;
          gate.classList.add("is-off");
          // Unlock listening audio inside this tap (phones block unmute otherwise)
          if (window.ZETH_NOW_PLAYING) {
            if (typeof window.ZETH_NOW_PLAYING.unlockListenSound === "function") {
              window.ZETH_NOW_PLAYING.unlockListenSound();
            } else if (typeof window.ZETH_NOW_PLAYING.onGateOpen === "function") {
              window.ZETH_NOW_PLAYING.onGateOpen();
            }
          }
          var v = document.getElementById("bg-video");
          var hasVideo = v && v.src;

          if (hasVideo) {
            v.muted = true;
            if (firstOpen) {
              try {
                v.currentTime = 0;
              } catch (e2) {}
            }
            v.play().catch(function () {});
          }

          // If already listening on YT Music / Spotify, skip site MP3
          if (C.pauseSiteMusicWhenListening !== false && isListeningNow()) {
            siteMusicPausedForListen = true;
            return;
          }

          if (useYoutube) {
            tryYoutubeGatePlay(firstOpen);
            return;
          }

          playFromUserGesture(audio1, firstOpen);
        }
        gate.addEventListener("click", openGate);
        gate.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openGate();
          }
        });

        if (window.ZETH_NOW_PLAYING && typeof window.ZETH_NOW_PLAYING.onListeningChange === "function") {
          window.ZETH_NOW_PLAYING.onListeningChange(function (meta) {
            if (meta) pauseSiteMusicForListening();
            else resumeSiteMusicIfIdle();
          });
        }

      })();

