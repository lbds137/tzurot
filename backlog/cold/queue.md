## Theme Queue

_Ordered index of future themes. Grep-on-demand — not loaded at session start. Each references its tracker doc — view with `pnpm tracker doc view <id>`; search with `pnpm tracker doc search <query>`._

> **⚖️ ROADMAP RATIFIED 2026-08-31 (owner call, do not re-derive)** — three phases, quality-first by explicit owner lean ("rock solid before exciting but complex features"):
>
> - **Phase A — Rock Solid**: drain is the official active epic; mutation-floor tranches (TASK-816); the v2 Phase-0 disposition matrix → legacy-folder deletion (the matrix is read-only, so it does NOT violate the UX-surface pause); **Observability (doc-12) closes Phase A and is THE GATE for Phase C** — telemetry before autonomous spend (owner ratified the gate framing 2026-08-31; doc-12's old anchor, the beta-exit gate, dissolved when beta-exit was deprioritized).
> - **Phase B — Finish the half-done**: caching Phase 2 (BEFORE memory re-entry — both restructure prompt/history assembly, one at a time) · UX waves 4–6 (un-pauses v2 parity BUILDS) · memory epic re-entry (LID pilot; gated on the owner's felt-repetition re-measure, pending since July) · doc-75 Phase 1 (a correctness bug wearing a feature costume — may ride earlier as a fix).
> - **Phase C — Gated features**: agentic scaffolding (gate: doc-12 + its own Phase-0 contract suite) · knowledge store (doc-88, consumes memory-epic retrieval learnings) · character-initiated messages (doc-86; gate: doc-75 + consent design) · memory phases 3–6 (evidence-gated).
> - **Balance mechanism**: ~2 quality/finishing trains : 1 feature train; a themed drain batch rides EVERY train; features are riders-only until their Phase-C gate opens.
> - **Side track (owner-paced, meta not product)**: doc-64 meta-harness spinoff (the reusable Claude-Code enforcement/tooling layer — owner re-raised 2026-08-31) with doc-65 (private brain) as the smaller sibling that can go first; doc-76 backlog browser.
>
> **2026-09-24 re-read (Fable planning pass, owner ruled by AskUserQuestion)**: `doc-12` P0–P1 SHIPPED 2026-08-25/26 (#2222–#2224), so **the Phase C gate is MET** (only its on-demand P2 counters remain); caching Phase 2 SHIPPED and is ON in prod (`6c133831c`), leaving the reading and a Phase 3 decision; `doc-8` is in owner-run rollout. **Active Epic from 2026-09-24: UX Layer waves 4–6 (`doc-14`)**, built on the cloud lane by shape (`doc-108`); the local design thread is `doc-97` Phase 4 slice 2, then `doc-75` Phase 1 → the `doc-86` research pass; `doc-11` waits for the train after. The drain (`doc-7`) stays the standing background unit. Retention & Purge is BUILD-COMPLETE and calendar-only.
>
> Memory System Overhaul remains PARKED → its bullet below; re-entry is Phase B, format = LID pilot, trigger = the owner's felt-repetition re-measure. Pick within phases by dependency + value; each substantial pick deserves a council pass before plan-mode.
>
### Half-finished — epics with shipped work and no slot

_One row per epic whose theme doc has a done step and a not-done step and which holds no slot. Bin: **gated** (a named trigger), **owner** (a decision on the owner queue), **pivoted** (the slot moved on, nothing named the remainder — convert to drain tasks). Written at promotion time (`/tzurot-docs` § Promoting a theme to Active Epic, step 1) and rewritten when a phase ships; the digest prints it (TASK-1090). Built 2026-09-24 from a full read of the theme docs; the prior one-line list named five and missed three._

| Epic | Remainder | Bin | Trigger / disposition |
| --- | --- | --- | --- |
| `doc-27` v2 Parity | parity BUILDS after the Phase 0 matrix | gated | `doc-14` waves 4–6 finish (active since 2026-09-24) |
| `doc-2` Character Portability | Phase 5 sidecar prompt injection | gated | `doc-15` item 2 (the cascade pattern) |
| `doc-11` Agentic scaffolding | everything after the accepted design | gated | gate `doc-12` MET 2026-08-26; waits for the train after `doc-14` (owner 2026-09-24) |
| `doc-17` Prompt caching | the prod cache reading, then the Phase 3 decision | gated | the reading (agent watch in `now.md`) |
| `doc-107` archive/digest consolidation | all | gated | the digest shape settles on prod |
| `doc-86` Character-initiated messages | Phase 0 product decisions | owner | research done 2026-09-02; also gated on `doc-75` |
| `doc-105` User-installable app | Phase 0 probe + four rulings | owner | research done 2026-09-17 |
| `doc-24` Typing indicator | two sub-items + the log investigation | pivoted → drain | TASK-1087 (slot lost April 2026) |
| `doc-9` Model config | Phase 1 `fallbackConfigId` edge | pivoted → drain | TASK-1088 (Phase 2 stays, gated on `doc-15`) |
| `doc-3` DB performance | Phase 2 `db:index-audit` | pivoted → drain | TASK-1089 (Phases 3–4 consume it) |
| `doc-8` Memory overhaul | owner-run per-character rollout | owner | the gates (`memory:summarize --dry-run`); map re-touch TASK-1086 |

### Phase A — Rock Solid

- **Follow-Up Pool Drain** (`doc-7`) — the standing background unit (not the Active Epic since 2026-09-24; `doc-14` is).
- **v2 Parity + Legacy Retirement** (`doc-27`) — Phase 0 matrix runs now; parity BUILDS gated on `doc-14`.
- **Observability & Telemetry** (`doc-12`) — closes Phase A; gate for Phase C MET 2026-08-26.
- _Phase-A quality pool (pull as train themes by capacity)_: **Ratchet Bidirectionality** (`doc-63`) · **Type-Assertion Audit + Deterministic Ratchet** (`doc-23`) · **PGLite Fidelity + Real-Postgres Integration Tier** (`doc-13`) · **Database Performance Audit** (`doc-3`) · **Security Audit Pass** (`doc-19`).

### Phase B — Finish the half-done

- **Provider Prompt Caching** (`doc-17`) — Phase 2 shipped; the cache reading, then the Phase 3 decision.
- **Platform-Portable UX Layer waves 4–6** (`doc-14`) — Active Epic since 2026-09-24 (`active-epic.md`).
- **Guild / Server Management** (`doc-75`) — Phase 1 is a correctness defect; may ride earlier as a fix.
- **Typing Indicator Reliability** (`doc-24`) — partial; remainder is TASK-1087.
- **Character Portability** (`doc-2`) — partial; PNG card import + sidecar prompts remain.

### Phase C — Gated features

- **Next-Gen AI Capabilities** (`doc-11`) — design accepted; gate `doc-12` MET, waits for the train after `doc-14`.
- **User-installable app** (`doc-105`) — research complete; Phase 0 probe + four owner rulings.
- **Feature-flag lifecycle for system settings** (`doc-106`) — owner intake 2026-09-18.
- **Knowledge Store (pgvector substrate)** (`doc-88`) — consumes memory-epic retrieval learnings.
- **Character-initiated messages** (`doc-86`) — gate: `doc-75` + `doc-12`; owner promised a named user a heads-up on ship.
- **Tag-Scoped Sharing** (`doc-67`) — after `doc-60`'s tag substrate.

### Side track (owner-paced, meta not product)

- **Meta-Harness Spinoff** (`doc-64`) — moved to the Deck management role; Tzurot remainder = TASK-1106.
- **Read-only backlog browser on the website** (`doc-76`)

### Unscheduled pool (pick by dependency + value when a slot opens)

- **Platform decoupling** (`doc-79`) — precondition: end-user auth before any browser exposure.
- **Audit system-prompt effectiveness from reasoning traces** (`doc-85`)
- **First-use onboarding DM + data-training disclosure** (`doc-6`)
- **System model + intent linkage** (`doc-22`)
- **User-facing docs + discoverability** (`doc-25`)
- **Preset Cascade Standardization** (`doc-15`) — spine for the settings cluster (`doc-26`, `doc-75`).
- **User-Requested Features** (`doc-26`) — sidecar prompts wait on `doc-15` item 2.
- **Model Configuration Overhaul** (`doc-9`)
- **z.ai Catalog + 402 Error-Shape Verification** (`doc-29`)
- **`/voice` + `/inspect` UX Polish** (`doc-28`)
- **Self-Hosted TTS + BYOK Re-Evaluation** (`doc-20`)
- **Adjacent CPD Follow-Up Campaigns** (`doc-1`)
- **Multimodal Input — file + video forwarding** (`doc-10`)
- **Production Observability — perf metrics + tracing** (`doc-16`)
- **Export/Import/Template/Clone Field Completeness** (`doc-5`)
- **Quota, Billing & Key Identity** (`doc-18`)
- **Synchronous Work & Timeout Budgets** (`doc-21`)
