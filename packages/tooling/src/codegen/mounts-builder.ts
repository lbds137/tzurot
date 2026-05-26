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
import { capitalizeFirst } from './string-utils.js';

/** Maps a route id to its relative import path from `_generated/`. */
export type HandlerPathResolver = (routeId: string) => string;
/** Maps a route id to the symbol name to import (default: `handle{PascalCase}`). */
export type HandlerExportNameResolver = (routeId: string) => string;

export interface MountsBuildOptions {
  /** Routes grouped by their audience (internal / admin / user). */
  readonly routesByAudience: Readonly<Record<Audience, Record<string, RouteDef>>>;
  /** Returns the import path for a given route id's handler. */
  readonly handlerPathFor: HandlerPathResolver;
  /**
   * Returns the export name for a given route id. Optional — defaults to
   * `handle{PascalCase(id)}`. Override when a route shares its handler
   * with a sibling route (e.g. `getChannelSettings` uses
   * `handleGetUserChannel`).
   */
  readonly handlerExportNameFor?: HandlerExportNameResolver;
}

function defaultExportName(routeId: string): string {
  return `handle${capitalizeFirst(routeId)}`;
}

/**
 * Emit the full mounts.ts source string.
 */
export function buildMountsFile(options: MountsBuildOptions): string {
  const { routesByAudience, handlerPathFor } = options;
  const handlerExportNameFor = options.handlerExportNameFor ?? defaultExportName;

  const allRoutes = [
    ...Object.values(routesByAudience.internal),
    ...Object.values(routesByAudience.admin),
    ...Object.values(routesByAudience.user),
  ];

  // File-level header note about routing ordering — readers landing on
  // the generated file in isolation get one explanation up-front instead
  // of seeing the same comment repeated inside every `mount*Routes` body.
  const orderingNote = [
    '/**',
    ' * Route registration order:',
    ' *',
    ' * `sortRoutesForExpress` in mounts-builder.ts sorts routes ascending by',
    ' * `:param` segment count, so literal paths (e.g., `/voices/clear`)',
    ' * register before parameterized siblings (e.g., `/voices/:provider/:voiceId`).',
    ' * Express matches in registration order, so this guarantees the most',
    ' * specific path wins for any (method, parent) shape collision.',
    ' */',
  ].join('\n');

  const sections: string[] = [
    AUTOGEN_HEADER,
    orderingNote,
    '',
    buildImports(allRoutes, handlerPathFor, handlerExportNameFor),
    '',
    buildMountFunction({
      name: 'mountInternalRoutes',
      audience: 'internal',
      routes: routesByAudience.internal,
      audienceMiddleware: [],
      handlerExportNameFor,
    }),
    '',
    buildMountFunction({
      name: 'mountAdminRoutes',
      audience: 'admin',
      routes: routesByAudience.admin,
      audienceMiddleware: ['requireUserAuth()', 'requireOwnerAuth()'],
      handlerExportNameFor,
    }),
    '',
    buildMountFunction({
      name: 'mountUserRoutes',
      audience: 'user',
      routes: routesByAudience.user,
      audienceMiddleware: ['requireUserAuth()'],
      handlerExportNameFor,
    }),
    '',
  ];

  return sections.join('\n');
}

function buildImports(
  allRoutes: RouteDef[],
  handlerPathFor: HandlerPathResolver,
  handlerExportNameFor: HandlerExportNameResolver
): string {
  // The two hardcoded import paths below (`../../services/AuthMiddleware.js`
  // and `../routeDeps.js`) assume the generated file lives at
  // `services/api-gateway/src/routes/_generated/mounts.ts`. Mirrors the
  // HandlerPathResolver JSDoc constraint. If the CLI is wired to emit
  // elsewhere, update these paths in lockstep.
  // Dedupe by export name — two routes sharing a handler (e.g.
  // getChannelSettings + getUserChannel both → handleGetUserChannel) would
  // otherwise produce a duplicate `import { handleX }` line.
  const importsByName = new Map<string, string>();
  for (const r of allRoutes) {
    const name = handlerExportNameFor(r.id);
    if (!importsByName.has(name)) {
      importsByName.set(name, handlerPathFor(r.id));
    }
  }
  const handlerImports = [...importsByName.entries()]
    .map(([name, path]) => `import { ${name} } from '${path}';`)
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
  readonly handlerExportNameFor: HandlerExportNameResolver;
}

function buildMountFunction(options: MountFunctionOptions): string {
  const { name, audience, routes, audienceMiddleware, handlerExportNameFor } = options;
  const prefix = pathPrefixForAudience(audience);
  const entries = sortRoutesForExpress(Object.values(routes));

  if (entries.length === 0) {
    return [
      `export function ${name}(_app: Express, _deps: RouteDeps): void {`,
      `  // No routes declared for this audience yet.`,
      `}`,
    ].join('\n');
  }

  const body = entries
    .map(route => buildMountCall(route, prefix, audienceMiddleware, handlerExportNameFor))
    .join('\n');

  // Routing-order explanation lives in the file-level header comment
  // emitted by `buildMountsFile` (above) — single source instead of
  // repeating the note in every `mount*Routes` body.
  return [`export function ${name}(app: Express, deps: RouteDeps): void {`, body, `}`].join('\n');
}

/**
 * Sort routes so that more-specific paths register before less-specific ones
 * sharing the same (method, parent) bucket. Express matches in registration
 * order, so a parameterized segment like `/:personalityId` registered
 * earlier will swallow a sibling static segment like `/default` registered
 * later — `DELETE /tts-override/default` would hit `/:personalityId` with
 * `personalityId="default"` instead of the dedicated handler.
 *
 * Rule: for any two routes A and B that differ only at one segment (A's is
 * static, B's is a `:param`), A must register first. Implementation: count
 * `:param` segments per path and sort ascending — fewer parameterized
 * segments = more specific = registers first. Stable sort preserves the
 * manifest order within the same specificity bucket so the output is still
 * predictable diff-wise.
 *
 * Without this fix, the codegen would emit broken route ordering for at
 * least three known cases that the legacy hand-written routers documented
 * with `// /default routes MUST come before /:param` comments.
 *
 * **Assumption — same-param-count routes within an audience don't require
 * relative ordering.** The sort by param-count handles the static-vs-param
 * collision at a shared segment position. It does NOT handle a hypothetical
 * pair where both routes have `:param` at the same segment AND one needs
 * to register before the other (Express can't disambiguate such paths
 * regardless — the only signal is registration order). Two routes with
 * disjoint static segments at different positions (e.g.
 * `/persona/override/:slug` vs `/persona/:id/default`) don't collide at
 * all — their static segment positions diverge, so either order works.
 * If a future route pair triggers same-param-count shadowing, add a
 * secondary sort key (e.g. lexicographic static-segment first-occurrence
 * position) or reorder the manifest entries by hand.
 */
function sortRoutesForExpress(routes: RouteDef[]): RouteDef[] {
  return [...routes].sort((a, b) => paramSegmentCount(a.path) - paramSegmentCount(b.path));
}

function paramSegmentCount(path: string): number {
  return path.split('/').filter(seg => seg.startsWith(':')).length;
}

function buildMountCall(
  route: RouteDef,
  prefix: string,
  audienceMiddleware: string[],
  handlerExportNameFor: HandlerExportNameResolver
): string {
  const path = `${prefix}${route.path}`;
  const handlerCall = `${handlerExportNameFor(route.id)}(deps)`;

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
