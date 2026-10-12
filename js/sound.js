/**
 * slits.lol — one URL for the track (YouTube or direct .mp3 / .ogg / etc.).
 * Used by index.html after config loads.
 */
(function (w) {
  function parseYoutubeId(str) {
    str = (str || "").trim();
    if (!str) return "";
    if (/^[\w-]{11}$/.test(str)) return str.slice(0, 11);
    try {
      var raw = str.indexOf("http") === 0 ? str : "https://" + str.replace(/^\/\//, "");
      var u = new URL(raw);
      var v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v.slice(0, 11);
      if (u.hostname === "youtu.be" || u.hostname === "www.youtu.be") {
        var seg = u.pathname.split("/").filter(Boolean)[0] || "";
        if (seg.length >= 11) return seg.slice(0, 11);
      }
      var em = u.pathname.match(/\/embed\/([\w-]{11})/);
      if (em) return em[1];
      em = u.pathname.match(/\/shorts\/([\w-]{11})/);
      if (em) return em[1];
      if (u.hostname.indexOf("youtube.com") !== -1 && v && /^[\w-]{11}$/.test(v)) return v.slice(0, 11);
    } catch (err) {}
    return "";
  }

  /**
   * @param {string} input — watch URL, youtu.be, Shorts, 11-char id, or direct audio URL
   * @returns {{ kind: "none" } | { kind: "youtube", youtubeId: string } | { kind: "audio", src: string }}
   */
  function resolve(input) {
    var raw = (input || "").trim();
    if (!raw) return { kind: "none" };
    var id = parseYoutubeId(raw);
    if (id) return { kind: "youtube", youtubeId: id };
    return { kind: "audio", src: raw };
  }

  w.ZETH_SOUND = {
    parseYoutubeId: parseYoutubeId,
    resolve: resolve,
  };
})(window);
