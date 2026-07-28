---
id: doc-41
title: 'Idea: Pool-era erasure semantics (must precede Phase-3 pools)'
type: other
created_date: '2026-07-28 11:11'
---

## Pool-era erasure semantics (must precede Phase-3 pools)

Account deletion (PR-B) erases the user's private-pool world: persona-scoped rows cascade, owned characters die for everyone, facts about the user are tag-swept across scopes, and NULL-persona rows are a documented no-op (nothing writes them today). Community and canon pools (memory epic Phase 3) break every one of those assumptions: pool rows are deliberately multi-user, so "delete my account" needs defined semantics — remove my contributions? anonymize my sender attribution? leave communal content owned by the pool? The consent design for pool WRITES (per-user opt-in) must pair with an erasure design for pool DELETES. **Gate**: define these semantics (and extend `AccountDeletionService` + the zero-residue test) BEFORE the first pool-writing extraction ships — retrofitting erasure onto an already-populated communal pool is the expensive order. Surfaced 2026-07-15 (PR-B design D6).

