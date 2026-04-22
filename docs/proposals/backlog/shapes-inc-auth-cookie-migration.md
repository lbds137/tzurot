# Shapes.inc auth cookie migration — Auth0 → Better Auth

> **Status**: Proposal, not started. Produced by web Claude 2026-04-22 on request ("revisit the Shapes.inc question").
>
> **Scope**: Cookie identity and parsing only. No business logic changes.
>
> **Trigger**: shapes.inc has migrated its auth library from `@auth0/nextjs-auth0` to [Better Auth](https://better-auth.com/). Our `ShapesDataFetcher` reassembles a 3-part rolling `appSession` pair that no longer exists.
>
> **Backlog entry**: see 📥 Inbox in `BACKLOG.md`.

---

## Context

shapes.inc has migrated its authentication library from `@auth0/nextjs-auth0` to [Better Auth](https://better-auth.com/). The JSON data endpoints (`/api/shapes/username/{slug}`, `/api/memory/{shapeId}`, `/api/shapes/{shapeId}/story`, `/api/shapes/{shapeId}/user`) are **unchanged** in their paths, request/response shapes, auth model (cookie-based), HTTP status code semantics, and rate-limiting behavior. Only the session cookie itself has changed.

**Important:** do not change any business logic, retry logic, pagination, timeouts, rate limiting, or error classes. The scope of this task is _cookie identity and parsing only_.

## What changed

| Aspect                    | Old (Auth0)                                                                 | New (Better Auth)                                                                               |
| ------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Session cookie(s)         | `appSession`, `appSession.0`, `appSession.1` (split rolling pair, httpOnly) | `__Secure-better-auth.session_token` (single, httpOnly, `__Secure-` prefix)                     |
| Cookie count              | Up to 3 that must be reassembled                                            | Exactly 1                                                                                       |
| Rotation frequency        | Every request                                                               | Rare (Better Auth rotates only within its `updateAge` window, default 1 day of a 7-day session) |
| Auth mount point          | `/api/auth/*`                                                               | `/api/auth/*` (unchanged path; library swap is invisible to scrapers)                           |
| `Set-Cookie` on responses | Always present                                                              | Occasional                                                                                      |
| HTTPS required            | No (but recommended)                                                        | **Yes** — the `__Secure-` prefix forbids the cookie being sent over plain HTTP                  |

The `__Secure-` prefix is a browser-enforced rule: the cookie will only be set/sent on HTTPS origins. This is already the case for our traffic (`SHAPES_BASE_URL` uses `https://`) but worth noting for local testing and any future dev proxies.

## Files to change

1. `services/ai-worker/src/services/shapes/shapesCookieParser.ts` — **primary changes**
2. `services/ai-worker/src/services/shapes/ShapesDataFetcher.ts` — comment/docstring updates, minor
3. Any tests for `shapesCookieParser` — update fixtures to match new cookie name
4. Any developer-facing docs (README, onboarding notes) that explain how to harvest the session cookie from a browser

## Cookie name to recognize

The only cookie that carries authentication is exactly this name (case-sensitive, including the `__Secure-` prefix and the literal dot between `better-auth` and `session_token`):

```
__Secure-better-auth.session_token
```

The value is an opaque Better Auth session token. Do not attempt to parse, decode, verify, or introspect its contents — treat it as an opaque string and forward it verbatim.

## Changes to `shapesCookieParser.ts`

Replace the Auth0-specific split-cookie reassembly with single-cookie handling. Keep the function signature stable so `ShapesDataFetcher.executeSingleRequest` does not need to change. Specifically:

1. Define a constant for the cookie name:

   ```ts
   export const SHAPES_SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';
   ```

2. `updateCookieFromResponse(currentCookie: string, response: Response): string` should:
   - Read all `Set-Cookie` headers from the response (use `response.headers.getSetCookie()` in Node 20+; fall back to a `raw()` or header-iteration helper if your runtime predates that — undici supports `getSetCookie` natively).
   - Find the entry whose name is exactly `SHAPES_SESSION_COOKIE_NAME`.
   - If found, extract the `name=value` pair (ignoring attributes like `Path`, `Expires`, `HttpOnly`, `Secure`, `SameSite`) and return a new cookie string containing just `__Secure-better-auth.session_token=<new_value>`.
   - If not found (which is the common case for Better Auth, since rotation is rare), return `currentCookie` unchanged.
   - Do **not** retain any other cookies from the response. Better Auth doesn't need them, and mixing unrelated cookies into the jar adds risk (e.g., CSRF cookies being echoed back on an endpoint that rejects them).

3. Drop any code paths that match `appSession`, `appSession.0`, `appSession.1`. Don't leave them as a fallback — the Auth0 system is no longer in production, and leaving dead branches is a source of confusion when the next migration happens.

4. Export a small helper for constructing the initial cookie string from a harvested value, so callers don't have to know the prefix format:

   ```ts
   export function buildSessionCookie(tokenValue: string): string {
     return `${SHAPES_SESSION_COOKIE_NAME}=${tokenValue}`;
   }
   ```

## Changes to `ShapesDataFetcher.ts`

Only comment/documentation changes are needed. No behavioral changes.

1. The file's top-level JSDoc block currently describes behavior that included "Stateful cookie management (shapes.inc rotates cookies on each request)". Update this bullet to read: "Stateful cookie management (shapes.inc occasionally rotates the Better Auth session cookie; the jar is refreshed when a `Set-Cookie` header is present on a response)."

2. The `FetchOptions.sessionCookie` JSDoc comment currently reads: `"Initial session cookie (full cookie string with both appSession parts)"`. Replace with: `"Initial session cookie string in the form '__Secure-better-auth.session_token=<value>'. Harvest this from an authenticated browser session on https://shapes.inc/dashboard by copying the httpOnly cookie of that name from DevTools → Application → Cookies."`

3. No changes to `executeSingleRequest`, `makeRequest`, `isRetryableError`, `fetchShapeConfig`, `fetchAllMemories`, `fetchStories`, `fetchUserPersonalization`, retry backoff, delays, or error class usage.

## Tests

If `shapesCookieParser` has unit tests:

- Remove or rewrite any test that constructs a three-part `appSession` fixture.
- Add a test where the response has a `Set-Cookie: __Secure-better-auth.session_token=NEWVALUE; Path=/; HttpOnly; Secure; SameSite=Lax` and assert the returned jar is exactly `__Secure-better-auth.session_token=NEWVALUE`.
- Add a test where the response has _no_ `Set-Cookie` and assert the jar is returned unchanged.
- Add a test where the response has unrelated `Set-Cookie` entries (e.g., analytics cookies) and assert they are discarded.
- Add a test where the response has _both_ an unrelated cookie and the Better Auth cookie and assert only the Better Auth one is retained.

## Developer documentation

Wherever the repo currently instructs a developer or end-user how to obtain a session cookie (likely a README or onboarding doc under `services/ai-worker` or `docs/`), rewrite the instructions to:

1. Open `https://shapes.inc/dashboard` in a browser and sign in.
2. Open DevTools → Application → Cookies → `https://shapes.inc`.
3. Locate the cookie named `__Secure-better-auth.session_token` (it will have the HttpOnly column checked; sort by that column to find it quickly if there are many cookies from analytics providers).
4. Copy its value.
5. Supply it to the worker as `__Secure-better-auth.session_token=<value>` in whichever env var / secret the worker reads.

Explicitly mention that the `talk.shapes.inc` subdomain is a separate chat application with its own auth instance and its own cookie, and is **not** a valid source for a fetcher session — it will not authenticate against the `shapes.inc` data API.

## Validation

After making the changes, a successful run against a known-good shape should still log lines like:

```
Starting data fetch
Config fetched, starting data collection
Memory page fetched { page: 1, count: 20, total: 20, hasNext: true }
...
Data fetch complete
```

The only observable behavioral difference will be that "cookie was updated from response" log lines (if any exist) will fire dramatically less often than under the old Auth0 regime.

## Out of scope

- Do not add bearer-token auth, API-key auth, or any OAuth client code. Better Auth supports those via plugins but shapes.inc has not enabled them; the endpoints still reject `Authorization` headers and accept only the session cookie.
- Do not add CSRF token handling. The data endpoints are GET-only and not guarded by CSRF.
- Do not change `SHAPES_BASE_URL` or any endpoint path constants.
- Do not change retry/backoff/timeout constants.
