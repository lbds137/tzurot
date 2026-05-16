## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### 🧪 `MessageContextBuilder.getBotSuffix` cache-behavior test

`MessageContextBuilder.getBotSuffix` (private) lazily caches the canonical bot suffix derived from `client.user.tag`. The lazy-cache + first-call-wins behavior was introduced in PR #1035 round-2 as a complexity-reduction extraction but has no direct unit test — the existing tests exercise the method transitively via `fetchExtendedContext`'s call to `channelFetcher.fetchRecentMessages`, but don't pin the cache contract (second call returns cached value without re-deriving, `null`-tag input caches `''` and stays cached). **Fix shape**: add a small describe block in `MessageContextBuilder.test.ts` that constructs the builder, fires `fetchExtendedContext` twice with different mock `Client.user.tag` values, and asserts the first-call value sticks. ~20 LOC. **Start**: `services/bot-client/src/services/MessageContextBuilder.test.ts`. Surfaced 2026-05-16 during PR #1036 audit.

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.
