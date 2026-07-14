# Current

> **Version**: v3.0.0-beta.165 (released 2026-07-14) — the memory-epic must-fix release: **STM/LTM dedup hole closed** (#1645 — history-first allocation, exact shipped boundary, ID-authoritative dedup filter; epic review item 8 SHIPPED), multi-tag deploy-orphan wedge fixes (#1642 — safety-flush re-poll, original-deadline re-arm, TTS audio TTL), fact `valid_from` = evidence time (#1644 — 1b redirect slice A), committed 1b weight-sim runner (#1643). Release review: LGTM, zero blocking. _Prior: beta.164 (2026-07-13 night — HF outage + voice close-out day)._

---

## Unreleased on Develop

- **#1647** `fix`: BullMQ worker lock 20min→5min — deploy-killed jobs stall-recover in ~6 min (real replies) instead of wedging to the 18-min flush. `MAX_JOB_RUNTIME` decouple keeps the job-timeout clamp at 20 min; `stalled`-event logging added (the deploy-orphan recovery trail). Runtime proof: first prod deploy that catches an in-flight job. Closes wedge sub-question (b).

## Next Session Goal (sequenced — fresh session starts here)

1. ~~**Prod fact-timestamp repair (the #1644 release step)**~~ ✅ **DONE 2026-07-14 (owner-approved)** — 21,493 facts rewound to evidence time (12,588 were >6mo skewed — the backfill signature); post-run dry-run confirms 0 remaining. Release checklist closed.
2. **beta.165 smoke (risk-derived, three items)** — (a) one normal reply in a long-history channel (#1645 pre-pass main path), (b) one recall probe about something old (proves the dedup-hole fix surfaces past-truncation content and isn't over-filtering), (c) one multi-tag message (#1642 coordinator touch). Owner drives; results land here.
3. **1b next**: slice B (read-side dup collapse) is recommendation-DON'T-BUILD pending the owner's felt-repetition re-measure now that slice A + the dedup-hole fix are in prod; correction detection and the other redirect deferrals sit in `cold/follow-ups.md` with promote-when triggers. Nothing to build until the re-measure speaks.

**Watches**: first prod extraction log post-beta.165 (`valid_from` should stamp source time, not run time) · first deploy-orphan/safety-flush event (#1642 runtime proof — `remainingBudgetMs` + "found a real job outcome" lines) · owner's felt-repetition re-measure (gates 1b slice B + correction detection) · prod voice-engine volume seed (first wakes ratchet it; remove the board's HF entry when prod `model-cache/` lands — check via `railway ssh -s voice-engine -e production` while awake) · db-sync probes (clean runs accumulating) · prod lock-storm · retention-failure. **beta.164 voice smoke still open**: one voice message + one long voice reply when convenient. Fable access through July 19.

## Last Session — the dedup-hole + release day (2026-07-14)

Release v3.0.0-beta.165 cut and shipped (4 substantive PRs: #1642, #1643, #1644, #1645). Arc: round-4 fixup on #1645 (createdAt string normalization — my round-1 "fails safe" dismissal was wrong; the reviewer's reframe as silent memory-drop was right and the owner approved the fix) → merged → release PR #1646 (holistic review LGTM, zero blocking; praised the real-ContextWindowManager invariant test) → finalize + publish → prod repair dry-run (21,493 rows) with execution pending owner go. The dedup hole was the epic's architectural must-fix (external review item 8): resolved by restructuring the sequence — history-first pre-pass, exact shipped boundary, ID-authoritative filter. Release-review tie-boundary nit filed in `cold/follow-ups.md`.

_Older session logs live in git history._
