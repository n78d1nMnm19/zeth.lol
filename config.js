/**
 * slits.lol — edit this file, save, refresh the page.
 * Use full https URLs for media when hosting online.
 */
window.ZETH_CONFIG = {
  /** Full-screen looped video (mp4). Leave "" for solid black. */
  backgroundVideoUrl: "",

  /** Animated rain/snow over the background (below cards). Set false to disable. */
  rainEnabled: true,
  /** Particle density multiplier (1 = default). */
  rainIntensity: 0.55,
  /** Use soft falling snowflakes instead of rain streaks. */
  snowflakes: false,

  /**
   * One track — YouTube (watch / youtu.be / Shorts / 11-char id) OR direct media (.mp3, .mp4, .ogg, URL).
   * Same file as the background is fine: the `<audio>` element plays the file’s audio track.
   * Plays automatically when you click the gate (“click to enter”).
   */
  soundUrl: "/assets/snaptik_7675527030619786528_v3.mp4?v=3",
  /** Playback volume 0–1 (softer = less harsh). */
  soundVolume: 0.85,
  /**
   * Keep the site track playing even while Spotify / listening card is active.
   * Listening UI is lyrics + metadata only (no YouTube mirror audio).
   */
  pauseSiteMusicWhenListening: false,

  /** Custom cursor — leave "" for normal system cursor. */
  cursorPngUrl: "",
  /** Pointer position on the cursor art (0–100 from top-left). Centered for the glow orb. */
  cursorPivotXPct: 50,
  cursorPivotYPct: 50,
  /** Draw a soft trail behind the pointer at all times. */
  cursorTrail: false,
  /** How much the profile tilts in 3D when the mouse moves over it (degrees). */
  cursor3DTiltDeg: 0,

  /** Big name under the profile picture */
  displayName: "refuse",
  showDiamond: false,
  /** Solid name color (ignored when rainbowName is true). */
  displayNameColor: "#FFFFFF",
  /** Site accent (views, snow, badge glow). */
  accentColor: "#c8f0c8",
  /** Soft glow behind the display name (CSS color). */
  nameGlowColor: "rgba(180, 230, 180, 0.55)",
  /** Animated rainbow text for the display name. */
  rainbowName: false,

  /** Quote / bio under the name */
  bioQuote: "",
  joinedLine: "",

  /** “right now” fallbacks when Discord has no activity */
  rightNowTitle: "doing nothing.",
  rightNowSub: "probably somewhere on discord",

  /**
   * Main profile picture — overwritten live by Discord avatar when sync is on.
   * Fallback only if Discord fetch fails.
   */
  profileImageUrl: "/assets/pfp.png?v=2",
  /** Discord user whose avatar + handle sync to the site. */
  profileDiscordUserId: "714938930948079728",
  /** Keep PFP in sync with that Discord account. */
  syncProfileAvatar: true,
  /** How often to re-check Discord PFP (ms). Lower = faster updates. Min 3000. */
  profileAvatarPollMs: 5000,

  /**
   * Discord profile badges (dstn JSON). Icons are resolved to Discord’s CDN.
   * Example: "https://dcdn.dstn.to/profile/<user_id>"
   */
  discordBadgesProfileUrl: "",

  /**
   * Live Discord presence via Lanyard (https://github.com/Phineas/lanyard).
   * Example: "https://api.lanyard.rest/v1/users/<snowflake>"
   * You need to join the Lanyard Discord server so this user is tracked.
   */
  lanyardUserUrl: "https://api.lanyard.rest/v1/users/714938930948079728",
  /** How often to refresh presence (ms). Minimum 15000. */
  lanyardPollMs: 15000,

  /**
   * Spotify now-playing (official API). Connect once at /spotify-setup.html.
   * Real play/pause via GET /api/listening — typically ~1s delay.
   */
  youtubeMusicEnabled: true,
  /** Spotify currently-playing (same function that stores OAuth tokens). */
  listeningApiUrl: "/api/spotify?action=now",
  /** How often the site polls Spotify (ms). */
  youtubeMusicPollMs: 1000,

  /** Fallbacks if Lanyard is off or fails (handle/PFP overwrite from Discord APIs) */
  presenceName: "",
  presenceStatus: "offline",
  presenceAvatarUrl: "",
  presenceDnd: false,

  /** Roblox profile card */
  robloxProfileUrl: "https://www.roblox.com/users/3003741744/profile",
  robloxUserId: "3003741744",

  /** Discord server invite card */
  serverJoinUrl: "https://discord.gg/endings",
  discordInviteCode: "endings",
  serverVanity: "/endings",
  serverBadge: "server",
  discordServerFromInvite: true,
  discordServerPollMs: 120000,

  /** Friend widgets — leave empty to hide */
  friendWidgets: [],

  /** Social icons — leave empty to hide */
  tiktokUrl: "",

  /**
   * Live API (views + custom badges).
   * Use the live domain so badges always match slits.lol (even if you open localhost).
   * Leave "" only if you serve everything from the same host.
   */
  apiBaseUrl: "https://slits.lol",
  /** How often to refresh custom badge emojis from the API (ms). */
  customBadgesPollMs: 15000,

  /**
   * View counter floor — display never goes below this; bumps continue upward.
   */
  viewsStartAt: 99,

  /**
   * Font stack for the page.
   */
  fontFamily: "Inter, system-ui, sans-serif",

  /** Gate overlay before the page “opens”. */
  gateText: "click to enter",
};
