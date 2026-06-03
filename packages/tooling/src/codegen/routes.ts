/**
 * Route-codegen orchestrator.
 *
 * Reads ROUTE_MANIFEST from @tzurot/common-types, partitions by audience,
 * generates one client class per flavor (Service / Owner / User), and
 * either writes them to disk or compares them against the on-disk
 * versions (drift-detection mode for CI).
 *
 * Generated files land in:
 *   packages/clients/src/clients/_generated/service-client.ts
 *   packages/clients/src/clients/_generated/owner-client.ts
 *   packages/clients/src/clients/_generated/user-client.ts
 *
 * The mounts.ts generator (server-side) is a follow-up commit — it
 * depends on the api-gateway route-handler refactor to expose named
 * handler exports.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  ROUTE_MANIFEST,
  adminRoutes,
  internalRoutes,
  userRoutes,
  type Audience,
  type RouteDef,
} from '@tzurot/clients';

import { buildClientClass } from './client-builder.js';
import { buildMountsFile } from './mounts-builder.js';
import { handlerPathFor, handlerExportNameFor } from './handler-paths.js';
// Re-exported so callers can build mounts.ts via the same codegen entry.
export { buildMountsFile, type HandlerPathResolver } from './mounts-builder.js';

export interface CodegenRunOptions {
  /**
   * Workspace root (the monorepo root). Defaults to two levels up from
   * this file's installed location (`packages/tooling/dist/codegen/`).
   */
  rootDir?: string;
  /** If true, fail with a non-zero exit when files would change. */
  check?: boolean;
}

export interface CodegenRunResult {
  /** Files the run touched, mapped to their final source text. */
  files: Record<string, string>;
  /** In `check` mode, paths whose on-disk content differs from generated. */
  drifted: string[];
  /** True if every file matched on disk (drift-detection passed). */
  upToDate: boolean;
}

/**
 * Run the codegen tool against the live ROUTE_MANIFEST and either write
 * to disk or report drift.
 */
export function runCodegen(options: CodegenRunOptions = {}): CodegenRunResult {
  const rootDir = options.rootDir ?? defaultRootDir();
  const generated = generateAllClients();

  const fullPaths: Record<string, string> = {};
  for (const [relPath, src] of Object.entries(generated)) {
    fullPaths[resolve(rootDir, relPath)] = src;
  }

  const drifted: string[] = [];
  if (options.check === true) {
    for (const [path, expected] of Object.entries(fullPaths)) {
      const actual = readFileSafe(path);
      if (actual !== expected) drifted.push(path);
    }
    return { files: fullPaths, drifted, upToDate: drifted.length === 0 };
  }

  for (const [path, src] of Object.entries(fullPaths)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, src);
  }
  return { files: fullPaths, drifted: [], upToDate: true };
}

/**
 * Builds all generated files (3 client classes + server-side mounts.ts)
 * from the live manifest. Exposed for unit tests so they can call without
 * touching the filesystem.
 */
export function generateAllClients(): Record<string, string> {
  const internalByAud = filterByAudience(internalRoutes, 'internal');
  const adminByAud = filterByAudience(adminRoutes, 'admin');
  const userByAud = filterByAudience(userRoutes, 'user');

  return {
    'packages/clients/src/clients/_generated/service-client.ts': buildClientClass({
      className: 'ServiceClient',
      flavor: 'service',
      audience: 'internal',
      routes: internalByAud,
    }),
    'packages/clients/src/clients/_generated/owner-client.ts': buildClientClass({
      className: 'OwnerClient',
      flavor: 'owner',
      audience: 'admin',
      routes: adminByAud,
    }),
    'packages/clients/src/clients/_generated/user-client.ts': buildClientClass({
      className: 'UserClient',
      flavor: 'user',
      audience: 'user',
      routes: userByAud,
    }),
    'services/api-gateway/src/routes/_generated/mounts.ts': buildMountsFile({
      routesByAudience: {
        internal: internalByAud,
        admin: adminByAud,
        user: userByAud,
      },
      handlerPathFor,
      handlerExportNameFor,
    }),
  };
}

/**
 * Defensive double-check — the audience manifest files (internal.ts /
 * admin.ts / user/index.ts) already only contain routes of their own
 * audience (per their invariant tests), so this filter is a no-op in
 * practice. Kept to protect codegen from a future cross-imports
 * mistake that lands a wrong-audience route in a manifest file.
 */
function filterByAudience(
  routes: Record<string, RouteDef>,
  expected: Audience
): Record<string, RouteDef> {
  const out: Record<string, RouteDef> = {};
  for (const [id, r] of Object.entries(routes)) {
    if (r.audience === expected) out[id] = r;
  }
  return out;
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function defaultRootDir(): string {
  // Resolve from this file's directory up to the monorepo root.
  // dirname() lands in codegen/; four '..' steps reach root:
  //   codegen/ → dist/ → tooling/ → packages/ → root
  // The layout mirrors between src/ (dev) and dist/ (built), so the
  // same four steps work in either context.
  return resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
}

// Audit hook — count of routes per audience for the manifest-summary log.
export function summarizeManifest(): {
  internal: number;
  admin: number;
  user: number;
  total: number;
} {
  return {
    internal: Object.keys(internalRoutes).length,
    admin: Object.keys(adminRoutes).length,
    user: Object.keys(userRoutes).length,
    total: Object.keys(ROUTE_MANIFEST).length,
  };
}
