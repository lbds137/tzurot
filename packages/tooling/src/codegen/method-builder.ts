/**
 * Pure method-body builder for generated client classes.
 *
 * Takes one RouteDef and emits a TypeScript class-member declaration.
 * Generated methods reference the route's schemas through the central
 * ROUTE_MANIFEST registry (e.g. `ROUTE_MANIFEST.aiGenerate.output`)
 * rather than importing schemas by name — this means the codegen tool
 * does not need to know the original import identifier.
 */

import type { Audience, RouteDef } from '@tzurot/common-types';

/**
 * Required by callers. Tells the builder how to construct headers and
 * whether to expose a `subject` parameter.
 *
 * - 'service': no actor (X-User-Id), no subject parameter
 * - 'owner':   X-User-Id from `this.actor`; optional subject when acceptsSubject
 * - 'user':    X-User-Id from `this.actor` + user-context headers
 */
export type ClientFlavor = 'service' | 'owner' | 'user';

export interface MethodBuildOptions {
  flavor: ClientFlavor;
  /** URL prefix mounted at the gateway, e.g. '/api/user'. */
  pathPrefix: string;
}

/**
 * Returns the ordered list of path-parameter names from an Express-style
 * path. `/persona/:id/default` → `['id']`.
 */
export function extractPathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map(m => m[1]).filter((v): v is string => v !== undefined);
}

/**
 * Audience-to-URL-prefix mapping. Matches the mount calls in
 * services/api-gateway/src/index.ts (post-cutover).
 */
export function pathPrefixForAudience(audience: Audience): string {
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
 * Emit the source text for one generated method.
 *
 * The output is a class-member declaration starting with `  async ` (2-space
 * indent baked in). The orchestrator joins these with `\n\n` between methods.
 */
export function buildMethod(route: RouteDef, options: MethodBuildOptions): string {
  const { flavor, pathPrefix } = options;
  const id = route.id;
  const httpMethod = route.method.toUpperCase();

  const pathParamNames = extractPathParams(route.path);
  const hasInput = route.input !== undefined;
  const hasQuery = route.query !== undefined;
  const acceptsSubject = route.acceptsSubject === true && flavor !== 'service';

  // -- Method-signature parameters -----------------------------------------

  const sigParams: string[] = [];
  for (const p of pathParamNames) {
    sigParams.push(`${p}: string`);
  }
  if (hasInput) {
    sigParams.push(`input: z.infer<typeof ROUTE_MANIFEST.${id}.input>`);
  }
  if (hasQuery || acceptsSubject) {
    const optionsType = buildOptionsType(route, acceptsSubject);
    sigParams.push(`options: ${optionsType} = {}`);
  }

  // -- Path interpolation --------------------------------------------------

  const interpolatedPath =
    pathParamNames.length === 0
      ? `'${pathPrefix}${route.path}'`
      : `\`${pathPrefix}${route.path.replace(
          /:(\w+)/g,
          (_m, name: string) => `\${encodeURIComponent(${name})}`
        )}\``;

  // -- Query-string assembly ----------------------------------------------

  const queryEntries: string[] = [];
  if (acceptsSubject) {
    queryEntries.push(`['userId', options.subject]`);
  }
  if (route.query !== undefined) {
    for (const key of Object.keys(route.query)) {
      queryEntries.push(`['${key}', options.${key}]`);
    }
  }

  const queryStmt =
    queryEntries.length === 0
      ? `    const fullPath = ${interpolatedPath};`
      : `    const fullPath = ${interpolatedPath} + buildQueryString([${queryEntries.join(', ')}]);`;

  // -- Header lines (flavor-dependent) ------------------------------------

  const headerLines: string[] = [];
  if (flavor === 'owner' || flavor === 'user') {
    headerLines.push(`        'X-User-Id': this.actor,`);
  }
  if (flavor === 'user') {
    headerLines.push(
      `        'X-User-Username': encodeURIComponent(this.user.username),`,
      `        'X-User-DisplayName': encodeURIComponent(this.user.displayName),`
    );
  }

  const headersBlock =
    headerLines.length === 0 ? '' : `,\n      headers: {\n${headerLines.join('\n')}\n      }`;

  const bodyLine = hasInput ? `,\n      body: input` : '';

  // -- Return-type annotation ----------------------------------------------

  const returnType = `Promise<GatewayResult<z.infer<typeof ROUTE_MANIFEST.${id}.output>>>`;

  // -- Compose --------------------------------------------------------------

  return [
    `  async ${id}(${sigParams.join(', ')}): ${returnType} {`,
    queryStmt,
    `    return callGateway({`,
    `      baseUrl: this.baseUrl,`,
    `      serviceSecret: this.serviceSecret,`,
    `      method: '${httpMethod}',`,
    `      path: fullPath${headersBlock}${bodyLine},`,
    `      outputSchema: ROUTE_MANIFEST.${id}.output,`,
    `    });`,
    `  }`,
  ].join('\n');
}

/**
 * Build the inline options object type for a method that has a query
 * parameter, a subject parameter, or both.
 *
 * Example output: `{ subject?: SubjectDiscordId; userId?: string }`
 */
function buildOptionsType(route: RouteDef, acceptsSubject: boolean): string {
  const fields: string[] = [];
  if (acceptsSubject) {
    fields.push(`subject?: SubjectDiscordId`);
  }
  if (route.query !== undefined) {
    for (const key of Object.keys(route.query)) {
      // All query params are strings at the wire level; their narrower
      // typing lives in the route's Zod schema (validated server-side).
      fields.push(`${key}?: string`);
    }
  }
  return `{ ${fields.join('; ')} }`;
}
