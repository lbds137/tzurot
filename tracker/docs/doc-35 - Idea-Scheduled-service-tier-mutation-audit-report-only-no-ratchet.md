---
id: doc-35
title: 'Idea: Scheduled service-tier mutation audit (report-only, no ratchet)'
type: other
created_date: '2026-07-28 11:11'
---

## Scheduled service-tier mutation audit (report-only, no ratchet)

Per-PR mutation testing on the three services is adjudicated non-viable (projection from five measured packages: ~0.35 mutants/src-line → ai-worker ~13k, api-gateway ~10k, bot-client ~22k mutants ≈ 30–70+ min per run). If service-tier test-effectiveness measurement is ever wanted, the shape is a WEEKLY scheduled report-only Stryker run riding the existing audit-cron infra (Discord thread delivery, JSONL summary line), trend-only — no baseline, no gate, no per-PR cost. Prerequisite: verify a full service run completes on a CI runner at all (timeout ceilings), and consider `--mutate` scoping to `src/services/**` hot paths if not. Filed 2026-07-06 at Stryker candidate-1 close-out; promote if a service ships a test-gap-shaped bug that mutation would have caught.

