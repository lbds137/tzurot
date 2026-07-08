# Why `ux:literals` exists

## What

Counts raw user-facing message literals in `services/bot-client/src/commands/**` (non-test source) across two pattern classes — hand-written `❌`-prefixed strings and hand-written "please try again" invitations — and fails when the union count exceeds `baseline.total + graceMargin`. Companion command `ux:literals:update-baseline` is the sanctioned refresh path (run it when catalog adoption drops the count, so the ratchet floor follows adoption down).

## Why

The `ux/catalog` message layer (design: `docs/proposals/backlog/platform-portable-ux-design.md` §4.2) replaces ~300+ scattered inline literals with one intent-keyed vocabulary — consistency, a single emoji map, and the outcome-honesty rule (writes with unknown outcomes must never say "try again"; that invitation is how duplicate writes happen). Adoption is incremental across several PRs; without a regression brake, new code keeps adding raw literals faster than migration removes them and the migration never converges. This is the Phase-1 half of the design's two-stage enforcement: a cheap grep-class ratchet now, replaced by an AST-based ESLint rule in Phase 3 (at which point this tool retires — one mechanism at steady state, not two).

## Threshold rationale

Baseline-and-hold at the measured count, `graceMargin: 10`. The margin absorbs a legitimate straggler or two in an unmigrated command between refreshes — it is NOT headroom for new raw literals (new messages should come from the catalog from day one). Two patterns instead of the audit's three candidates: "Failed to" is dominated by internal `logger.*` lines (not user-facing), and its genuine user-facing instances co-occur with the `❌` prefix already counted — including it would trade measurement quality for double-counting.

## Decay check

The canary fixture (`test-fixtures/audit-canaries/ux-literals/`) contains a deliberate-violation commands tree with a zero baseline; the canary test asserts the tool reports `status: 'fail'` with findings > 0. The hollow-measurement guard (zero files scanned → loud failure, never a 0-literal pass) protects against the scan root being moved/renamed. `configHash` drift detection forces an explicit baseline refresh whenever the patterns, scan root, or impl version change. Retirement trigger: Phase 3's AST ESLint rule landing — delete this tool and its baseline in the same PR.
