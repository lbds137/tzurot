# Current

> **Version**: v3.0.0-beta.164 (released 2026-07-13 night) — the HF-outage + voice-close-out day: voice-engine theme CLOSED (#1633 STT wait UX, #1634 parallel TTS chunking), origin-language review enforcement (#1635 rule + merge-gate hook — fired 3× in live use same day), TTS orphan halt (#1636), memory 1b slice 0 fact eval bench (#1637), **HF incident pair** (#1638 vendored embedding model, #1639 voice-engine volume cache — both runtime-verified through prod), docker-build-smoke CI for all four images (#1640). _Prior: beta.163 (2026-07-13 evening)._

---

## Unreleased on Develop

_(empty — reset at beta.164)_

## Next Session Goal

**Next:** **memory 1b critical path** — dev backfill finishing overnight (~90% at close) → run `EVAL_MEMORY_DATABASE_URL=<dev-url> pnpm eval:fact-goldens` (slice 0 bench, #1637) → owner judges `reports/goldens-mining/fact-judgment-sheets.md` (one sitting, ~10-15 facts/turn) → offline weight simulation → slice 1 wires the winner into `findSimilarActiveFacts`. Plan + slices in the plan file (approved 2026-07-13; facts-first, mechanical+judged eval, write-time+retrieval semantic guard, 1a-revival evidence-decides — the 1a verdict is simulable from the EXISTING episode pool via `withRrfArm`, zero re-judging).

**beta.164 smoke (owner, phone-ok)**: one text reply · one voice message (STT + "taking longer" notice if slow) · one long voice reply (parallel chunking). **Prod voice-engine seed**: first wake starts the volume seed (ratchets across wake windows; serverless-toggle warm-up optional — see board § Production Issues, remove entry when prod `model-cache/` lands). **Fix-forward owed**: one-line `expect(dispatchCtx).toBeDefined()` hardening in `TTSStep.test.ts` (release-review nit). Watches: db-sync probes (clean runs accumulating), prod lock-storm, retention-failure, beta.160 holdovers. Fable access through July 19.

## Last Session — the HF outage day (2026-07-13 afternoon→night)

Nine PRs + release. Arc: voice-engine theme closed → owner flagged my "pre-existing" hand-waves → enforcement shipped (#1635) and immediately demanded its first real fix (#1636, where the reviewer then caught MY dropped-signal seam bug — fails-pre-fix regression test added). 1b slice 0 (#1637) hit a red component job → diagnosed as HuggingFace killing anonymous downloads platform-wide → embedding model vendored in-repo (#1638, sha-verified, `modelSource="local"` confirmed in dev AND prod deploys) → voice-engine's identical exposure fixed via volume-persisted model caches (#1639; dev seed VERIFIED: 2.6GB on volume, <1min cache-hit boot) → Dockerfile smoke CI (#1640, all four images proof-built). Honest ledger: reviewer caught my temporal-markers violation in my own ci.yml comment; my HEAD-probe "works from here" and "froze indefinitely" claims were both wrong (content-GET and throttled-crawl were the truths); the owner's watch-path and sleeping-container corrections both beat my model of Railway. Key learnings operationalized: origin-language gate (rule+hook), `railway redeploy` linked-env gotcha (follow-ups), serverless idle policy kills long boots (volume cache makes seeds monotonic).

_Older session logs live in git history._
