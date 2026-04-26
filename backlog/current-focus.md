## 🎯 Current Focus

_This week's active work. Max 3 items._

### Post-deploy DM subscription loss fix — VERIFICATION PHASE

🐛 `[FIX]` **HIGH priority** — user-facing friction on every release.

**PR #913 shipped 2026-04-26**: SIGTERM handler refactor (Railway sends SIGTERM, not SIGINT — V1 was hard-exiting on every deploy without calling `client.destroy()`, leaving orphaned gateway sessions for Shard 0 that competed with V2's freshly-connected session for ~minutes until Discord's server-side session timeout) + opt-in `DM_RAW_GATEWAY_DIAGNOSTIC` env-gated raw-packet listener.

The original two-layer warmer plan was reframed after council consultation (`google/gemini-3.1-pro-preview`) and config investigation revealed a much simpler structural cause: Railway's deploy lifecycle was hard-killing V1 without graceful gateway disconnect because we only handled SIGINT, never SIGTERM.

**Next step**: enable `DM_RAW_GATEWAY_DIAGNOSTIC=true` on Railway dev, trigger a deploy, send a test plain-text DM, read logs. The log-presence binary signal confirms which side of the Discord/Discord.js boundary was dropping packets — see `backlog/inbox.md` "DM fix verification follow-ups (post-PR-#913)" for the three conditional branches.

**Original two-layer warmer plan superseded**: the SIGTERM hypothesis is structurally simpler and matches every observed symptom. If the diagnostic confirms the fix, we don't need the warmer at all. If it doesn't, the diagnostic tells us _which_ alternative (Discord.js cache config, Railway `overlapSeconds: 0`, etc.) to try next — narrower than the original 300-LOC speculative warmer.

### Other in-flight

_None beyond the above. TTS Engine Upgrade is Active Epic._
