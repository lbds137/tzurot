### Theme: Production Observability — perf metrics + distributed tracing

_Focus: continuous, deterministic performance insight + a foundation for scaling — the perf analog of the deterministic test-tooling theme above. Sibling to the "Railway Log Search DX" theme (that one is log-correlation; this is metrics + tracing)._

**Surfaced 2026-06-11 (user)** from the preset-PUT-timeout prod bug (production-issues.md): intermittent, **load-correlated** issues can't be reproduced in dev and aren't visible in event logs — we log _what happened_ but have ~no aggregated _performance_ signal.

**What we have**: pino structured logs → Railway; per-request `responseTime` _is_ logged by the gateway HTTP logger (that's how the preset bug was caught) but never aggregated/alerted. Railway exposes infra metrics but no app-level tracing.

**What's missing**: (1) **time-series metrics** — p50/p95/p99 latency per route, DB query duration, Prisma connection-pool utilization, BullMQ queue depth + job durations, error rates; (2) **distributed tracing** — per-request span breakdown (handler → DB → cache → response), i.e. THE tool that would show exactly where the preset PUT's 10s goes; (3) dashboards + alerting.

**Candidate approach (to web-research, NOT assume)**: OpenTelemetry (vendor-neutral Node SDK; auto-instrumentation for Express/Prisma/ioredis/BullMQ) → export to a backend. Evaluate backends on cost/effort: free-tier hosted (Grafana Cloud / Honeycomb / Axiom / Sentry Performance) vs self-hosted Grafana+Tempo+Prometheus. Prisma has built-in metrics + OTel hooks; `prom-client` for custom metrics.

**Interim (cheaper, directly cracks the preset bug)**: targeted timing instrumentation shipped to the **prod** llm-config PUT path — breakdown log: validate / DB write / cache-invalidation / total. Ship the probe to prod, read the runtime observation, then fix.

**Method (REQUIRED)**: actual web research — current OTel-on-Node maturity, auto-instrumentation coverage for our stack, real cost/effort of backends. **Outcome**: pick a LEAN starting point (likely OTel + auto-instrumentation + one free-tier backend, focused first on gateway request latency + Prisma query times), wire it, build a latency dashboard + a p99 alert.
