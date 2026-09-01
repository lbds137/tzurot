---
id: doc-69
title: >-
  doc-64 Phase 0: portability inventory (rules, hooks, skills, ops, root
  surfaces)
type: other
created_date: '2026-08-09 18:24'
---

_Artifact for [[doc-64]] Phase 0 (the classification "decides everything" input to the council pass). Produced by five parallel classifier agents (one per surface family), borderline rows adjudicated by the orchestrating session. Rubric: **PORTABLE** = travels as-is (examples swappable) · **PARAM** = general mechanism, Tzurot values must move to config (surface named per row) · **BOUND** = encodes Tzurot's product/architecture, stays._

## Headline

278 rows across five surfaces:

| Surface | Rows | PORTABLE | PARAM | BOUND | Borderline |
| --- | --- | --- | --- | --- | --- |
| `.claude/rules/` sections | 125 | ~55 | ~55 | ~11 | 4 |
| `.claude/hooks/` (+ settings wiring) | 14 | 2 | 12 | 0 | 3 |
| `.claude/skills/` | 14 | 5 | 6 | 3 | 2 |
| ops CLI commands | 78 | ~13 | ~40 | ~20 | 5 |
| agents + root + husky + commitlint | 47 | ~11 | ~34 | 2 | 3 |

The shape confirms doc-64's hypothesis: the epistemics/posture/interaction layer (00 § Project Rules, 09, 10, review-response, orchestration, bug-remediation, session-mining) is near-wholesale PORTABLE; the product rules (01, 03, 04) and data-touching ops commands are the BOUND core; everything in between is PARAM — general mechanisms whose Tzurot values (command names, branch names, baselines, registries) are the config surface the plugin needs to define.

## Borderline adjudications (orchestrator calls — council pass may override)

