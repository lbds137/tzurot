## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

- ~~🧹 `[CHORE]` **Make `guard:duplicate-exports` and `knip` checks blocking in CI**~~ — RESOLVED in PR #941. Both checks now blocking; allowlist extended for legitimate cross-file patterns; dedup-logic bug fixed in `check-duplicate-exports.ts` (TS function overloads no longer false-positive); 6 truly dead exports deleted (`PromptContext`, `TokenBudget`, `RecentLogsResponse`, `StuckExportCleanupResult`, `StuckImportCleanupResult`, `getDenylistCache`, `createMockReqRes`); `isForwardedMessage` DRY violation between `references/types.ts` and `forwardedMessageUtils.ts` consolidated; `knip.json` configured with `ignoreExportsUsedInFile: true` to dampen option-bag false positives. CPD's `continue-on-error: true` left unchanged (out of scope for this gate).

- 🧹 `[CHORE]` **Delete `DM_RAW_GATEWAY_DIAGNOSTIC` env var entry from Railway dashboard** — Set to `false` on 2026-04-27 after empirical confirmation Layer 1 + Layer 2 fix the post-deploy DM-silence bug (PR #918). The listener code is dormant (only activates on `=== 'true'`) so this is purely cosmetic cleanup. Railway CLI can't delete env var entries (`--remove` not supported), so this needs dashboard access. **Fix shape**: log into Railway dashboard → project → bot-client service → development environment → variables → delete the `DM_RAW_GATEWAY_DIAGNOSTIC` entry. Same for prod once we deploy and confirm there. The listener code itself stays in `services/bot-client/src/index.ts` — cheap to keep dormant, gives future-us a one-flag path to re-enable diagnosis if a similar Discord.js dispatch issue ever surfaces.

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.
