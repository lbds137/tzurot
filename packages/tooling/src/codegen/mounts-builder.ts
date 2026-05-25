/**
 * Pure builder for the server-side mounts.ts file.
 *
 * Generates one `mount<Audience>Routes(app, deps)` function per
 * audience. Each function applies audience-level middleware at the
 * prefix and mounts each route's handler at the audience-relative
 * path. Per-route `requiresProvisionedUser: true` adds the
 * `requireProvisionedUser(deps.prisma)` middleware to that route only.
 *
 * Design notes:
 *
 *   - **Wiring shape**: `app.<method>('/api/<audience>/<path>',
 *     ...middleware, handle<RouteId>(deps))`. The handler factory takes
 *     a shared `RouteDeps` parameter (defined in
 *     services/api-gateway/src/routes/routeDeps.ts); each handler
 *     dot-accesses the specific deps it needs.
 *
 *   - **Audience-prefix middleware**: applied per-route rather than at
 *     a prefix-level `app.use()`. This keeps per-route flags like
 *     `requiresProvisionedUser` composable — some `acceptsSubject`
 *     routes (e.g., admin diagnostic GETs lifted to user audience)
 *     specifically should NOT have `requireProvisionedUser`.
 *
 *   - **Handler path resolution**: the generator doesn't know where
 *     each handler file lives. Callers pass a `handlerPathFor`
 *     callback that returns the relative import path for a given
 *     route id. This decouples the generator from the api-gateway
 *     file layout and makes unit-testing trivial.
 *
 *   - **Service-auth (`requireServiceAuth`)** is applied globally in
 *     `services/api-gateway/src/index.ts` before any mount call, so
 *     the generator does NOT emit it per route. Adding it per-route
 *     would be redundant and would also break the audience-prefix
 *     skip cases (health check, avatars, exports).
 */

import type { Audience, RouteDef } from '@tzurot/common-types';
import { AUTOGEN_HEADER } from './header.js';

/** Maps a route id to its relative import path from `_generated/`. */
export type HandlerPathResolver = (routeId: string) => string;

export interface MountsBuildOptions {
  /** Routes grouped by their audience (internal / admin / user). */
  readonly routesByAudience: Readonly<Record<Audience, Record<string, RouteDef>>>;
  /** Returns the import path for a given route id's handler. */
  readonly handlerPathFor: HandlerPathResolver;
}

/**
 * Emit the full mounts.ts source string.
 */
export function buildMountsFile(options: MountsBuildOptions): string {
  const { routesByAudience, handlerPathFor } = options;

  const allRoutes = [
    ...Object.values(routesByAudience.internal),
    ...Object.values(routesByAudience.admin),
    ...Object.values(routesByAudience.user),
  ];

  const sections: string[] = [
    AUTOGEN_HEADER,
    buildImports(allRoutes, handlerPathFor),
    '',
    buildMountFunction({
      name: 'mountInternalRoutes',
      audience: 'internal',
      routes: routesByAudience.internal,
      audienceMiddleware: [],
    }),
    '',
    buildMountFunction({
      name: 'mountAdminRoutes',
      audience: 'admin',
      routes: routesByAudience.admin,
      audienceMiddleware: ['requireUserAuth()', 'requireOwnerAuth()'],
    }),
    '',
    buildMountFunction({
      name: 'mountUserRoutes',
      audience: 'user',
      routes: routesByAudience.user,
      audienceMiddleware: ['requireUserAuth()'],
    }),
    '',
  ];

  return sections.join('\n');
}

