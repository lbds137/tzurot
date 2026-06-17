### Theme: Enforce "Human Users Only" at Auth Middleware

_Focus: middleware-level invariant that rejects bot-user HTTP requests, moving the guarantee from code convention to structural enforcement._

PR #807 removed the 400-for-bot branch from api-gateway HTTP routes (NSFW verify, timezone, wallet, config-overrides, shapes auth/import/export, model-override, personality-config-overrides, llm-config) on the rationale that "HTTP routes aren't bot-accessible in practice — bots don't authenticate via session/discordId." That assumption holds today because Discord OAuth → session cookie only issues sessions to real Discord users.

**Risk**: if a future auth mode ever allows bot accounts (service-to-service JWT for third-party integrations, machine-user API keys, OAuth app-installation flow, etc.), the bot-user path is gone from all those routes and would silently provision shell users for bot Discord IDs.

**Fix shape**: add an `isBotUser` check to `requireUserAuth` middleware in `services/api-gateway/src/services/AuthMiddleware.ts` that rejects session subjects marked as bots before any route handler runs. Moves the guarantee from "code convention" to "middleware invariant" — route handlers no longer need to care about the distinction. Cost: one check per request, applied uniformly.

**Surfaced by**: PR #812 release reviewer observation F.

**Start**: `services/api-gateway/src/services/AuthMiddleware.ts`; check how session data encodes bot status (likely not at all yet since current Discord OAuth doesn't issue sessions to bots — may need to add that field); add rejection test case.
