## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### Security Audit Pass 2026-05-21 — findings

Discovery-only pass against api-gateway + bot-client + ai-worker. Categories per [`future-themes.md`](future-themes.md) "Security Audit Pass" theme: (a) unauth resource consumption, (b) authz escalation, (c) DoS amplification, (d) input validation, (e) secret leakage. Negative findings recorded below the actionable list.

#### MEDIUM

- **[MEDIUM:b] 6 of 12 admin routes missing `requireOwnerAuth` (defense-in-depth inconsistency)** — `services/api-gateway/src/routes/admin/{denylist,diagnostic,llm-config,stopSequences,tts-config,usage}.ts`. The other 6 admin routes (`cleanup`, `createPersonality`, `dbSync`, `invalidateCache`, `settings`, `updatePersonality`) apply `requireOwnerAuth()` per-route; these 6 do not. All admin routes ARE protected by global `requireServiceAuth()` (verified `index.ts:258` precedes the `/admin` mount at `:308`), so the threat model is **post-`INTERNAL_SERVICE_SECRET`-compromise**: any service holding the secret can mutate bot-wide LLM/TTS config, add/remove denylist entries, read LLM diagnostic logs (potentially PII), and read per-user usage stats. Not exploitable from outside the cluster. **Fix shape**: add `requireOwnerAuth()` to the 6 missing routes; either at the per-route handler (matches existing pattern in the other 6) or hoist to `createAdminRouter` via `router.use(requireOwnerAuth())` after the existing service-auth guard. Apply to GET endpoints too where they leak diagnostic content / PII (diagnostic, usage). ~30-50 LOC + test updates. Surfaced 2026-05-21 by security-audit discovery pass.

- **[MEDIUM:c] `PendingMemoryProcessor.getStats()` does unbounded `findMany`** — `services/ai-worker/src/jobs/PendingMemoryProcessor.ts:161`. The `getStats()` method pulls ALL rows from `pendingMemory` to compute an attempt-count histogram in JS. The other `findMany` in the same file (`:75`) has `take: 100`. During a stuck-job incident the table could grow large enough to spike memory on the stats call. **Fix shape**: replace with `prisma.pendingMemory.groupBy({ by: ['attempts'], _count: true })` at the DB layer. ~5 LOC change + test. Surfaced 2026-05-21 by security-audit discovery pass.

#### LOW

- **[LOW:c] 4 unbounded user-scoped `findMany` calls (defense-in-depth)** — `routes/user/channel/list.ts:48` (settingsList), `routes/user/tts-override.ts:76` (overrides), `routes/user/model-override.ts:77` (overrides), `routes/wallet/listKeys.ts:37` (keys). Each query is bounded in practice by "things-this-user-owns" (~100 max realistically), but lacks explicit `take:`. This violates the `03-database.md` "All `findMany` MUST have `take` limit" rule. A pathological account with thousands of override rows (or a future schema change adding bulk-create paths) could blow the response. **Fix shape**: add `take: 100` (or appropriate cap) to each. ~4 one-line edits. Surfaced 2026-05-21 by security-audit discovery pass.

- **[LOW:e] Username PII in debug log** — `services/ai-worker/src/services/UserReferenceResolver.ts:52`. `logger.debug({ ...logContext, fallbackName }, 'No mapping found, falling back to username')`. `fallbackName` is a Discord display name; `00-critical.md` "NEVER log: usernames" applies even at debug level. Production logs filter debug out, so the risk is dev-environment leakage during local debugging. **Fix shape**: drop `fallbackName` from the log fields, or replace with a SHA-256 prefix hash. ~1-line. Surfaced 2026-05-21 by security-audit discovery pass.

#### Negative findings (audit certifies clean)

- **Command injection**: no `execSync(\`...${var}...\`)`patterns found across services.`execFileSync` discipline holding.
- **SSRF via URL interpolation**: every dynamic URL segment in api-gateway/bot-client uses `encodeURIComponent` (verified `deny/detail.ts:210`, `deny/detailEdit.ts:184` use `.map(encodeURIComponent)` before `segments.join('/')`).
- **HTML/XML regex sanitization (CodeQL pattern)**: no `replace(/<[^>]+>/g, ...)` patterns found. `extractXmlTextContent` via `fast-xml-parser` discipline holding.
- **Secret leakage in route responses**: `wallet/listKeys.ts:37` correctly `select`s only metadata fields, never `apiKeyEncrypted`.
- **Helmet/CORS coverage**: globally applied with per-route CORP opt-outs for `/avatars` and `/voice-references` (verified `index.ts:415-418`).
- **Service-auth coverage**: every route mounted after `index.ts:258` requires `INTERNAL_SERVICE_SECRET` — `/models`, `/ai`, `/wallet`, `/user`, `/internal`, `/admin`, `/metrics`, `/voice-references`. Only `/health`, `/avatars`, `/exports` are public.
- **depcruise boundary violations**: 1655 modules / 5015 dependencies cruised, 0 violations.
- **Bounded findMany discipline**: 19 of 23 user/admin/ai-worker `findMany` calls have explicit `take:` (the 4 missing ones are the LOW-severity item above).

**Audit method**: greppable-pattern sweep + auth-middleware coverage check + manual spot-verification of an Explore-agent walk. Agent surfaced one CRITICAL claim ("`/models` mounted before requireServiceAuth") that was wrong — actual code has `/models` at `index.ts:302`, AFTER service-auth at `:258`. Verification-before-incorporation per the `feedback_verify_reviewer_claims` memory caught it.
