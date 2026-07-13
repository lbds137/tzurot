# Shapes.inc Import & Export

Tzurot can import a character (personality config, memories, stories, user
personalization) from [shapes.inc](https://shapes.inc), or export that data as
a JSON/Markdown file you keep. The tool exists so shapes.inc users can exercise
data-portability rights they already have — you harvest a session cookie from
your own logged-in browser session, and the worker uses it on your behalf.

## How it works

1. `/shapes auth` — store your shapes.inc session cookie (harvested from
   DevTools → Application → Cookies on a logged-in shapes.inc tab; the cookie
   is encrypted at rest).
2. `/shapes import` or `/shapes export` — an async job fetches your shape's
   config, memories (paginated), stories, and user personalization.
3. Exports land as a downloadable file. The **JSON export is the raw API
   payload** — every field shapes.inc returned is preserved, including fields
   Tzurot doesn't surface, so you can round-trip your data into other tools.

The fetcher is deliberately polite: 1 second between requests, a global cap on
simultaneous fetch jobs, and no browser automation, IP rotation, or
CAPTCHA-solving of any kind. That last part is a project constraint, not a
missing feature: the clean posture is "a user exercising rights over their own
data from their own session," and it stays that way.

## If this tool stops working

shapes.inc periodically changes cookie names, response shapes, or fronting
infrastructure. The fetcher detects and names these failures (schema-drift
warnings, a distinct bot-protection error, phase-aware cookie-expiry
messages), but the day may come when the session-cookie path is no longer
viable at all.

You still have options — the tool is the _fast path_, not the only path:

- **You have data-portability rights.** Under the GDPR (EU — Articles 15 and 20) and the CCPA/CPRA (California), you can compel a service to hand over
  the personal data it holds on you in a usable format. Many other
  jurisdictions have equivalents. These requests are slower than the tool
  (companies typically have 30–45 days to respond) but they are legally
  backed and do not depend on any cookie scheme.
- **Submit a formal data access request directly to shapes.inc** (their
  support/privacy contact). A template:

  > Subject: Data Access / Portability Request
  >
  > I am a user of shapes.inc (account: [your username / email]). Under
  > applicable data-protection law (including, where applicable, GDPR
  > Articles 15 and 20 and/or the CCPA), I request a complete copy of the
  > personal data associated with my account, including character
  > configurations, stored memories/conversation summaries, stories, and
  > personalization data, in a structured, commonly used, machine-readable
  > format (JSON preferred).
  >
  > Please confirm receipt of this request and provide the data within the
  > statutory response period.

- If a response never comes, the escalation path is your local data-protection
  authority (EU) or state attorney general (California).

## Failure modes you might see

| Error message mentions…                    | What it means                                                                                               | What to do                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| "on the FIRST request"                     | Your stored cookie was expired before the job started                                                       | Re-harvest the cookie, `/shapes auth` again                                    |
| "expired mid-job" (with a page number)     | The session died partway through a long export                                                              | Re-harvest and re-run; the job restarts from the beginning                     |
| "bot-detection middleware"                 | shapes.inc added active bot protection (Cloudflare mitigation, Datadome, PerimeterX, or an HTML block page) | Retrying won't help — report it; the formal data request above is the fallback |
| "Too many simultaneous shapes.inc fetches" | The global politeness cap is busy                                                                           | Nothing — the job retries by itself                                            |
