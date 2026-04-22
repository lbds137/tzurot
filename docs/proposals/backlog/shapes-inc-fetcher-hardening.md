# Shapes.inc fetcher hardening — adjacent robustness work

> **Status**: Proposal, not started. Produced by web Claude 2026-04-22 alongside the cookie migration guide.
>
> **Scope**: Six concrete hardening items adjacent to but **separate from** the [cookie migration](shapes-inc-auth-cookie-migration.md). These are defenses against the _next_ thing shapes.inc changes, not the current cookie-scheme cutover.
>
> **Priority framing**: web Claude's categorization — items 1-4 are high-value, items 5-6 are polish.
>
> **Backlog entry**: see 📥 Inbox in `BACKLOG.md`.

---

## 1. Schema-drift canary (high-value)

Right now if shapes.inc renames a field in the config/memory/story/user JSON — say, `user_prompt` → `system_prompt`, or the `memories` array is restructured — the fetcher will silently succeed with partial data, and users won't know their export is incomplete until they try to use it.

**Fix**: validate the top-level response shape at each endpoint using Zod (or whatever validation lib is already in the repo) and log a `warn` if any expected field is missing, rather than a `throw`.

**Why warn and not throw**: you want the export to still _complete_ with whatever data is available — partial data is better than no data when you're racing against a platform that might lock things down further. The canary's job is just to tell you the contract drifted so you can update the types.

## 2. Persist raw JSON alongside typed output (high-value)

If you're not already doing this, have the fetcher write the raw HTTP response bodies to disk (or object storage) in addition to the typed/parsed `ShapesDataFetchResult`. Two reasons:

1. **Schema resilience**: if the schema drifts and your parsing loses fields, the raw JSON still has them and can be re-parsed later.
2. **User data portability**: users who want to roundtrip their data into some _other_ AI platform will likely need fields you don't currently surface in your typed interfaces.

Keeping the raw payload is cheap insurance and aligns with the "give users their data" principle — you're not deciding for them which fields matter.

## 3. Detect bot-protection and fail loudly (high-value)

Add a response-header check in `executeSingleRequest` that looks for:

- Cloudflare: `cf-ray`, `cf-mitigated`
- PerimeterX: `x-px-*`
- Datadome: `x-datadome`
- HTML content-type on what should be a JSON endpoint

If any of those appear, throw a distinct `ShapesBotProtectionError` with a clear message like:

> "shapes.inc appears to have added bot-detection middleware; the session-cookie scraping path may no longer be viable."

This makes the failure mode obvious to users rather than showing up as confusing 403s or HTML-as-JSON parse errors. It's also useful telemetry: the day this error starts firing is the day you need to decide on a next move.

## 4. Document the fallback to official data requests (high-value)

In the project's README or user-facing docs, include a short section titled something like "If this tool stops working" that tells users plainly:

- They have data portability rights under GDPR (EU) and CCPA (California)
- They can submit a formal data access request directly to shapes.inc
- Here's a template for doing so

Given the automod history, many shapes.inc users genuinely don't know this option exists. The tool being the "fast path" and the formal request being the "slow but legally guaranteed path" is a healthy framing, and it means the project keeps being useful to users even in the scenario where the scraper eventually gets patched out of existence.

## 5. Rate-limit etiquette (polish — shared infrastructure concern)

There's already a 1-second delay between requests, which is good. One thing worth adding: a cap on total concurrent exports if multiple users trigger jobs simultaneously.

Better Auth session cookies are per-user, so in principle each user's job is independent, but if many users export at once you'd create a thundering herd from a single egress IP that shapes.inc might start rate-limiting.

**Fix**: a BullMQ concurrency cap (e.g., max 2-3 concurrent shape fetches globally) keeps the aggregate footprint small and reduces the chance of drawing attention that leads to hardening.

This operates in a gray zone; low-and-slow is both more ethical to the platform's other users and more durable for yours.

## 6. Session cookie lifecycle UX (polish)

Better Auth sessions last ~7 days by default. The worker should distinguish between three failure modes and surface distinct error messages for each:

- **(a) 401 on the _first_ request of a job** — the user's harvested cookie was already expired/invalid before the job started. Tell them to re-harvest.
- **(b) 401 _mid-job_ after N successful pages** — the cookie expired during the job, which is rare on a 7-day session but possible for long-running exports. The worker should surface exactly which page number failed so a re-harvest + resume is possible without re-fetching the 400 pages you already got.
- **(c) 401 on _every_ attempt even with a fresh cookie** — likely means the cookie name changed again (next migration), which is the case that warrants human investigation.

These three cases having distinct error messages will save a lot of support pain. Note that (b) implies a resume-from-page feature that may not exist today — this item bundles UX + a real feature addition.

## Non-goals (constraint — do NOT implement)

**Do not add browser automation (Playwright, Puppeteer), IP rotation, CAPTCHA solving, or anti-fingerprinting.** Beyond the engineering cost, those shift the project's posture from "giving users a tool to exercise rights they already have" to "evading countermeasures," which is both a weaker ethical footing and a much more fragile arms race.

The current design — user harvests their own cookie from their own logged-in session, worker uses it on their behalf — is clean and defensible. Keep it that way.

This is a recorded constraint for any future session tempted to automate the harvest path. If you find yourself reading this and thinking "but we could just use Playwright to automate step 1" — don't. Read this section again.