1. **tzurot-doc-audit skill** → PARAM, split extraction: the plugin ships the method (four-question cut test, verdict table) plus a checklist TEMPLATE; the enumerated per-repo file walk is per-repo data by construction.
2. **tzurot-testing skill** → BOUND with extractable fragments: the human-verification-request template and tier-taxonomy discipline move to the plugin; the PGLite/vitest/Discord mechanics stay. Needs a rewrite-level split, not a value swap — schedule as its own Phase 1 item.
3. **pr-merge-review-check hook** → PARAM (hard tier): pattern genuinely portable (gate merges on the AI review being read), but extraction ≈ rewrite — repo slug should come from `git remote`, the release-sequence reminders become config hooks. Phase 1 item with real effort attached.
4. **skill-eval hook** → PARAM via engine/data split: the plugin ships the keyword→skill reminder ENGINE reading a per-repo map file; the 14-skill regex table is per-repo data. Nothing of the current table travels.
5. **settings.json hooks wiring** → not an extraction unit. Each portable hook carries its own registration snippet; the wiring shape is harness convention documented in the plugin's install skill.
6. **husky dangerous-migration index guard** → BOUND for Phase 1 (two hardcoded index names, dead weight elsewhere); the mechanism ("a migration must not DROP a protected index without recreating it") is a Phase 2 ratchet-package candidate behind a config list.
7. **BACKLOG.md / 06-backlog tracker-store** → the process DESIGN (queryable pool, four label axes, admission bar, three-exit staleness) is PORTABLE process documentation; the Backlog.md CLI is a recommended-but-swappable integration. Plugin ships the design doc + optional CLI integration; `dev:deferred-refs` travels with that integration (its data source is the store's format).
8. **commit-msg session-URL guard** → PORTABLE, ship unconditionally. On a private repo it is a harmless no-op; a visibility config gate adds surface for zero risk reduction.
9. **REBASE-ONLY workflow rule** → PARAM: ship as "a chosen git strategy, stated and enforced," with rebase-only as the authored default a consuming repo can override — the meta-rule (pick one, enforce it structurally) is the portable part.
10. **04-discord Shared Utilities self-registration technique** → split: the table stays BOUND; the technique ("a new implementor of a guarded pattern must self-register in a registry a test asserts against, because unregistered = unguarded") earns a line in the plugin's portable patterns doc.
11. **05-tooling Guards section / guard infrastructure** → the hard-fail-guard POSTURE and the audit-tool registry mechanism (guard:audit-tool-docs, guard:hook-probes — both classified PORTABLE in the ops slice) are Phase 2 package core; each individual guard classifies per its own row.
12. **Ops borderlines** (`memory:anonymize-goldens`, `cache:prefix-diff`, `test:generate-schema`) → BOUND for now under the no-current-consumer rule: their generic kernels (PII redaction, prompt-cache divergence, PGLite schema harvest) are noted as future extractions if a second consumer appears — the abstraction is deferred, not the design question. `release:premigrate`: apply step BOUND; its destructive-SQL detector is a Phase 2 ratchet-package candidate.

## Incidental defects surfaced by the sweep

- `pnpm ops context` summarizes stale doc filenames (`CURRENT_WORK.md`/`ROADMAP.md` — neither exists; this repo uses `CURRENT.md`/`BACKLOG.md`) → filed as a tracker task.

---

# doc-64 Phase 0 collation — slice: .claude/rules sections

# doc-64 Phase 0 Inventory — `.claude/rules/` Classification

Slice: every `##`-level section across `00-critical.md` through `10-working-posture.md` (10 files). Where a `##` section contains `###` subsections that classify differently, I split into subsection rows (grouping only where subsections classify identically), since a single verdict per giant section would hide real signal.

| file § section | class | why | param surface (if PARAM) |
|---|---|---|---|
| 00-critical.md § Security > Shell Command Safety | PORTABLE | general secure-coding discipline (never string-interpolate shell commands); table is language-agnostic | |
| 00-critical.md § Security > Secrets | PARAM | general secret-hygiene rule; "Railway env vars" is one platform's mechanism | secrets platform / env-var store |
| 00-critical.md § Security > Claude Session URLs Are Secrets | PARAM | generalizes to "AI-tool session/capability identifiers are secrets, don't publish them in a public repo" | enforcing hook path, public-repo assumption |
| 00-critical.md § Security > User Input | PARAM | principle (validate untrusted input at service boundaries) is portable; Zod is the chosen library | validation library |
| 00-critical.md § Security > HTML/XML Tag Stripping (CodeQL) | PARAM | general lesson (never regex-strip tags, CodeQL flags it) tied to a specific ai-worker utility | sanitizer utility import path |
| 00-critical.md § Security > SSRF Prevention | PORTABLE | general secure URL-construction rule (`encodeURIComponent` on dynamic segments); examples are swappable | |
| 00-critical.md § Security > URL Substring Checks (CodeQL) | PORTABLE | general CodeQL-class lesson (parse and compare hosts exactly, never substring-match); domains are illustrative | |
| 00-critical.md § Security > Logging (No PII) | PORTABLE | general logging-hygiene discipline, no product content | |
| 00-critical.md § Git Safety > REBASE-ONLY Workflow | BORDERLINE | see Borderline list | |
| 00-critical.md § Git Safety > Long-Lived Branch Protection | PARAM | general "protect designated long-lived branches from deletion" mechanism | branch names (main/develop), settings-guard command |
| 00-critical.md § Git Safety > Destructive Commands - ASK FIRST | PORTABLE | near-universal git-safety table; only "killall node" ties to one runtime | |
| 00-critical.md § Git Safety > Standing permission (feature-branch commits/pushes) | PORTABLE | core governance mechanism defining what an AI agent may do autonomously vs. must ask about | |
| 00-critical.md § Git Safety > Direct doc commits to develop | PARAM | mechanism (some paths get a lighter commit path than code) is portable | which paths get the exception, branch name |
| 00-critical.md § Git Safety > Before Code Changes | PORTABLE | core discipline: read the whole file first, confirm user-visible/schema changes before building | |
| 00-critical.md § Git Safety > Merge Approval | PARAM | mechanism (autonomous merge once truly ready vs. an owner-gated release gate) is portable | which branch pattern requires explicit approval |
| 00-critical.md § Git Safety > Never Merge PRs Without Completed CI | PARAM | green/complete/read discipline and "a passing check list isn't proof CI ran" are highly portable; wrapped in Tzurot-specific commands | CI-gate command, blocking-hook name, review-bot identity |
| 00-critical.md § Testing | PARAM | "never modify tests to pass" + pre-push coverage gate are portable integrity rules, wrapped in specific commands/tool/threshold | test commands, coverage tool, threshold, baseline file path |
| 00-critical.md § Project Rules > No Backward Compatibility | PARAM | mechanism (state your backward-compat stance explicitly) is portable | backward-compat policy stance |
| 00-critical.md § Project Rules > Always Leave Code Better Than You Found It | PORTABLE | general engineering ethic, no product content | |
| 00-critical.md § Project Rules > Verify Before Accepting External Feedback | PORTABLE | general skepticism toward automated reviewers | |
| 00-critical.md § Project Rules > Don't Present Speculation as Fact | PORTABLE | core AI epistemics (observed vs. inferred, runtime- vs. code-read-verification); no product content | |
| 00-critical.md § Project Rules > Mandatory Global Discovery | PORTABLE | general search-before-modify-infra discipline | |
| 00-critical.md § Project Rules > Fix Recurring Failures Structurally | PORTABLE | describes the plugin's own self-improvement loop (rule/skill/hook tiers), which are Claude Code product concepts, not Tzurot's | |
| 01-architecture.md § Service Boundaries | BOUND | Tzurot's bot-client/api-gateway/ai-worker split and Prisma-access rules | |
| 01-architecture.md § Request Flow | BOUND | Tzurot's specific service call chain (Discord→bot-client→api-gateway→ai-worker→OpenRouter/Gemini) | |
| 01-architecture.md § Where Code Belongs | BOUND | Tzurot directory/module map | |
| 01-architecture.md § Error Message Patterns | PARAM | mechanism (separate machine-readable backend errors from user-facing presentation-layer polish) is portable | layer names, presentation convention (emoji) |
| 01-architecture.md § Request Enrichment | BOUND | Tzurot-specific middleware field names and mount order | |
| 01-architecture.md § Design Principles | PARAM | general anti-over-engineering stance (no DDD, no DI containers, simple layering) is portable | layer names (Route→Service→Prisma), shared-package name |
| 01-architecture.md § When to Extract a Service | PORTABLE | general software-design heuristic for extract-vs-inline, no product-specific content | |
| 01-architecture.md § Autocomplete Utilities | BOUND | Discord bot-specific utility table | |
| 01-architecture.md § Architecture Verification | PARAM | general mechanism (periodic automated boundary/dead-code/size audit) is portable | specific commands (depcruise/xray/knip), thresholds |
| 02-code-standards.md § ESLint Limits (CI Enforced) | PARAM | general mechanism (enforce complexity/size limits via lint config) portable | rule names/thresholds, ESLint/TS toolchain |
| 02-code-standards.md § Lint Suppression Standards | PORTABLE | general discipline: every suppression needs a real justification; banned-vs-good pattern generalizes to any linter | |
| 02-code-standards.md § Temporal Markers in Code Comments | PORTABLE | general comment-hygiene rule (no dates/PR-refs/archaeology in code comments, keep invariant not journey) | |
| 02-code-standards.md § A Comment That Asserts Behavior Is a Claim | PORTABLE | distinctive epistemic rule: a runtime-behavior claim in a comment needs a pinning test or a hedge; no product content | |
| 02-code-standards.md § TypeScript Strict Rules | PARAM | general principle (strict typing, no any, validate at boundaries) portable | TypeScript/Zod specifics |
| 02-code-standards.md § Pino Logger Format | PARAM | mechanism (structured-fields-first logging call convention) is portable | logger library (Pino) and its call shape |
| 02-code-standards.md § Testing Standards > Test Tiers | PARAM | general concept (named test tiers with distinct purposes) portable | file-suffix taxonomy, canonical-doc link |
| 02-code-standards.md § Testing Standards > Core Principles | PORTABLE | strong general testing epistemics (behavior-not-implementation, colocated tests, mocked-seam assertions, fixture typing); file refs are swappable illustrations | |
| 02-code-standards.md § When to Add Tests | PARAM | general change-type/test-tier matrix concept is portable | `.int` naming convention, skill reference |
| 02-code-standards.md § Schema Test Colocation | PORTABLE | general colocation convention; Tzurot path is illustrative only | |
| 02-code-standards.md § Types & Constants | PARAM | general principle (promote a value to shared types once used 2+ places) portable | shared-types package name/table |
| 02-code-standards.md § Module Organization | PARAM | general hygiene (import from source, no barrel/wrapper re-exports) portable | package name (`@tzurot/common-types`), specific ESLint rule |
| 02-code-standards.md § Dependency Additions Land on Latest | PORTABLE | general dependency-hygiene policy; Dependabot is a generic GitHub feature, not Tzurot-specific | |
| 02-code-standards.md § Python Standards (voice-engine) | PARAM | mechanism (directory-scoped CLAUDE.md that auto-loads only in-context) is a portable Claude Code feature | scoped file's content/service name |
| 02-code-standards.md § Duplication > Config-route helpers | BOUND | names specific Tzurot files/routes/helper signatures | |
| 02-code-standards.md § Duplication > The 2-callback ceiling rule | PORTABLE | general heuristic: when a proposed shared helper needs >2 divergence-handling callbacks, the abstraction is wrong; adapter-cohesion exception generalizes | |
| 02-code-standards.md § Duplication > CPD measurement (raw vs filtered) | PARAM | general mechanism (duplication ratchet with baseline + ask-before-fixing triage) portable | tool (jscpd), commands, baseline format |
| 03-database.md § Connection Management | BOUND | Prisma 7 driver-adapter/pg.Pool specifics | |
| 03-database.md § Query Patterns | PARAM | general "always bound your queries, avoid N+1" discipline portable | ORM (Prisma) syntax |
| 03-database.md § pgvector Operations | BOUND | Tzurot's pgvector similarity-search usage | |
| 03-database.md § Indexes Ship With Their Query | PARAM | general review discipline ("which query does this index serve?", no speculative indexes) portable | migration/index tooling specifics |
| 03-database.md § Sync-Tracked Tables & updated_at | BOUND | entirely Tzurot's dev↔prod LWW sync mechanism | |
| 03-database.md § Migrations > Optional Columns Require Null-Semantics Documentation | PARAM | general practice (nullable columns must document what null means, statically audited) is a portable schema-quality idea | Prisma schema syntax, schema-audit tool |
| 03-database.md § Migrations (Deployment / Protected Indexes / Anti-Patterns) | BOUND | Railway deploy timing, Prisma migration drift-suppression list, specific index names | |
| 03-database.md § Caching > Cache Decision Tree | PARAM | general caching-strategy decision tree (staleness/cost/rate-limiting) portable | Redis-specific implementation |
| 03-database.md § Caching > TTLCache Usage / Existing Cache Implementations / durability tiers | BOUND | Tzurot's specific cache inventory, TTLs, and tier table | |
| 04-discord.md § 3-Second Rule (CRITICAL) | PARAM | mechanism (ack a synchronous interaction budget before any async work, lint-enforced) generalizes to any webhook-driven system | the 3s constraint itself, Discord API, custom ESLint rule |
| 04-discord.md § Deterministic UUIDs | BOUND | Discord-snowflake-keyed determinism | |
| 04-discord.md § Slash Command Standards | BOUND | Discord UI/UX conventions (subcommand names, response types, button emoji/order) | |
| 04-discord.md § Component Interaction Routing (CRITICAL) | PARAM | mechanism (stateless central routing beats inline collectors for restart/multi-replica safety) is a portable distributed-systems lesson | Discord.js API specifics |
| 04-discord.md § Shared Utilities | BORDERLINE | see Borderline list | |
| 04-discord.md § Autocomplete Formatting | BOUND | Tzurot-specific formatting helper and badge system | |
| 04-discord.md § BullMQ Job Patterns > Retryable vs Non-Retryable / Queue Configuration | PARAM | general error-classification and backoff-config mechanism portable | BullMQ syntax |
| 04-discord.md § BullMQ Job Patterns > Spend-Idempotent Retries | PORTABLE | general lesson for any job queue with billed side effects (partial-completion shrinking, zero-spend counter-neutrality, write-past-point-of-no-return); examples are illustrative | |
| 04-discord.md § BullMQ Job Patterns > Timer Patterns | PARAM | general "avoid persistent intervals, use scheduled jobs" mechanism | BullMQ repeatable-job API |
| 04-discord.md § Observability > Correlation IDs | PORTABLE | general request-tracing discipline (generate, thread, bind-once-at-entry) | |
| 04-discord.md § Observability > Structured Logging | PORTABLE | general "structured fields, not string interpolation" discipline | |
| 05-tooling.md § Essential Commands | PARAM | general concept (categorized dev/test/static-analysis/focused command groups) portable | actual command names |
| 05-tooling.md § Resource Constraints (CRITICAL) | PARAM | general "don't run heavy suites in parallel on constrained hardware" ops lesson portable | which commands are "heavy," hardware description |
| 05-tooling.md § Ops CLI > Database | BOUND | Tzurot's specific `pnpm ops db:*` commands | |
| 05-tooling.md § Ops CLI > GitHub | PARAM | pattern (wrap a broken vendor CLI subcommand with a custom one) portable | specific commands |
| 05-tooling.md § Ops CLI > Deployment | BOUND | Railway-specific deploy/maintenance commands | |
| 05-tooling.md § Ops CLI > Codebase Analysis (Xray) | PARAM | idea (LLM-consumable codebase declaration index, multiple output formats) is a portable capability | the home-grown xray tool itself |
| 05-tooling.md § Ops CLI > Mutation-Score Ratchet (Stryker) | PARAM | general mechanism (mutation-testing gate with baseline ratchet, no static-baseline editing) portable | Stryker, tracked-package list |
| 05-tooling.md § Ops CLI > Secret Rotation | PARAM | general mechanism (rotation ledger + staged dual-key rotation) portable | key names, rotation intervals |
| 05-tooling.md § Ops CLI > Security Advisories | PARAM | general mechanism (surface advisories, distinguish direct-fixable vs. transitive-needs-override) portable | command specifics |
| 05-tooling.md § Ops CLI > Test Audits | PARAM | general mechanism (coverage ratchet with versioned baseline + explicit update command) portable | version constant, command names |
| 05-tooling.md § Ops CLI > CPD (Duplication Ratchet) | PARAM | duplicate content of 02-code-standards CPD row; same ratchet-with-baseline mechanism | jscpd, command names |
| 05-tooling.md § Ops CLI > Guards (Structural enforcement) | BORDERLINE | see Borderline list | |
| 05-tooling.md § Ops CLI > Backlog lint + digest | BOUND | ties to Tzurot's specific backlog/tracker system | |
| 05-tooling.md § Ops CLI > Audit-tool infrastructure (Layers 1-3) | PARAM | general concept (registry + checklist so new tools can't skip enforcement layers) portable | registry file, checklist doc |
| 05-tooling.md § Git Workflow > Commit Message Format | PARAM | conventional-commits-style types/scopes with commitlint enforcement is a common portable pattern | scope enum, exact format |
| 05-tooling.md § Git Workflow > The `debug` type | PORTABLE | genuinely portable idea: a distinct, greppable commit-type lifecycle for temporary diagnostic instrumentation vs. permanent observability (`feat`) | |
| 05-tooling.md § Git Workflow > PR Monitoring (automatic) | PARAM | the "green≠complete≠read" discipline and SHA-pinning lesson are highly portable; entirely expressed via Tzurot's custom CI-gate wrapper and tool mechanics | CI-gate command, review-fetch commands, review-bot name, hook scripts |
| 05-tooling.md § Git Workflow > Release Notes Format | PARAM | structured, categorized changelog (Conventional Changelog-style) is portable | category list, scope enum |
| 05-tooling.md § No Standalone Scripts | PARAM | general engineering-hygiene rule (tooling should be typed/tested/discoverable, not ad-hoc bash) is portable | tooling location, language/stack |
| 05-tooling.md § References | BOUND | literal links to Tzurot's own docs | |
| 06-backlog.md § Structure (incl. HOT/COLD tables) | PARAM | general tiered-backlog information architecture (hot/cold/small-item-pool) portable | specific file names, caps |
| 06-backlog.md § The tracker store (small items, incl. granularity ladder) | BORDERLINE | see Borderline list | |
| 06-backlog.md § The tracker store > The admission bar | PORTABLE | general filing discipline (same-file work done now, no trigger needed for small items, batches filed as batches) generalizes fully | |
| 06-backlog.md § Staleness — aging escalates, it never deletes (incl. Ruling an item out) | PORTABLE | strong general backlog-hygiene philosophy (never delete by calendar, only exit via done/obsolete/ruled-out, technical-reason bar for rule-outs) | |
| 06-backlog.md § Session Workflow (Starting/Ending) | PARAM | general "how an AI agent should start/end a work session honestly" procedure is portable | specific files/commands (CURRENT.md, digest command) |
| 06-backlog.md § Out-of-Scope Items Must Be Tracked (incl. sub-requirements/gates) | PARAM | core discipline (deferred work must land at a concrete destination at the moment it's decided, not just in commit prose) is very portable | destination names (now.md, tracker task) |
| 06-backlog.md § Triage Rules — where does a new item go? | PARAM | general triage-by-size table mechanism portable | destination names |
| 06-backlog.md § Theme/Epic Structure | PARAM | general template (Focus line + phased checklist) portable | field names |
| 06-backlog.md (former § Anti-Patterns — folded into the constraints it restated) | PARAM | lessons generalize (don't let untriaged pile up, aging escalates not deletes) but phrased entirely in Tzurot terms | terms (Current Focus, cold/, tracker) |
| 06-backlog.md § Tags | PARAM | general consistent-tag-taxonomy mechanism portable | tag/emoji list |
| 07-documentation.md § Three-Layer System | PORTABLE | genuinely portable documentation-architecture pattern (rules=always-loaded constraints, skills=on-invoke procedures, reference=on-read rationale, each layer points down only) | |
| 07-documentation.md § Where to Put New Docs | PARAM | mechanism (a doc-type→location routing table) is portable | specific directory tree |
| 07-documentation.md § Audience check (public repo) | PARAM | general internal-vs-public-audience distinction for docs is portable | local-notes folder name (`docs/local/`) |
| 07-documentation.md § Naming Conventions | PORTABLE | general file-naming conventions, no product content | |
| 07-documentation.md § Lifecycle Rules | PORTABLE | general document-lifecycle discipline (delete after verify, distill transcripts, post-mortems carry outcome not narrative) | |
| 07-documentation.md § Reference Root Files | BOUND | literal table of Tzurot's own top-level reference docs | |
| 07-documentation.md § Related | BOUND | pointer links to Tzurot's own docs | |
| 09-interaction-style.md § Don't Suggest Stopping | PORTABLE | general interaction posture; energy management belongs to the user | |
| 09-interaction-style.md § Answer the User's Questions First | PORTABLE | general, with two mechanical checkpoints; generalizes fully | |
| 09-interaction-style.md § User Directives Are Immutable Session State | PORTABLE | general (once decided, don't re-litigate without new information) | |
| 09-interaction-style.md § Most-Correct Is the Standing Default | PORTABLE | general preference framework (correctness over speed by default) | |
| 09-interaction-style.md § Big Token Spends Need Informed Consent | PARAM | general mechanism (consent before large multi-agent fan-outs, state cost) is portable | cost threshold, this user's specific plan/usage anchor |
| 09-interaction-style.md § An Escalation Is One Named Question Plus a Recommendation | PORTABLE | general, strong content on proper decision escalation | |
| 09-interaction-style.md § Read Dictated Messages Charitably | PORTABLE | general voice-dictation-garbling discipline; examples swappable | |
| 10-working-posture.md § Momentum: a standing directive means keep pulling | PORTABLE | general session-driving posture | |
| 10-working-posture.md § Boards are snapshots; git and code are the truth | PORTABLE | general (verify board entries against ground truth before building) | |
| 10-working-posture.md § Principle from advisors, target from the code | PORTABLE | general (advisors give principles, code at build time gives the actual target) | |
| 10-working-posture.md § Measure, then decide | PORTABLE | general (prefer cheap measurement over guessing, state decisions with data) | |
| 10-working-posture.md § Everything not-done gets a disposition, at the moment of decision | PORTABLE | general four-state disposition discipline (shipped/obsolete/ruled-out/deferred) | |
| 10-working-posture.md § Presence-then-test after bulk edits | PORTABLE | general (grep for new AND old tokens after bulk edits before trusting green tests) | |
| 10-working-posture.md § Lossy steps are for known output shapes | PORTABLE | rich, general tool-output-verification epistemics (stderr suppression, PIPESTATUS indexing, claim-time vs. result-time checks); no product content | |
| 10-working-posture.md § Reviews are collaborators, not gates to survive | PARAM | general posture (state what you verified, not just what you did) is portable | skill reference (`/tzurot-review-response`) |
| 10-working-posture.md § Ship in bounded units | PARAM | general mechanism (propose a release cut once unreleased runtime-touching work crosses a threshold) is portable | PR-count threshold, package-exclusion list |
| 10-working-posture.md § Failure modes get structure, not resolutions | PORTABLE | general (apply "fix recurring failures structurally" to yourself mid-session) | |
| 10-working-posture.md § Scope contract: deliver what was asked, at the scope intended | PORTABLE | general (make routine calls yourself, escalate only genuine scope ambiguity) | |
| 10-working-posture.md § Report shape | PORTABLE | general (lead with outcome, honest ledger, escalate only genuinely user's decisions) | |

**Borderline:**
- `00-critical.md § Git Safety > REBASE-ONLY Workflow` — torn between "commit to and enforce one git strategy" (a portable meta-mechanism) and the rule text asserting rebase-only as if it were a universal law rather than a chosen value.
- `04-discord.md § Shared Utilities` — the section is a Tzurot-specific utility table (BOUND), but it embeds a genuinely portable technique: a new implementer of a shared pattern must self-register in a central list a test asserts against, because unregistered = unguarded.
- `05-tooling.md § Ops CLI > Guards (Structural enforcement)` — "hard-fail CI guards for structural invariants" is core to keeping an AI-assisted codebase honest and arguably belongs in a portable plugin as a capability, but as written it's fused to Tzurot's specific guard list/commands with no separable generic form.
- `06-backlog.md § The tracker store (small items, incl. granularity ladder)` — the underlying idea (queryable, axis-labeled, CI-integrity-gated small-item pool) is one of the strongest portable AI-process candidates in the whole rules tree, but it's implemented as a specific third-party CLI (`pnpm tracker` / Backlog.md) wired to Tzurot's file layout, so extracting the mechanism without the tool dependency is a real design question, not a simple param swap.

Total rows: 125
# doc-64 Phase 0 collation — slice: hooks (.claude/hooks + wiring)

| hook | class | why (≤1 sentence) | param surface (if PARAM) |
|---|---|---|---|
| `bare-token-binding-reminder.sh` (+ `.probe.sh`) | PORTABLE | Regex-detects a bare approval/selection reply and reminds the agent to restate its binding — pure harness-interaction pattern with no repo logic. | — |
| `claim-shape-guard.sh` (`.husky/pre-commit` step) | PARAM | Scans staged diff added-lines for runtime-claim phrasing — detection mechanism general, framing cites a specific rule doc and path list. | Excluded-path list (`tracker/`, `backlog/`, `docs/`, `.claude/`, `.husky/`, `*.md`); citation to `00-critical.md § producer is authoritative`. |
| `cwd-drift-guard.sh` (+ `.probe.sh`) | PARAM | Blocks a `git` command with a repo-root-relative pathspec from a drifted cwd — general shell-safety, but the detector is a hardcoded dir/file list. | Directory list (`services\|packages\|backlog\|docs\|prisma\|scripts\|.claude\|.github\|.husky`) and root filenames (`CURRENT.md`/`BACKLOG.md`); citation to `/tzurot-git-workflow`. |
| `develop-code-commit-guard.sh` (+ `.probe.sh`) | PARAM | Blocks committing code directly on a protected long-lived branch — general branch-protection mechanism, values project-specific. | Branch names (`develop`/`main`); gated-extension blocklist; `.claude/{rules,skills,hooks}` carve-out; env `TZUROT_ALLOW_DEVELOP_CODE_COMMIT`. |
| `eslint-on-edit.sh` | PARAM | Unregistered dead hook (kept for reference); generic lint-on-edit, project-specific invocation. | `pnpm exec eslint` shape; `.ts`/`.tsx` scope; inert (not wired). |
| `husky-pre-commit.probe.sh` (pins temporal-marker block) | PARAM | Pins the regex blocking dated/PR-ref comments entering code — general comment-hygiene, project framing. | Env `TZUROT_SKIP_TEMPORAL_CHECK`; path-exclusion list; citation to `02-code-standards.md`. |
| `lossy-pipe-guard.sh` (+ `.probe.sh`) | PARAM | Blocks filtered `git commit/push` output and truncated `gh` reads — general "protect must-read-whole output". | Enumerated `gh:` ops-wrapper subcommand names tied to `packages/tooling/src/commands/gh.ts`; skill/rule citations. |
| `pr-merge-review-check.sh` (+ `.probe.sh`) | PARAM (borderline) | Forces the latest AI-reviewer comment into context before `gh pr merge` — valuable general pattern, deeply wired to this repo's release sequence. | Hardcoded repo slug `lbds137/tzurot`; `pnpm ops release:finalize/premigrate` strings; branch names; `claude[bot]` login; ack-file scheme. |
| `pr-monitor-reminder.sh` (+ `.probe.sh`) | PARAM | Post-push assignee backfill + monitor reminder — general PR hygiene, one project command. | `pnpm ops gh:ci-gate` command string; doc citations. |
| `promise-ledger-check.sh` (+ `.probe.sh`) | PARAM | Blocks turn end on a deferred-work promise without a same-turn backlog write — general "promise ledger" pattern, filing surface project-specific. | Backlog/tracker file patterns; tracker CLI shape; citation to `06-backlog.md`. |
| `queued-message-receipt.sh` (+ `.probe.sh`) | PORTABLE | Detects mid-turn-queued user messages via transcript `queue-operation` entries — pure harness mechanism (sole project bit: swappable doc citation in banner). | — |
| `session-start.sh` | PARAM | Injects status file + post-compaction checklist at session start — general structural grounding, content project-specific. | `CURRENT.md` name/content; `backlog/now.md` pointer; hand-synced compaction checklist. |
| `skill-eval.sh` | PARAM (borderline) | Deterministic keyword→skill reminder compensating for unreliable auto-activation — mechanism general, content 100% this repo's skill inventory. | Entire 14-skill keyword regex table — per-project rewrite, not value swap. |
| `settings.json` → `hooks` wiring block | PARAM (borderline) | Event→hook registration shape is standard harness convention; the script list is this repo's inventory. | The 10 wired script filenames + event/matcher assignments. Note: claim-shape-guard runs via `.husky/pre-commit`; eslint-on-edit unwired. |

**Borderline (awaiting orchestrator adjudication):**
- `pr-merge-review-check.sh` — pattern broadly valuable, but extraction ≈ rewrite (repo slug, release-command strings, ack-file scheme keyed to this repo's cadence).
- `skill-eval.sh` — the compensation mechanism is a portable idea, but none of its actual content is reusable data; PARAM overstates what a consumer inherits.
- `settings.json` hooks wiring — the shape is portable convention, but "the wiring" isn't a coherent extraction unit apart from deciding which hooks travel.

Total rows: 14 (2 PORTABLE / 12 PARAM; 3 borderline)
# doc-64 Phase 0 collation — slice: skills (.claude/skills/tzurot-*)

| skill | class | why (≤1 sentence) | param surface (if PARAM) |
|---|---|---|---|
| tzurot-arch-audit | PARAM | Quick-scan→deep-dive→template is a generic architecture-audit method, but every command is Tzurot's `pnpm ops` wrapper and every threshold (400/500 lines, 3000-line package cap, 50 exports, 5% dup) is baked in. | Tool invocations (`ops xray/depcruise/knip/cpd`), size/dup/coverage thresholds, baseline file paths |
| tzurot-bug-remediation | PORTABLE | Runtime-evidence-first → root-cause → exhaustive class sweep → tiered regression test → structural guard is pure verification epistemics with no product content. | — |
| tzurot-council-mcp | PARAM | The consult/verify-premises/handle-splits procedure is generic multi-model consultation discipline, but it assumes a specific `mcp__council__*` tool namespace and ships a swappable model-recommendation roster (GLM/Kimi/Qwen/Claude). | MCP tool namespace, per-task model roster table |
| tzurot-db-vector | BOUND | Entirely Prisma/pgvector/Railway migration mechanics tied to this schema's protected indexes (`idx_memories_embedding`, memories table). | — |
| tzurot-deployment | BOUND | Railway CLI operations, Discord-bot service topology (bot-client/api-gateway/ai-worker), BullMQ drain, and maintenance-mode flag are all this stack's infrastructure. | — |
| tzurot-design-boulder | PARAM | The ground→draft→council→owner-pass→land cadence is a portable design-review methodology, but it's wired to specific artifact paths and guard commands. | `docs/proposals/backlog/` path, `backlog/now.md`/`CURRENT.md`, `guard:proposal-links` |
| tzurot-doc-audit | PARAM | The audit *mechanism* (four-question cut test, memory-migration verdict table) is portable documentation hygiene, but the checklist is a file-by-file walk of this repo's exact rule/doc filenames and ops commands. | Enumerated `.claude/rules/*.md` filenames, `docs/reference/` subdir table, `ops lines:check`/`guard:proposal-links` commands |
| tzurot-docs | PARAM | Session start/end workflow (read state → work → update state → gate on additions/removals) is a portable session-management pattern, but it's hardwired to this project's CURRENT.md/BACKLOG.md/tracker file layout and CLI. | `CURRENT.md`/`backlog/now.md`/`backlog/active-epic.md` paths, `pnpm tracker` CLI |
| tzurot-git-workflow | PARAM | Commit/PR/rebase/release discipline (fixup commits, CI-gate monitoring, review triage) is a portable rebase-only workflow, but every step invokes Tzurot's `pnpm ops` CLI, a fixed scope enum, and this repo's release-notes/versioning conventions. | `ops gh:*`/`ops release:*` commands, commit-scope enum, release-notes format, branch names (develop/main) |
| tzurot-orchestration | PORTABLE | The driver-mode decision table, spec template, worktree-isolation rule, and diff-review gate are general multi-agent orchestration discipline with no product content. | — |
| tzurot-reuse-scout | PORTABLE | Search-before-write and consolidate-on-bug-discovery are general duplication-prevention discipline; the example utility tables it points to are swappable references. | — |
| tzurot-review-response | PORTABLE | The edit-shape classification, signal-conflict resolution, batching format, and round-cap state machine are a fully general PR-review-iteration procedure (confirms doc-64's claim). | — |
| tzurot-session-mining | PORTABLE | Extract→mine→synthesize→operationalize for converting session friction into structural fixes has no product content — only the corpus file path is project-specific and that's inherent to any checkout. | — |
| tzurot-testing | BOUND | Dominated by stack-specific mechanics (PGLite schema loading, vitest tier configs, Discord snowflake fixtures, coverage-baseline file), though the 5-part human-verification-request template and tier-taxonomy discipline are separable portable content. | — |

**Borderline (awaiting orchestrator adjudication):**
- tzurot-doc-audit: the cut-test/verdict-table *methodology* is genuinely portable documentation hygiene, but the skill's bulk is an enumerated checklist of THIS repo's specific rule/doc files — extracting the method without the checklist leaves a thin skill, and the checklist alone is unusable elsewhere.
- tzurot-testing: the human-verification-request template and unit/component/integration/contract tier discipline are project-agnostic testing epistemics, but they're inseparably interleaved with PGLite/Prisma/vitest/Discord-snowflake specifics throughout the same sections, so a clean split isn't obvious without a rewrite.

Total rows: 14 (5 PORTABLE / 6 PARAM / 3 BOUND; 2 borderline)
# doc-64 Phase 0 collation — slice: ops CLI commands

Good, that confirms `maintenance` operates on Tzurot's own MaintenanceFlag/BullMQ queues (BOUND). All source is now verified sufficiently. Compiling the final answer.

| command | class | why (≤1 sentence) | param surface (if PARAM) |
|---|---|---|---|
| `db:status` | PARAM | Generic Prisma migration-status reader (`_prisma_migrations` vs. local files); no Tzurot business data | env→Railway-CLI mapping, migrations path |
| `db:migrate` (incl. `--dry-run`) | PARAM | Generic `prisma migrate deploy`+`generate` wrapper with interactive prod confirmation | env resolution, migrations path |
| `db:deploy` | PARAM | Non-interactive wrapper around the same mechanism as `db:migrate` | same as `db:migrate` |
| `db:check-drift` | PARAM | Generic checksum-vs-file drift detector over `_prisma_migrations` | migrations path, env resolution |
| `db:fix-drift` | PARAM | Generic checksum-reconciliation UPDATE against `_prisma_migrations` | migrations path, env resolution |
| `db:inspect` | PARAM | Generic `information_schema`/`pg_indexes` inspector, but annotates results against a hardcoded protected-index registry | protected-index registry (name/table/description/recreateSQL) |
| `db:safe-migrate` | PARAM | Generic create-migration-with-sanitization workflow; strips SQL per `prisma/drift-ignore.json` patterns | drift-ignore pattern list, migrations path |
| `db:check-safety` | PARAM | Generic "DROP INDEX without matching CREATE" CI gate over a protected-index registry | protected-index registry |
| `run` | PARAM | Generic "spawn any command with env vars injected" mechanism; the injection source is Railway CLI specifically | `Environment` enum, Railway as env source, `DATABASE_URL` var name |
| `deploy:verify` / `deploy:dev` / `deploy:update-gateway` | BOUND | Deprecated stubs that print a pointer to `scripts/deployment/*.sh`; no logic to extract | — |
| `deploy:setup-vars` | PARAM | Generic `.env`→Railway-CLI-set mechanism with dry-run/confirmation | per-service variable-list constants (shared/bot-client/api-gateway/ai-worker) |
| `maintenance status/on/off` | BOUND | Directly manipulates Tzurot's shared `MaintenanceFlag` and pauses this app's specific BullMQ queues (`ai-requests`, scheduled-jobs) | — |
| `logs` | PARAM | Fully generic Railway-CLI log fetch/correlate/colorize engine; only the service allowlist is Tzurot's | `KNOWN_SERVICES`/`APP_SERVICES` list |
| `dev:focus` / `dev:lint` / `dev:test` / `dev:typecheck` | PORTABLE | Thin `turbo run <task> --filter …[changed-since-base]` wrapper; git-base detection is generic branch-naming, no product coupling | — |
| `dev:test-summary` | PARAM | Same turbo-wrapping mechanism, but the per-package attribution regex hardcodes the npm scope | npm scope prefix (`@tzurot/`) |
| `dev:update-deps` | PORTABLE | Generic pnpm monorepo dependency updater (walks `package.json`s, `pnpm update --latest`, rebuild) | workspace dirs (light param) |
| `dev:dead-files` | PARAM | Generic knip+grep-verify "importer only its own test" mechanism | exclusion-pattern allowlist, workspace search roots |
| `dev:deferred-refs` | PARAM | Generic file/text cross-reference scan, but exists only to serve Tzurot's specific `tracker/` markdown task-store | task-store location/format, generic-basename allowlist |
| `dev:schema-audit` | PARAM | Generic Prisma-schema doc-comment/null-semantics pattern checker; no hardcoded table/column names in the logic | schema path, suppression allowlist, detection heuristics |
| `dev:stale-debug` | PARAM | Generic git-blame/log "commit-type survives at HEAD" checker; `debug:` is Tzurot's own commitlint convention | commit-type prefix, staleness-age threshold |
| `lint:complexity-report` | PARAM | Generic ESLint-JSON-output complexity reporter run against tightened thresholds | threshold mirror of `eslint.config.js`, target dirs |
| `commands:audit` | BOUND | Reads `services/bot-client/command-manifest.json` and checks Discord slash-command naming/category rules | — |
| `backlog` | PARAM | Built on the generic third-party Backlog.md tracker CLI; lint layer enforces Tzurot's specific caps/labels/branch check | `now.md` cap file, `queue.md` doc-ref file, label-axis vocab, branch name |
| `backlog:digest` | PARAM | Generic tracker-store aggregation (by-label counts, oldest/newest N); only trivial constants are Tzurot's | oldest/newest counts, label prefix |
| `memory:analyze` / `memory:backfill` / `memory:cleanup` | BOUND | Operate directly on Tzurot's `memories`/`conversation_history` tables, pgvector embeddings, persona/personality ids | — |
| `memory:repair-fact-timestamps` | BOUND | Rewrites `memory_facts.valid_from` against Tzurot's fact-extraction/lock semantics | — |
| `memory:backfill-facts` | BOUND | Enqueues BullMQ jobs onto Tzurot's `FACT_EXTRACTION_QUEUE_NAME` with app-specific job-payload shape | — |
| `memory:mine-goldens` / `-conversation-goldens` / `-attachment-goldens` | BOUND | Query memory/conversation tables by persona/channel id; encode Tzurot production internals (fold windows, attachment markers) directly | — |
| `memory:anonymize-goldens` | BORDERLINE | Entity-detection/swap-apply engine is generic PII redaction over `{id, content, senders}` rows, but exists only to serve the Tzurot-specific mining pipeline above and its I/O shape | — |
| `retention:preview` / `-backfill-last-active` / `-notify` / `-purge` / `-reconcile-off-db` | BOUND | Operate on Tzurot's `users` table, Discord DM delivery, avatar-file cleanup, and BullMQ notify jobs — product-specific data-rights domain logic | — |
| `voice-refs:audit` | BOUND | Reads `Personality.voiceReferenceData` and checks against the Mistral Voxtral TTS 30s cap | — |
| `cache:inspect` | PORTABLE | Pure filesystem stat-walk over `.turbo/`; zero product coupling | — |
| `cache:clear` | PORTABLE | `rm -rf .turbo/` with dry-run preview; zero product coupling | — |
| `cache:clear-credit-exhaustion` | BOUND | Deletes a Redis key keyed to Tzurot's OpenRouter BYOK credit-exhaustion cache and Discord user ids | — |
| `cache:prefix-diff` | BORDERLINE | Comparison engine is a generic LLM prompt-cache divergence algorithm, but the fetch layer is hardwired to Tzurot's diagnostic-log schema and Discord channel/personality ids | — |
| `context` | PARAM | Generic git-state+CI-status+pending-migration summary; hardcodes stale doc filenames (`CURRENT_WORK.md`/`ROADMAP.md`, not this repo's actual `CURRENT.md`/`BACKLOG.md`) and assumes Prisma | doc-summary filenames, migration-tool assumption |
| `session:save` / `session:load` / `session:clear` | PORTABLE | Pure git-state + doc snapshot to a local JSON file; no product coupling beyond a filename constant | — |
| `inspect:queue` / `inspect:dlq` | PARAM | Generic BullMQ stats/failed-job viewer over an env-resolved Redis; only service/queue names are Tzurot's | Redis service names, default queue name |
| `inspect:tts-configs` | BOUND | Inline script hardcodes `prisma.ttsConfig` and Tzurot's TTS-config schema | — |
| `secrets:rotation-status` / `secrets:mark-rotated` | PARAM | Generic ledger pattern (name/rotatedAt/intervalDays, overdue calc) backed by a Prisma table specific to this schema | table name, default rotation-interval map |
| `secrets:rotate-byok` | BOUND | Staged rotation built directly against Tzurot's dual-key `API_KEY_ENCRYPTION_KEY` scheme and user-credential tables | — |
| `security:advisories` | PORTABLE | Pure GitHub Dependabot-alerts reader + workspace `package.json` walk for direct/transitive classification; works on any GH repo/monorepo | — |
| `prompt:mine-voice-probes` | BOUND | Hardcodes Tzurot's conversation/persona/personality schema and a project-specific deploy-date cutoff | — |
| `release:bump` | PARAM | Generic recursive `package.json` version bumper gated on a CURRENT.md-reset precondition | excluded-dirs set, CURRENT.md path/header convention, semver regex |
| `release:draft-notes` / `release:verify-notes` | PARAM | Generic "PRs merged since tag → Conventional-Commit-grouped notes" via `gh pr list`; repo inferred from git remote | default base branch, changelog category map |
| `release:publish` | PARAM | Generic tag+`gh release create`+prerelease-demote sequence; repo inferred from git remote | default target branch, prerelease-channel regex |
| `release:finalize` | PARAM | Generic "rebase integration branch onto release branch + force-push + sweep prerelease flags" git/gh sequence | hardcoded branch names (`main`/`develop`) |
| `release:premigrate` | BORDERLINE | Destructive-SQL-shape detection is generic Postgres static analysis, but the apply step is Prisma+Railway-specific env execution | — |
| `gh:pr-info` / `-reviews` / `-comments` / `-conversation` / `-edit` / `-all` | PARAM | Thin `gh api repos/{REPO}/...` wrappers over pure GitHub REST plumbing | hardcoded `REPO = 'lbds137/tzurot'` constant |
| `gh:ci-gate` | PARAM | Generic "poll runs until releasable, hand off to `gh pr checks --watch`" mechanism | same `REPO` constant, anchor workflow name (`CI`) |
| `codegen:routes` | BOUND | Generates client classes directly from Tzurot's own `ROUTE_MANIFEST` and audience partitioning | — |
| `codegen:command-types` | BOUND | Regex-scans bot-client's Discord.js `SlashCommandBuilder` calls to generate option schemas | — |
| `topology:generate` / `topology:check` | BOUND | Coverage graph hardcodes Tzurot's `ROUTE_MANIFEST`, `JobType` enum, and named contract-test file paths | — |
| `test:audit` / `-audit-contracts` / `-audit-services` | PARAM | Generic file-level coverage ratchet against a JSON baseline; Prisma-usage/Zod-schema detection hardcodes this repo's schema dir | baseline path, schema dir paths, Prisma-usage grep patterns, test-suffix convention |
| `test:tiers` | PORTABLE | Pure suffix-classification of test files into the 5 canonical tiers; no Tzurot-specific data | — |
| `test:generate-schema` | BORDERLINE | Harvesting mechanism (SQL Prisma's `migrate diff` can't express) is stack-generic for any Prisma+PGLite project, but that stack choice is itself fairly specific | — |
| `mutation:check` / `mutation:gate` / `mutation:update-baseline` | PARAM | Generic Stryker-JSON-vs-baseline ratchet (`score - graceMargin` floor) | tracked-package list, grace margin, baseline path |
| `xray` (all variants incl. `--suppressions`) | PORTABLE | Generic ts-morph TypeScript AST analyzer over any `packages/*`+`services/*` workspace; health-warning thresholds are the only tunable | health-warning thresholds (light param) |
| `cpd` (raw jscpd) | PORTABLE | Thin jscpd wrapper; all Tzurot-specific exclusions live in the external `.jscpd.json`, not tooling code | — |
| `cpd:filtered` / `cpd:check` / `cpd:update-baseline` | PARAM | Call-dominance post-filter heuristic has zero product-specific logic; only the baseline number and jscpd config are Tzurot's | baseline file, grace margin, `.jscpd.json` scan roots/thresholds |
| `guard:boundaries` | PARAM | Bespoke (not dependency-cruiser) import scanner; engine is generic, `BOUNDARY_RULES` encodes Tzurot's service names/forbidden imports | `BOUNDARY_RULES` registry |
| `guard:duplicate-exports` | PARAM | Generic per-line export-name scanner across configured package dirs | package-dir list, per-package allowlist |
| `guard:no-export-star` | PARAM | Generic "no `export *`" scanner; only the workspace-layout roots are Tzurot's | workspace roots, exempt path |
| `guard:prompt-tags` | BOUND | Cross-checks structural XML prompt tags against a registry encoding Tzurot's exact persona/prompt-assembly schema | — |
| `guard:commands-doc` | PARAM | Generic dir-listing-vs-doc-table sync checker; paths and row-shape are this repo's Discord command doc convention | doc/commands-dir paths, row-shape regex |
| `guard:ops-doc` | PARAM | Generic cac-CLI-registrar-vs-reference-doc sync scan, reusable for any cac-based CLI | registrar dir, doc path, undocumented-allowlist |
| `guard:repo-settings` | PARAM | Fully generic GitHub ruleset/branch-deletion-safety auditor; only the long-lived-branch names are Tzurot's | long-lived branch list, default branch |
| `guard:monitor-command` | PARAM | Generic N-copies-of-one-literal drift guard; the 3 file locations and anchor command are Tzurot's | surface-file list, anchor command regex |
| `guard:hook-probes` | PORTABLE | Generic Claude Code hook-probe registry/execution mechanism over `.claude/hooks/*`+`.husky/*`; registry entries are swappable data | — |
| `guard:dockerfile-dist` | PARAM | Generic transitive-workspace-dep-closure-vs-Dockerfile-COPY-set algorithm, reusable for any pnpm-workspace monorepo | npm scope prefix, workspace groups |
| `guard:claude-content-refs` | PARAM | Generic doc-reference-integrity checker over `.claude/rules`+`.claude/skills` against live `--help` output | scan dirs, CLI-invocation prefix |
| `guard:test-taxonomy` | PARAM | Generic single-source-of-truth drift guard (canonical doc + pointer files); the doc/pointer paths and tier vocabulary are Tzurot's | canonical doc path, pointer files, tier vocabulary |
| `guard:workflow-sync` | PARAM | Generic "guarded workflow files must match origin/main, skip on main-cut branch" mechanism | guarded-workflow-file list, branch names |
| `guard:proposal-links` | PARAM | Generic orphan-doc (no inbound link) detector | proposals glob, search roots, excluded prefixes |
| `guard:audit-tool-docs` | PORTABLE | This IS the generic Layer-2 audit-tool-registry mechanism (registered tool ↔ non-stub WHY.md); registry contents are swappable data | — |
| `guard:gate-parity` | PARAM | Generic local-quality-chain-vs-CI-job-set diff/allowlist mechanism | CI yaml path/job name, package.json script key, allowlists |
| `lines:check` / `lines:update-baseline` | PARAM | Generic glob-measured line/byte budget ratchet with baseline+grace-margin, reusable for any "always-loaded context" surface | surface globs, grace margins, baseline numbers |
| `health` | PORTABLE | Layer-5 aggregator is a pure loop over `pnpm ops <tool> --summary` subprocesses parsing a generic JSONL contract | tool roster (light param, doesn't change mechanism) |

**Borderline:**
- `memory:anonymize-goldens` — the anonymization/swap-map engine is product-agnostic PII redaction, but it only exists to serve the Tzurot-specific golden-mining pipeline whose output shape it consumes.
- `cache:prefix-diff` — the prompt-prefix-divergence comparison algorithm is reusable for any LLM app doing provider prompt caching, but its data-fetch layer is bound to Tzurot's diagnostic-log schema and Discord identifiers.
- `release:premigrate` — the destructive-migration-shape heuristic is generic Postgres static analysis; the apply step is fully bound to the Prisma-driver-adapter + Railway execution stack.
- `dev:deferred-refs` — the file/text cross-reference algorithm is generic, but it exists only because of Tzurot's specific choice of a markdown `tracker/` task store (Backlog.md CLI); a project on GitHub Issues would need a different data source, not just a config swap.
- `test:generate-schema` — the SQL-harvesting mechanism is stack-generic for any Prisma+PGLite project, but "Prisma+PGLite for component tests" is itself a fairly specific architectural choice rather than a universal one.

Total rows: 78
# doc-64 Phase 0 collation — slice: agents + root surfaces + husky + commitlint/lint-staged

| item | class | why (≤1 sentence) | param surface (if PARAM) |
|---|---|---|---|
| `.claude/agents/opus-implementer.md` — frontmatter (name/description/model/effort + probe comment) | PARAM | Worker-agent-declaration shape portable; model choice, effort tier, probe note session-specific | model id, effort tier, probe annotations |
| `.claude/agents/opus-implementer.md` — Execution contract | PORTABLE | "Execute spec exactly; flag ambiguity; never commit beyond spec" is general orchestrator/worker division | — |
| `.claude/agents/opus-implementer.md` — Verification contract | PARAM | Sequential-verification-floor is general; concrete commands (`pnpm --filter`, `typecheck:spec`) are Tzurot's | package-manager/test-runner command shape |
| `.claude/agents/opus-implementer.md` — Report contract | PORTABLE | Verbatim output, deviations flagged, git state confirmed — general reporting discipline | — |
| `CLAUDE.md` — title + description | BOUND | Names the product | — |
| `CLAUDE.md` — Session Start pointer | PARAM | Session-bootstrap mechanism general; file names Tzurot's | state/backlog file names |
| `CLAUDE.md` — Commands | PARAM | Onboarding section general; invocations Tzurot's | package manager + script names |
| `CLAUDE.md` — Project Structure | BOUND | Literal directory tree — architecture, not process | — |
| `CLAUDE.md` — Key Rules index | PARAM | Numbered-rules-directory-with-index is portable structure; filenames Tzurot's | rule-file naming/index convention |
| `CLAUDE.md` — Git Workflow | PARAM | Rebase-only policy adoptable; branch names + gh invocations Tzurot's | base-branch names, merge policy |
| `CLAUDE.md` — Post-Mortems table | PARAM | In-file catastrophic-failure log mechanism general; rows are Tzurot incidents | table schema reusable, rows not |
| `CLAUDE.md` — Compaction Instructions | PARAM | Preserve-list checklist broadly reusable; two bullets cite Tzurot files/skills | cited file/skill names |
| `BACKLOG.md` — three-surface framing | PARAM | HOT/COLD/queryable-store info-architecture general; surfaces Tzurot's | surface names/paths |
| `BACKLOG.md` — HOT table | PARAM | "Exactly what loads at session start" pattern; paths and caps Tzurot's | file paths, caps |
| `BACKLOG.md` — tracker store section | PARAM (borderline) | Query-don't-load task-pool discipline; tied to Backlog.md CLI + label taxonomy | CLI binding, label vocabulary |
| `BACKLOG.md` — COLD table | PARAM | Same mechanism | file paths |
| `BACKLOG.md` — filing decision-tree | PARAM | Admission bar + granularity ladder genuinely general; destinations Tzurot's | destination names, caps |
| `BACKLOG.md` — Staleness (three exits) | PORTABLE | done/obsolete/ruled-out, never calendar-deleted — pure process philosophy | — |
| `BACKLOG.md` — Conventions | PARAM | Tag+lint-gate shape general; specifics Tzurot's | tag set, direct-commit list, gate command |
| settings.json — core-tool allow list | PORTABLE | Baseline allowlist any project wants | — |
| settings.json — WebFetch domains + council MCP | PARAM | Domain allowlisting general; domains/server names Tzurot's | domain list, MCP names |
| settings.json — enableAllProjectMcpServers:false | PORTABLE | Generic security-posture flag | — |
| `.husky/commit-msg` — session-URL block | PORTABLE (borderline) | Blocking session URLs from commits — general Claude Code public-repo safeguard | — |
| `.husky/commit-msg` — commitlint + exit-code preservation | PORTABLE | General shell-hook correctness | — |
| `.husky/pre-commit` — stale index.lock cleanup | PORTABLE | Generic git hygiene | — |
| `.husky/pre-commit` — lint-staged | PORTABLE | Universal Node pattern | — |
| `.husky/pre-commit` — prisma→pglite regen-and-stage | PARAM | Detect-generator-input→regen→stage mechanism general; specifics Tzurot's | schema path, regen command, output path |
| `.husky/pre-commit` — route-manifest codegen regen-and-stage | PARAM | Same mechanism | manifest glob, codegen command |
| `.husky/pre-commit` — temporal-markers guard | PARAM | Diff-content-policy scan + env override general; regex encodes Tzurot rule | banned-pattern regex, env var, comment-prefix table |
| `.husky/pre-commit` — advisory guards (claim-shape, deferred-refs) | PARAM | Non-blocking informational guard pattern general | script/command names |
| `.husky/pre-commit` — dangerous-migration index guard | PARAM (borderline) | Don't-drop-load-bearing-index pattern portable; two index names hardcoded twice | protected-index list, migration dir |
| `.husky/pre-commit` — lastUpdated frontmatter auto-bump | PARAM | Freshness-stamp sync mechanism reusable by any plugin repo | watched paths, field name |
| `.husky/pre-push` — branch-naming guard | PARAM | type/description validation general; names Tzurot's | protected branches, WIP prefix, type list |
| `.husky/pre-push` — deferred-refs surfacing | PARAM | Informational backlog-touch surfacing | command name |
| `.husky/pre-push` — docs-only fast path | PARAM | Skip-expensive-checks-on-docs-push pattern general; cheap checks Tzurot tools | extension list, check commands |
| `.husky/pre-push` — workflow-sync guard | PARAM | Trunk-identical-CI-file check is portable release-safety; files/exception Tzurot's | protected file list, branch exception |
| `.husky/pre-push` — LOW_RESOURCE_MODE | PARAM | Constrained-env throttling general; values tuned to Steam Deck | env var, concurrency/memory |
| `.husky/pre-push` — Turbo scoped build/lint/test | PARAM | Changed-package scoping general | tool + base-branch name |
| `.husky/pre-push` — typecheck:spec pass | PARAM | Separate test-file typecheck general | script name |
| `.husky/pre-push` — CPD advisory | PARAM | Duplication-as-warning general (jscpd) | command name |
| `.husky/pre-push` — duplicate-export check | PARAM | Same-name-export guard general; custom ops script | guard command |
| `.husky/pre-push` — dead-file check (knip:dead) | PARAM | Dead-code flag general (knip) | command name |
| `.husky/pre-push` — depcruise boundary check | PARAM | Graph-tool boundary enforcement general; wiring Tzurot's | command, cache path |
| `.husky/pre-push` — Python conditional checks | PARAM | Per-language conditional checks general; single service dir hardcoded | service path, command set |
| `commitlint.config.cjs` — dynamic scope-enum from workspace dirs | PARAM | Auto-derived scopes reusable technique | workspace dir names |
| `commitlint.config.cjs` — static root scopes | PARAM | Fixed cross-cutting scopes general pattern | scope list |
| `commitlint.config.cjs` — type-enum incl. `debug` | PARAM | Custom lifecycle type technique general; `debug` is Tzurot-authored | extra type + rationale |
| `commitlint.config.cjs` — rule relaxations | PORTABLE | Generic config | — |
| `.lintstagedrc.json` — full config | PORTABLE | Standard per-glob mapping, all generic | — |

**Borderline (awaiting orchestrator adjudication):**
- pre-commit dangerous-migration guard: mechanism portable, but as shipped closer to dead weight outside Tzurot than a config-driven check — PARAM vs BOUND judgment call.
- BACKLOG.md tracker-store section: possibly the most reusable AI-agent process idea in the slice, but inseparable in text from the Backlog.md CLI + label vocabulary — carry the CLI dependency or just the principle?
- commit-msg session-URL guard: only has teeth on a public repo — should repo-visibility be a config gate?

Total rows: 47 (rough split: ~11 PORTABLE / ~34 PARAM / 2 BOUND; 3 borderline)
