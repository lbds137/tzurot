---
paths:
  - 'packages/tooling/**'
  - '.claude/**'
  - '.husky/**'
  - '.github/**'
  - 'docs/reference/tooling/**'
  - 'scripts/**'
---

# Tooling Internals

Constraint surface for tooling, CI, and hook work — loads with the paths
above. The repo-wide decision-point triggers (secret rotation, security
advisories, gate/count traps, PR monitoring) stay in `05-tooling.md`.

## Codebase Analysis (Xray)

**Use `pnpm ops xray --summary` for an architectural overview** — full mode
lists every declaration. `--format md` is the LLM-consumable form;
`--suppressions` audits lint suppressions (`02-code-standards.md`).

## Mutation-Score Ratchet (Stryker)

`pnpm --filter @tzurot/<pkg> test:mutation` runs Stryker for one tracked
package; `pnpm ops mutation:check --summary` is the CI gate;
`pnpm ops mutation:update-baseline` is the only sanctioned refresh and needs a
fresh LOCAL report for EVERY tracked package. Tracked set: `MUTATED_PACKAGES`
(`packages/tooling/src/test/mutation-check.ts`). On a genuine score drop,
close the test gaps — never hand-edit the baseline. `ignoreStatic` stays OFF.
Services are not per-PR viable (30-70min); don't re-attempt without new data.
Adding a package: 4-step checklist in
`packages/tooling/src/test/mutation-check.WHY.md` § Onboarding.

## Test Audits

`pnpm ops test:audit` is the coverage ratchet (CI); `--update` is the only
sanctioned baseline refresh (run after closing coverage gaps). Bump
`TEST_AUDIT_IMPL_VERSION` (`packages/tooling/src/test/audit-version.ts`)
whenever measurement-affecting logic changes.

## CPD (Duplication Ratchet)

Bump `FILTER_IMPL_VERSION` (`packages/tooling/src/cpd/postFilter.ts`) when
the call-dominance heuristic changes. The metric, the tripped-ratchet options
and the never-raise-the-baseline rule: `02-code-standards.md` § Duplication,
Helpers, and the CPD Ratchet. Triage: `cpd:filtered --show-pairs 25`.

## Guards (Structural enforcement)

All guards hard-fail on findings. `guard:workflow-sync` covers ONLY `claude-code-review.yml` and `claude.yml` — those must land via a **main-cut** branch (a develop-first change silently disables claude-review on every PR until the next release); it self-skips on main-cut branches, `--base main` overrides. Other workflow files (`ci.yml`) may land via develop like any code change.

**After editing any hook, run its probe** — `guard:hook-probes` is the backstop, not the loop. Registry: `packages/tooling/src/dev/check-hook-probes-registry.ts`, bidirectional over `.claude/hooks/*.sh` AND `.husky/`. `develop-code-commit-guard.probe.sh` needs local `develop` and `main` branches (`git fetch origin develop:develop` on a fresh clone). A probe for a self-referential guard keeps its trigger pattern in the probe file as fixture data fed on stdin, never in the invoking command line.

`pnpm ops lines:check` keeps the instruction surfaces (`.claude/rules`
total — path-scoped 03/04/08 included, `CURRENT.md`, `.claude/skills` bodies)
within their LINE and BYTE budgets, and holds `CLAUDE.md` + `.claude/rules/*.md` under a hard 147,000-char
ceiling (Claude Code's instruction-file warning total, which no baseline
refresh can raise). The ceiling counts path-scoped files too — it over-states
what a fresh session carries, the conservative direction, on purpose.
`--breakdown` ranks every file worst-first by bytes — the
trim order the `/tzurot-doc-audit` economy pass consumes. `pnpm ops
lines:update-baseline` makes budget growth explicit; `--surface <name>` scopes
the write — the unscoped write ratchets a trimmed surface DOWN and a grown one
UP in the same commit.

## Backlog lint + digest

`pnpm ops backlog` (also `pnpm backlog:lint`) gates structural checks over
`now.md`, cross-references, and tracker task files; `pnpm ops backlog:digest`
is the session-start briefing and never gates. **The check list is
`backlogLint.ts`'s `problems` array, not any prose enumeration** — read the
array. Its warning naming an uncommitted file under `tracker/` is non-gating.

## Audit-tool infrastructure (Layers 1-3)

**Before adding a new audit tool, read [`docs/reference/audit-enforcement.md`](../../docs/reference/audit-enforcement.md)** — skipping its checklist fails CI in non-obvious ways.

## Model calls from tooling

GLM-family calls from tooling, pilots, evals and one-off scripts go through the owner's flat-rate Z.ai coding plan, never metered OpenRouter: the `zai-coding` provider, base URL `AI_ENDPOINTS.ZAI_CODING_BASE_URL` (`@tzurot/common-types/constants/ai`), a bare model id (`glm-5.3`), key `ZAI_CODING_API_KEY`. OpenRouter is only for families the plan doesn't carry (e.g. an Anthropic judge). The production extraction worker already runs on the plan; any summarizer mirrors it. Before any model-calling spec, add a Premise-ledger row for each call family's provider and cost model. The key is NOT in the local `.env`. Pull it into the shell at run time (`railway variables --environment development --service ai-worker --json | jq -r .ZAI_CODING_API_KEY`), and never write it to disk or print it. The plan endpoint honours `thinking: { type: 'disabled' }`; OpenRouter's GLM route rejects every reasoning-off form ("Reasoning is mandatory for this endpoint"). Council's TPM-sealed `~/.claude-mcp-servers/council/credentials/keys.cred` holds council's own, separate Z.ai key in an owner-approved store outside the never-write-to-disk rule above: don't "fix" it, and never overwrite it with Tzurot's dev key.
