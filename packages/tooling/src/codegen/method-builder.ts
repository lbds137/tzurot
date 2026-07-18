/**
 * Pure method-body builder for generated client classes.
 *
 * Takes one RouteDef and emits a TypeScript class-member declaration.
 * Generated methods reference the route's schemas through the central
 * ROUTE_MANIFEST registry (e.g. `ROUTE_MANIFEST.aiGenerate.output`)
 * rather than importing schemas by name — this means the codegen tool
 * does not need to know the original import identifier.
 */

import { z } from 'zod';
import { resolveQueryShape, type Audience, type RouteDef } from '@tzurot/clients';

/**
 * Detect whether a Zod schema is marked optional. `z.string()` is required,
 * `z.string().optional()` is optional. Defaulted schemas (`z.string().default(...)`)
 * are also treated as optional since the caller can omit them.
 *
 * Note: `z.ZodNullable` is intentionally NOT included. A nullable query string
 * means "the value may be null when sent" — not "the caller may omit the key".
 * Query-string transport encodes `null` differently from absence, so a
 * `nullable()` param still needs to be passed by the caller.
 */
function isOptionalZod(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}

/**
 * For a route's `query` map, return whether at least one entry is required
 * (used to decide if the entire `options` argument can be omitted).
 * Accepts either form of `RouteDef.query` (Record or ZodObject) via
 * `resolveQueryShape`.
 */
function hasRequiredQueryParam(query: RouteDef['query']): boolean {
  const shape = resolveQueryShape(query);
  if (shape === undefined) {
    return false;
  }
  return Object.values(shape).some(schema => !isOptionalZod(schema));
}

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

  const sigParams = buildSignatureParams({
    route,
    pathParamNames,
    hasInput,
    hasQuery,
    acceptsSubject,
  });

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
  const queryShape = resolveQueryShape(route.query);
  if (queryShape !== undefined) {
    for (const key of Object.keys(queryShape)) {
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
      `        'X-User-DisplayName': encodeURIComponent(this.user.displayName),`,
      // Boolean → 'true'/'false' on the wire; the gateway's requireUserAuth
      // rejects declared bots before any route handler runs.
      `        'X-User-Is-Bot': String(this.user.isBot),`
    );
  }

  const headersBlock =
    headerLines.length === 0 ? '' : `,\n      headers: {\n${headerLines.join('\n')}\n      }`;

  const bodyLine = hasInput ? `,\n      body: input` : '';

  // Per-route timeout override: when a manifest entry declares
  // timeoutMs (typically for slow operations that exceed the default
  // AUTOCOMPLETE budget of 2500ms), emit a `timeoutMs: <value>` line
  // so the transport uses it instead of falling back to the default.
  // Reading from ROUTE_MANIFEST keeps the codegen tool free of having
  // to embed the numeric value in the generated source.
  const timeoutLine =
    route.timeoutMs !== undefined ? `,\n      timeoutMs: ROUTE_MANIFEST.${id}.timeoutMs` : '';

  // -- Return-type annotation ----------------------------------------------

  const returnType = `Promise<GatewayResult<z.infer<typeof ROUTE_MANIFEST.${id}.output>>>`;

  // -- JSDoc block (semantic-intent tags from RouteDef.meta) ---------------

  const jsdocBlock = buildMetaJsdoc(route);

  // -- Compose --------------------------------------------------------------

  return [
    `${jsdocBlock}  async ${id}(${sigParams.join(', ')}): ${returnType} {`,
    queryStmt,
    `    return callGateway({`,
    `      baseUrl: this.baseUrl,`,
    `      serviceSecret: this.serviceSecret,`,
    `      method: '${httpMethod}',`,
    `      path: fullPath${headersBlock}${bodyLine},`,
    `      outputSchema: ROUTE_MANIFEST.${id}.output${timeoutLine},`,
    `    });`,
    `  }`,
  ].join('\n');
}

/** Surface RouteDef.meta as `@safeRead`/`@softDeleteAware`/`@idempotent`/`@atMostOnce` JSDoc on the generated method; empty string when no tags set. */
function buildMetaJsdoc(route: RouteDef): string {
  const lines: string[] = [];
  if (route.meta?.safeRead === true) {
    lines.push(
      `   * @safeRead Server-side has no observable mutation — safe to cache client-side.`
    );
  }
  if (route.meta?.softDeleteAware === true) {
    lines.push(
      `   * @softDeleteAware Resource has a soft-delete column; soft-deleted rows may be returned or filtered depending on handler semantics.`
    );
  }
  if (route.meta?.idempotent === true) {
    lines.push(
      `   * @idempotent Replaying the exact same request lands the same final state — safe to retry on network failure.`
    );
  }
  if (route.meta?.atMostOnce === true) {
    lines.push(
      `   * @atMostOnce Mutating + single-use-token guarded; replay yields a 4xx token-expired error even though the original mutation succeeded server-side. Retry layers must NOT auto-retry — surface the original error to the user only if no success response was observed.`
    );
  }
  return lines.length === 0 ? '' : `  /**\n${lines.join('\n')}\n   */\n`;
}

interface SignatureParamsInput {
  readonly route: RouteDef;
  readonly pathParamNames: readonly string[];
  readonly hasInput: boolean;
  readonly hasQuery: boolean;
  readonly acceptsSubject: boolean;
}

/**
 * Compose the method signature's parameter list (path params, input body,
 * options bag). Extracted from buildMethod to keep its cognitive complexity
 * down — same logic, just relocated.
 */
function buildSignatureParams(input: SignatureParamsInput): string[] {
  const { route, pathParamNames, hasInput, hasQuery, acceptsSubject } = input;
  const params: string[] = [];

  for (const p of pathParamNames) {
    params.push(`${p}: string`);
  }
  if (hasInput) {
    // z.input, not z.infer: request bodies are typed from the CALLER's side,
    // so schema defaults (e.g. alias scope) stay optional at the call site —
    // the gateway's parse applies them.
    params.push(`input: z.input<typeof ROUTE_MANIFEST.${route.id}.input>`);
  }
  if (hasQuery || acceptsSubject) {
    const optionsType = buildOptionsType(route, acceptsSubject);
    // If any query param is required (non-optional Zod schema), the entire
    // options bag must be required too — callers can't omit it. `subject`
    // is always optional, so it never forces the bag to be required by itself.
    const optionsRequired = hasRequiredQueryParam(route.query);
    params.push(optionsRequired ? `options: ${optionsType}` : `options: ${optionsType} = {}`);
  }

  return params;
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
  const shape = resolveQueryShape(route.query);
  if (shape !== undefined) {
    for (const [key, schema] of Object.entries(shape)) {
      // All query params are strings at the wire level; their narrower
      // typing lives in the route's Zod schema (validated server-side).
      // Required vs optional is derived from the schema's Zod wrapper:
      // `z.string()` is required (the server returns 400 on missing),
      // `z.string().optional()` or `z.string().default(...)` are optional.
      const marker = isOptionalZod(schema) ? '?' : '';
      fields.push(`${key}${marker}: string`);
    }
  }
  return `{ ${fields.join('; ')} }`;
}