function buildImports(allRoutes: RouteDef[], handlerPathFor: HandlerPathResolver): string {
  // The two hardcoded import paths below (`../../services/AuthMiddleware.js`
  // and `../routeDeps.js`) assume the generated file lives at
  // `services/api-gateway/src/routes/_generated/mounts.ts`. Mirrors the
  // HandlerPathResolver JSDoc constraint. If the CLI is wired to emit
  // elsewhere, update these paths in lockstep.
  const handlerImports = allRoutes
    .map(r => `import { handle${pascalCase(r.id)} } from '${handlerPathFor(r.id)}';`)
    .join('\n');

  // Emit only the middleware symbols actually referenced by the
  // generated mount calls — the root tsconfig has `noUnusedLocals:
  // true` and the generated file is in scope for `tsc`. Importing
  // unused middleware would fail the build (ESLint disable in the
  // file header doesn't help here — the TypeScript compiler runs
  // before ESLint and emits its own diagnostics).
  const needsUserAuth = allRoutes.some(r => r.audience === 'admin' || r.audience === 'user');
  const needsOwnerAuth = allRoutes.some(r => r.audience === 'admin');
  // Defense-in-depth: gate on audience even though the manifest
  // invariant test enforces requiresProvisionedUser only on user
  // routes. If that test ever weakens, the codegen still produces a
  // consistent file rather than emitting requireProvisionedUser on
  // an admin/internal mount.
  const needsProvisionedUser = allRoutes.some(
    r => r.audience === 'user' && r.requiresProvisionedUser === true
  );

  const mwSymbols = [
    needsOwnerAuth ? '  requireOwnerAuth,' : null,
    needsProvisionedUser ? '  requireProvisionedUser,' : null,
    needsUserAuth ? '  requireUserAuth,' : null,
  ].filter((line): line is string => line !== null);

  const mwImport =
    mwSymbols.length > 0
      ? [`import {`, ...mwSymbols, `} from '../../services/AuthMiddleware.js';`].join('\n')
      : null;

  // Separator + handler block only when there are routes — emitting the
  // blank-line separator unconditionally adds spurious trailing blanks
  // to the output when the manifest is empty, which a future byte-level
  // drift check would flag as a meaningless diff.
  const importLines = [
    `import type { Express } from 'express';`,
    mwImport,
    `import type { RouteDeps } from '../routeDeps.js';`,
    handlerImports.length > 0 ? '' : null,
    handlerImports.length > 0 ? handlerImports : null,
  ].filter((line): line is string => line !== null);

  return importLines.join('\n');
}

interface MountFunctionOptions {
  readonly name: string;
  readonly audience: Audience;
  readonly routes: Record<string, RouteDef>;
  /** Middleware applied to every route at this audience (e.g. `['requireUserAuth()']`). */
  readonly audienceMiddleware: string[];
}

function buildMountFunction(options: MountFunctionOptions): string {
  const { name, audience, routes, audienceMiddleware } = options;
  const prefix = pathPrefixForAudience(audience);
  const entries = Object.values(routes);

  if (entries.length === 0) {
    return [
      `export function ${name}(_app: Express, _deps: RouteDeps): void {`,
      `  // No routes declared for this audience yet.`,
      `}`,
    ].join('\n');
  }

  const body = entries.map(route => buildMountCall(route, prefix, audienceMiddleware)).join('\n');

  return [`export function ${name}(app: Express, deps: RouteDeps): void {`, body, `}`].join('\n');
}

function buildMountCall(route: RouteDef, prefix: string, audienceMiddleware: string[]): string {
  const path = `${prefix}${route.path}`;
  const handlerCall = `handle${pascalCase(route.id)}(deps)`;

  const middleware = [...audienceMiddleware];
  if (route.audience === 'user' && route.requiresProvisionedUser === true) {
    middleware.push('requireProvisionedUser(deps.prisma)');
  }

  const mwArgs = middleware.length > 0 ? `${middleware.join(', ')}, ` : '';
  return `  app.${route.method}('${path}', ${mwArgs}${handlerCall});`;
}

/**
 * Audience-to-URL-prefix mapping. Duplicated from method-builder.ts
 * (intentional — keeps each builder self-contained and avoids a
 * cross-import that would couple the two generators).
 */
function pathPrefixForAudience(audience: Audience): string {
  switch (audience) {
    case 'internal':
      return '/api/internal';
    case 'admin':
      return '/api/admin';
    case 'user':
      return '/api/user';
  }
}

/**
 * Convert a camelCase route id to PascalCase for the handler name.
 * `getRecentDiagnostics` → `GetRecentDiagnostics`.
 *
 * Assumes route ids are camelCase (the manifest convention enforced by
 * the per-audience invariant tests in `routes/*.test.ts`). For
 * kebab-case or snake_case input this would produce broken handler
 * names — `get-timezone` → `Get-timezone`, not `GetTimezone`. Don't
 * introduce non-camelCase route ids without first generalizing this
 * helper.
 */
function pascalCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
