## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### ✨ `/character chat` polish — bundled (target next release)

Two sibling improvements that both touch `services/bot-client/src/commands/character/`. Bundle into one PR.

- **Make the random-pick "🎲 Picked X at random!" notice ephemeral.** Currently the slash command defers publicly, so the `editReply` in `finalizeDeferredReply` (`randomPick.ts:91`) lands as a channel-visible message. The user wants it private to the invoker. The user-mirror message (`channel.send`, line 152) and character reply stay public — only the random-pick notice changes. **Fix shape**: defer ephemerally; verify the explicit-pick `deleteReply` path still works on ephemeral defers. ~5-line change + test. **Start**: `chat.ts` (defer config) + `randomPick.test.ts`. Surfaced 2026-05-15.

- **Add `only-mine` option to the random-pick pool.** Sibling to the existing `exclude-private` toggle, **independent and composable** (not mutually exclusive). When set, the random pool is restricted to the user's owned characters. Combined with `exclude-private`, the pool becomes the user's owned-AND-public characters. **Fix shape**: new boolean option `only-mine` on the `chat` subcommand; in `resolveCharacterSlug` (`randomPick.ts:39-72`), apply ownership filter and visibility filter independently (both as AND-conjunctions). **Start**: `packages/common-types/src/discord/characterChatOptions.ts` for the option definition, then thread through `resolveCharacterSlug` + tests. Surfaced 2026-05-15.

### 🐛 Detect and Retry Inadequate LLM Responses

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.
