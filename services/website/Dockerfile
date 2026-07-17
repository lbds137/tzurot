# =============================================================================
# Website (tzurot.org) — Astro static site served by nginx.
#
# Builds from the REPO ROOT context (like the node services) because the legal
# pages' content source is docs/legal/ at the repo root — the site reads it in
# place via a content-collection glob loader, so the docs and the published
# pages can never drift.
#
# SITE_BRAND selects the deployment's identity at build time:
#   tzurot (default) — the prod site at tzurot.org
#   rotzot           — the dev-environment preview brand
# Railway passes service variables to Docker builds as build args.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build the static site
# -----------------------------------------------------------------------------
FROM node:25-slim AS builder

RUN npm install -g pnpm

WORKDIR /app

# Workspace manifests first for layer caching, then only what the site needs:
# its own source and the repo markdown it renders (every content.config.ts
# collection base must be copied here — a missing one fails the build loudly
# via the pages' getEntry throw).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/website ./services/website
COPY docs/legal ./docs/legal
COPY docs/guides ./docs/guides
COPY docs/commands.md ./docs/commands.md

RUN pnpm install --frozen-lockfile --filter @tzurot/website

ARG SITE_BRAND=tzurot
ENV SITE_BRAND=$SITE_BRAND
# Railway injects the service's public domain; the og:image URL resolves
# against it so the dev preview's per-build hashed banner asset unfurls from
# ITS OWN origin (the hash doesn't exist under tzurot.org). Empty locally →
# the layout falls back to the canonical origin.
ARG RAILWAY_PUBLIC_DOMAIN=""
ENV RAILWAY_PUBLIC_DOMAIN=$RAILWAY_PUBLIC_DOMAIN

RUN pnpm --filter @tzurot/website build

# -----------------------------------------------------------------------------
# Stage 2: Serve with nginx
# -----------------------------------------------------------------------------
FROM nginx:alpine AS runner

WORKDIR /app

COPY --from=builder /app/services/website/dist ./services/website/dist
COPY services/website/nginx.conf.template /etc/nginx/templates/default.conf.template

# Railway injects PORT; nginx's docker entrypoint envsubsts the template.
ENV PORT=8080
EXPOSE 8080
