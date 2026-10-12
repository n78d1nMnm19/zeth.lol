/**
 * Live Discord server card from the public invite API (no bot token).
 * Invite code is taken from serverJoinUrl, or discordInviteCode in config.
 */
(function (w) {
  var pollTimer = null;

  function parseFromUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (/^[a-zA-Z0-9]{2,40}$/.test(s) && s.indexOf("/") === -1 && s.indexOf(".") === -1) return s;
    try {
      var u = s.indexOf("http") !== 0 ? "https://" + s.replace(/^\/\//, "") : s;
      var url = new URL(u);
      var host = url.hostname.replace(/^www\./, "").toLowerCase();
      var parts = url.pathname.split("/").filter(Boolean);
      if (host === "discord.gg" && parts[0]) return decodeURIComponent(parts[0].split("?")[0]);
      if ((host === "discord.com" || host === "discordapp.com") && parts[0] === "invite" && parts[1]) {
        return decodeURIComponent(parts[1].split("?")[0]);
      }
    } catch (e0) {}
    return "";
  }

  function inviteCodeFromConfig(C) {
    C = C || {};
    var ex = String(C.discordInviteCode || "").trim();
    if (ex) return ex;
    return parseFromUrl(C.serverJoinUrl);
  }

  function guildIconUrl(guildId, iconHash, size) {
    var gid = String(guildId || "").trim();
    var h = String(iconHash || "").trim();
    if (!gid || !h) return "";
    var ext = h.indexOf("a_") === 0 ? "gif" : "webp";
    return (
      "https://cdn.discordapp.com/icons/" +
      encodeURIComponent(gid) +
      "/" +
      encodeURIComponent(h) +
      "." +
      ext +
      "?size=" +
      String(size || 128)
    );
  }

  function formatStats(inv) {
    var online = inv.approximate_presence_count;
    if (typeof online !== "number" && inv.profile && typeof inv.profile.online_count === "number") {
      online = inv.profile.online_count;
    }
    var members = inv.approximate_member_count;
    if (typeof members !== "number" && inv.profile && typeof inv.profile.member_count === "number") {
      members = inv.profile.member_count;
    }
    var o = typeof online === "number" ? online : "—";
    var m = typeof members === "number" ? members : "—";
    return o + " Online • " + m + " Members";
  }

  function applyInvitePayload(inv) {
    var g = inv && inv.guild;
    if (!g) return;
    var C = w.ZETH_CONFIG || {};
    var titleEl = document.getElementById("srv-title");
    var vanityEl = document.getElementById("srv-vanity");
    var badgeEl = document.getElementById("srv-badge");
    var statsEl = document.getElementById("srv-stats");
    var iconEl = document.getElementById("srv-icon");
    var avWrap = document.getElementById("srv-av");
    var name = g.name || (inv.profile && inv.profile.name) || "Server";
    var vanity = String(C.serverVanity || "").trim();
    if (vanityEl && vanity) {
      vanityEl.textContent = vanity;
    } else if (titleEl) {
      titleEl.textContent = name;
    }
    if (badgeEl) {
      var badge = String(C.serverBadge || "").trim();
      if (badge) badgeEl.textContent = badge;
    }
    if (statsEl) statsEl.textContent = formatStats(inv);
    if (!iconEl || !avWrap) return;
    iconEl.alt = name;
    var gid = String(g.id || inv.guild_id || "").trim();
    var hash = (g.icon || "").trim();
    if (!gid || !hash) {
      avWrap.classList.remove("has-icon");
      iconEl.classList.add("hidden");
      iconEl.removeAttribute("src");
      iconEl.removeAttribute("data-icon-src");
      return;
    }
    var url = guildIconUrl(gid, hash, 128);
    if (iconEl.getAttribute("data-icon-src") === url && iconEl.src) return;
    iconEl.setAttribute("data-icon-src", url);
    function reveal() {
      avWrap.classList.add("has-icon");
      iconEl.classList.remove("hidden");
    }
    function hide() {
      avWrap.classList.remove("has-icon");
      iconEl.classList.add("hidden");
      iconEl.removeAttribute("src");
      iconEl.removeAttribute("data-icon-src");
    }
    iconEl.onload = function () {
      reveal();
    };
    iconEl.onerror = function () {
      hide();
    };
    iconEl.classList.add("hidden");
    avWrap.classList.remove("has-icon");
    iconEl.src = url;
    if (iconEl.complete && iconEl.naturalWidth) reveal();
  }

  function refresh() {
    var C = w.ZETH_CONFIG || {};
    if (C.discordServerFromInvite === false) return;
    var code = inviteCodeFromConfig(C);
    if (!code) return;
    var api =
      "https://discord.com/api/v10/invites/" +
      encodeURIComponent(code) +
      "?with_counts=true&with_expiration=true";
    fetch(api, { credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("invite " + r.status);
        return r.json();
      })
      .then(applyInvitePayload)
      .catch(function () {});
  }

  function init() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    refresh();
    var C = w.ZETH_CONFIG || {};
    if (C.discordServerFromInvite === false) return;
    var ms = typeof C.discordServerPollMs === "number" ? C.discordServerPollMs : 120000;
    if (ms >= 30000) pollTimer = w.setInterval(refresh, ms);
  }

  w.ZETH_DISCORD_SERVER = {
    init: init,
    refresh: refresh,
    inviteCodeFromConfig: function () {
      return inviteCodeFromConfig(w.ZETH_CONFIG || {});
    },
  };
})(window);
