### Theme: Shapes.inc Fetcher Hardening (multi-item mini-epic)

_Focus: harden the shapes.inc data-fetch path against API drift, bot-protection, and graceful failure — companion to the cookie migration (shipped beta.103)._

Web Claude's companion recommendations to the cookie-migration guide. Each item is individually pickable; bundling avoided (they touch different concerns) and full-rewrite avoided (current design is clean).

**High-value (4 items)**:

1. **Schema-drift canary** — Zod-validate top-level response shapes at each endpoint, log `warn` not `throw` on missing fields so partial exports still complete.
2. **Persist raw JSON alongside typed output** — cheap schema resilience + user-data-portability win (users may need fields we haven't surfaced).
3. **Detect bot-protection** — header-check for `cf-ray`/`cf-mitigated`/`x-px-*`/`x-datadome` + HTML-on-JSON-endpoint, throw a distinct `ShapesBotProtectionError` so the failure mode is obvious vs confusing 403s.
4. **Fallback docs** — README section "If this tool stops working" pointing users to GDPR/CCPA data-access-request rights with a template (fast-path vs legally-guaranteed-slow-path framing).

**Polish (2 items)**:

5. **BullMQ global concurrency cap** (max 2-3 concurrent fetches) — low-and-slow is more ethical + more durable.
6. **Distinct 401 failure modes** — (a) first-request cookie expired, (b) mid-job expiry needing page-resume support (this one bundles a real feature), (c) every-attempt-401 meaning cookie name changed again.

**Recorded constraint (do NOT do)**: no Playwright/Puppeteer/IP rotation/CAPTCHA solving/anti-fingerprinting — shifts project posture from "exercising user rights" to "evading countermeasures," weaker ethically + more fragile.

**Full proposal**: [`docs/proposals/backlog/shapes-inc-fetcher-hardening.md`](../../../docs/proposals/backlog/shapes-inc-fetcher-hardening.md).

**Sequencing**: queue after the cookie migration bake-in period — these items depend on the new cookie path being stable first (beta.103 shipped 2026-04-22; bake for at least one additional release cycle before starting).

Promoted from Inbox 2026-04-22.

#### botasaurus (2026-07-05 ingest)

Python anti-bot scraping framework (custom "humane" browser driver, claims Cloudflare WAF/Turnstile + Datadome bypasses, browser-like TLS in lightweight request mode; active, 5.5k stars). Relevant IF shapes.inc (or future import sources) escalate bot-walling beyond what UA/header tuning handles — heavier dependency (Python) than our current fetcher, so a last-resort option, filed for completeness.
