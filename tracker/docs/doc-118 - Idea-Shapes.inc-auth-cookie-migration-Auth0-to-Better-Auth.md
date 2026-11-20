---
id: doc-118
title: 'Idea: Shapes.inc auth cookie migration (Auth0 to Better Auth)'
type: other
created_date: '2026-11-20T00:12:00Z'
---

## Why

shapes.inc migrated its auth library from `@auth0/nextjs-auth0` to Better Auth, so the
3-part rolling `appSession` cookie pair our `ShapesDataFetcher` reassembles no longer
exists. Untouched since intake (2026-04-22). The recent shapes-cookie work (401
re-authenticate on an undecryptable cookie) is the residual failure handling, not the
migration. This idea replaces the pointer the retired `BACKLOG.md` Inbox carried
(PR 2772 review). Note: TASK-259 (Shapes.inc resume-from-page for mid-job cookie
expiry) is the residual failure-handling work on the current cookie shape — a
different work item from this migration; see also TASK-267 for the shapes voice
import seam.

## What

Full proposal: `docs/proposals/backlog/shapes-inc-auth-cookie-migration.md` — cookie
identity and parsing only, no business logic; endpoint paths, response shapes, auth
model, status semantics and rate limits are unchanged upstream.

## Acceptance

`ShapesDataFetcher` parses the Better Auth session cookie against the live shapes.inc
format, verified against a captured cookie.


