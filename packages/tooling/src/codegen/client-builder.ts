/**
 * Pure builder for generated client class source files.
 *
 * Composes the AUTOGEN_HEADER, common imports, class declaration, and
 * generated method bodies into a single string. Three flavors share most
 * of the structure — the differences are constructor parameters and
 * which routes are emitted.
 */

import type { Audience, RouteDef } from '@tzurot/clients';

import { AUTOGEN_HEADER } from './header.js';
import { type ClientFlavor, buildMethod, pathPrefixForAudience } from './method-builder.js';

export interface ClientBuildOptions {
  /** 'ServiceClient' | 'OwnerClient' | 'UserClient' — used as class name. */
  className: string;
  /** Flavor selects header behavior + constructor params (see buildMethod). */
  flavor: ClientFlavor;
  /** Which audience this client serves. Determines URL prefix. */
  audience: Audience;
  /** Routes to emit methods for, keyed by route ID. */
  routes: Record<string, RouteDef>;
}

/**
 * Build the full client-class source string for one flavor.
 */
export function buildClientClass(options: ClientBuildOptions): string {
  const { className, flavor, audience, routes } = options;

  const prefix = pathPrefixForAudience(audience);
  const methodEntries = Object.values(routes);
  const methods = methodEntries
    .map(r => buildMethod(r, { flavor, pathPrefix: prefix }))
    .join('\n\n');

  return [
    AUTOGEN_HEADER,
    buildImports(flavor, routes),
    '',
    buildOptionsInterface(className, flavor),
    '',
    buildClassDecl(className, flavor),
    methods,
    '}',
    '',
  ].join('\n');
}

function buildImports(flavor: ClientFlavor, routes: Record<string, RouteDef>): string {
  const hasAcceptsSubject = Object.values(routes).some(r => r.acceptsSubject === true);

  // Intra-package symbols (transport, manifest, route types) import via
  // relative paths rather than the `@tzurot/clients` index to avoid a
  // self-import cycle: the package index re-exports the generated classes
  // themselves. Cross-package symbols (GatewayUser) import from the deep
  // `@tzurot/common-types/types/gateway-context` subpath (the root barrel is
  // being retired) — a one-way dependency, no cycle.
  const transportSymbols: string[] = ['callGateway', 'type GatewayResult'];
  const manifestSymbols: string[] = ['ROUTE_MANIFEST'];
  const typeSymbols: string[] = [];

  if (flavor === 'owner' || flavor === 'user') {
    typeSymbols.push('type ActorDiscordId');
  }
  if ((flavor === 'owner' || flavor === 'user') && hasAcceptsSubject) {
    typeSymbols.push('type SubjectDiscordId');
  }

  const lines: string[] = [`import { z } from 'zod';`];

  lines.push(`import { ${transportSymbols.join(', ')} } from '../transport.js';`);
  lines.push(`import { ${manifestSymbols.join(', ')} } from '../../routes/manifest.js';`);
  if (typeSymbols.length > 0) {
    lines.push(`import { ${typeSymbols.join(', ')} } from '../../routes/types.js';`);
  }
  if (flavor === 'user') {
    lines.push(`import type { GatewayUser } from '@tzurot/common-types/types/gateway-context';`);
  }

  lines.push('');
  lines.push(buildQueryHelper());
  return lines.join('\n');
}

function buildOptionsInterface(className: string, flavor: ClientFlavor): string {
  const fields = [
    `  /** Full gateway base URL, e.g. https://api-gateway.example.com. */`,
    `  baseUrl: string;`,
    `  /** Shared service secret (sent as X-Service-Auth). */`,
    `  serviceSecret: string;`,
  ];

  if (flavor === 'owner' || flavor === 'user') {
    fields.push(
      `  /** Discord ID of the actor making the call (the bot owner / the user). */`,
      `  actor: ActorDiscordId;`
    );
  }
  if (flavor === 'user') {
    fields.push(
      `  /** Full Discord user context for user-context headers. */`,
      `  user: GatewayUser;`
    );
  }

  return [`export interface ${className}Options {`, ...fields, `}`].join('\n');
}

function buildClassDecl(className: string, flavor: ClientFlavor): string {
  const fields = [
    `  private readonly baseUrl: string;`,
    `  private readonly serviceSecret: string;`,
  ];
  const ctorAssigns = [
    `    this.baseUrl = options.baseUrl;`,
    `    this.serviceSecret = options.serviceSecret;`,
  ];

  if (flavor === 'owner' || flavor === 'user') {
    fields.push(`  readonly actor: ActorDiscordId;`);
    ctorAssigns.push(`    this.actor = options.actor;`);
  }
  if (flavor === 'user') {
    fields.push(`  readonly user: GatewayUser;`);
    ctorAssigns.push(`    this.user = options.user;`);
  }

  return [
    `export class ${className} {`,
    ...fields,
    '',
    `  constructor(options: ${className}Options) {`,
    ...ctorAssigns,
    `  }`,
    '',
  ].join('\n');
}

/**
 * Inline query-string helper used by generated methods. Kept inside the
 * generated file (vs. importing from common-types) so the file is fully
 * self-contained — handy when reading the generated source in isolation.
 */
function buildQueryHelper(): string {
  return [
    `function buildQueryString(entries: Array<[string, string | undefined]>): string {`,
    `  const defined = entries.filter((e): e is [string, string] => e[1] !== undefined);`,
    `  if (defined.length === 0) return '';`,
    `  const qs = new URLSearchParams();`,
    `  for (const [k, v] of defined) qs.set(k, v);`,
    `  return '?' + qs.toString();`,
    `}`,
  ].join('\n');
}
