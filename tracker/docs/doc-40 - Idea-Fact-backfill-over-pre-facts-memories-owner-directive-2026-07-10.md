---
id: doc-40
title: 'Idea: Fact backfill over pre-facts memories (owner directive 2026-07-10)'
type: other
created_date: '2026-07-28 11:11'
---

## Fact backfill over pre-facts memories (owner directive 2026-07-10)

**COMMAND SHIPPED — PR #1574 (2026-07-10)**: `ops memory:backfill-facts` (windows from Postgres, deterministic jobIds, `budgetExempt` payload flag gating consume+refund symmetrically, priority 10 below live, skip-covered default, dry-run/limit canary path). Dev dry-run verified: 35,303 episodes → 6,200 windows. **Remaining**: dev canary → full dev run (doubles as the z.ai delay-path burn-in; ~1-3 days self-paced) → facts reach prod via db-sync (#1573 — prod never re-bills) → entry leaves the backlog when the dev run completes. Design history (gates, supersession of the no-bulk-re-extraction posture) in git.

**Decoupled ride-along, still filed**: `ops run --service <name>` enhancement — pull the named service's full Railway variable set (via `railway variables --json`), overlay the pgvector public `DATABASE_URL`, keep env validation + prod confirm gate. NOT load-bearing for the backfill after all (the Railway worker holds the keys; the command only reads DB + enqueues) — standalone nice-to-have for future probes needing service secrets locally; raw `railway run` covers it today but silently defaults to the linked env (no prod gate) and injects unresolvable internal hostnames.

