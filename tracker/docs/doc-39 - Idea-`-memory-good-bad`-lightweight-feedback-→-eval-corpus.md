---
id: doc-39
title: 'Idea: `/memory good|bad` lightweight feedback → eval corpus'
type: other
created_date: '2026-07-28 11:11'
---

## `/memory good|bad` lightweight feedback → eval corpus

_Surfaced 2026-07-09 (correction slice). The architecture doc §3.6a names lightweight feedback (`/memory good|bad` or message reactions) that feeds the extraction eval corpus — distinct from the heavier `/memory correct|forget` curation._

When a user marks a fact (or a reply drawing on facts) good/bad, capture it as a labeled example that flows into the extraction golden corpus, closing the loop between real usage and the eval that gates prod-enable. **Scoping needed**: reaction vs slash-command surface; how a thumbs-down maps to a golden (is it a forget, a violation label, or a recall miss?); storage (a feedback table vs. appending to goldens); privacy (real user statements into a git-tracked corpus — same public-repo concern as the retrieval goldens). Depends on the correction slice (shipped) for the fact-selection surface.

