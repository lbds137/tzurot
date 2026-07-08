# Current

> **Version**: v3.0.0-beta.155 (released 2026-07-08) — **UX Phase 1**: honest-outcome message layer (`ux/catalog` + `ux/render` + total gateway-failure classifier) swept across the entire bot-client command tree (raw literals 448 → 92); writes that time out now say "may still be applying" instead of a false "try again"; multi-tag all-errored delivers each character's error in its own voice (errored speak, denied silent). Prod fixes rode along: 429-storm-masked-as-timeout retarget bypass (#1556), first-z.ai-fallback footer (#1553). 10-PR train #1550–1561; residual 92 literals = documented exemptions (embed titles/status-glyphs, diagnostic surfaces). Holistic review: "no blocking issues." _Prior: beta.154 (2026-07-07, character-definition privacy)._

---

## Unreleased on Develop

- Nothing — beta.155 shipped the full UX Phase 1 train + both prod fixes; develop is SHA-aligned with main.
- **Memory Phase 1a remains PARKED** on `feat/memory-hybrid-retrieval` (evidence gate: real-scale goldens).

## Next Session Goal

UX Phase 1 shipped. Prod is the soak for the two runtime-unverified paths — **multi-tag all-errored delivery** and the **`maxRetries:0` retry-timing change** — both log-observable if they misbehave.

**Open follow-ups from Phase 1** (all in `cold/follow-ups.md` with promote-when triggers): system-voice straggler wording (STT / MessageHandler top-catch / truncation notices), partial-failure errored-slot delivery, admin/kick `serverId` escaping, `deletePersona`/`getCachedPersonalities` wrapper widening, `maxRetries:0` metrics watch.

**Next design/build candidates** (nine accepted artifacts on the books — `docs/proposals/backlog/`): memory Phase 1a (hybrid retrieval, eval-harness-gated), agentic contract-suite prerequisite, profiles Phase 0 (tier-aware quota fallback — closes the live BYOK-dumped-to-error gap), config-cascade Phase 0, or the mechanical queue below. UX Phase 2 later absorbs privacy-epic Part 2 (view/browse unification) + browse isAdmin follow-ups.

**Mechanical work queue (Opus-suitable — build-sized, decisions already written down):**

1. **Stryker per-package expansion** — recipe in the deterministic-test-quality theme; order: conversation-history → identity → cache-invalidation → clients (services need the viability measurement first).
2. **Job-payload contract suite** (agentic prerequisite) — every context shape → job-chain → worker consumption; consider fast-check.
3. **CPD campaign 1** (`LlmConfigService` ↔ `TtsConfigService`) — council pass first, then extraction under the 2-callback ceiling.
4. **Database-performance-audit Phase 1** (prevention-rule PR) — cheap, marked NEXT in its theme.
5. **shapes-inc fetcher hardening** — 6 small well-specified items.
6. **LLM legacy-column retirement (Phase A DROP + Phase B)** — both destructive-migration-bearing (`release:premigrate --allow-destructive`); a focused moment, not a filler slot.
7. **Follow-ups table sweep** — oldest rows (aging escalates; `pnpm ops backlog` surfaces them).

## Last Session — UX Phase 1 + beta.155 (2026-07-07 → 07-08)

10-PR train (#1550–1561) built the `ux/catalog`/`ux/render` honest-outcome message layer and swept it across the whole bot-client command tree (ratchet 448 → 92, -79%), finishing with PR-E's in-character multi-tag error delivery (SlotOutcome discriminated union + `deliverErrorNoPersist` + shared `buildSyntheticErrorResult`). Two prod bugs fixed en route: 429-storm-masked-as-timeout (#1556 — cause-over-symptom retry + `maxRetries:0`) and the first-z.ai-fallback footer (#1553). Shipped as beta.155; develop finalized onto main. Process lessons that stuck by the later slices: sweep a bug CLASS across the file family in one round (not per-instance); run the grep that PROVES a completeness claim before writing it; ask read-vs-write at every converted catch.

_Older session logs live in git history (this file previously carried the 2026-07-03 handoff-refit and beta.146 entries + the full boulder-agenda wall — all shipped/accepted; the artifacts in `docs/proposals/backlog/` are the durable record)._
