# Current

> **Version**: v3.0.0-beta.164 (released 2026-07-13 night) — the HF-outage + voice-close-out day: voice-engine theme CLOSED (#1633 STT wait UX, #1634 parallel TTS chunking), origin-language review enforcement (#1635 rule + merge-gate hook — fired 3× in live use same day), TTS orphan halt (#1636), memory 1b slice 0 fact eval bench (#1637), **HF incident pair** (#1638 vendored embedding model, #1639 voice-engine volume cache — both runtime-verified through prod), docker-build-smoke CI for all four images (#1640). _Prior: beta.163 (2026-07-13 evening)._

---

## Unreleased on Develop

_(empty — reset at beta.164)_

## Next Session Goal (sequenced — fresh session starts here)

1. **Backfill pace check FIRST** (gates everything 1b): pace collapsed ~5× around 20:30 ET 2026-07-13 and stayed slow (~33 episodes/30min, ~3.7k of 35.3k remaining ≈ days at this rate; z.ai call RATE dropped, tokens/call normal → provider latency or pacing, NOT this machine). Also: no local backfill process visible in `ps` — it may be BullMQ-hosted on dev ai-worker (fits redeploy-survival via Redis queue). Find where it actually runs, why it slowed, whether to kick it. Monitor died with the old session — re-arm a 30-min DB-stats watch if useful.
2. **Rehydration-wedge fixes (a)+(c), one small PR** — board § Production Issues entry (filed 2026-07-14) has the full trail + fix shapes: (a) re-poll BullMQ job state at multi-tag REHYDRATION (dead job → flush now, not +18min), (c) `tts-audio:` TTL 300s → outlive the 18-min safety window. Sub-question (b) — why BullMQ never stalled-recovered the deploy-killed job — is investigation, can trail. Ride-along: `expect(dispatchCtx).toBeDefined()` in `TTSStep.test.ts` (release-review nit, follow-ups row).
3. **1b critical path** (once backfill completes): `EVAL_MEMORY_DATABASE_URL=<dev-url> pnpm eval:fact-goldens` → owner judges `reports/goldens-mining/fact-judgment-sheets.md` (one sitting) → offline weight sim → slice 1 wires winner into `findSimilarActiveFacts`. Approved plan + slices in the plan file (facts-first; 1a verdict simulable from the EXISTING episode pool via `withRrfArm`, zero re-judging).

**Watches**: prod voice-engine volume seed (first wakes ratchet it; remove the board's HF entry when prod `model-cache/` lands — check via `railway ssh -s voice-engine -e production` while awake) · db-sync probes (clean runs accumulating) · prod lock-storm · retention-failure · beta.160 holdovers. **beta.164 smoke**: owner's 3-message test already ran (and caught the wedge bug); voice delivery still unverified end-to-end — one voice message + one long voice reply when convenient. Fable access through July 19.

## Last Session — the HF outage day (2026-07-13 afternoon→night)

Nine PRs + release. Arc: voice-engine theme closed → owner flagged my "pre-existing" hand-waves → enforcement shipped (#1635) and immediately demanded its first real fix (#1636, where the reviewer then caught MY dropped-signal seam bug — fails-pre-fix regression test added). 1b slice 0 (#1637) hit a red component job → diagnosed as HuggingFace killing anonymous downloads platform-wide → embedding model vendored in-repo (#1638, sha-verified, `modelSource="local"` confirmed in dev AND prod deploys) → voice-engine's identical exposure fixed via volume-persisted model caches (#1639; dev seed VERIFIED: 2.6GB on volume, <1min cache-hit boot) → Dockerfile smoke CI (#1640, all four images proof-built). Honest ledger: reviewer caught my temporal-markers violation in my own ci.yml comment; my HEAD-probe "works from here" and "froze indefinitely" claims were both wrong (content-GET and throttled-crawl were the truths); the owner's watch-path and sleeping-container corrections both beat my model of Railway. Key learnings operationalized: origin-language gate (rule+hook), `railway redeploy` linked-env gotcha (follow-ups), serverless idle policy kills long boots (volume cache makes seeds monotonic).

_Older session logs live in git history._
