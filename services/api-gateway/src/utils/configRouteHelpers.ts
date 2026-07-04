/**
 * Config Route Helpers
 *
 * Shared utilities for the templated admin/user config CRUD route files
 * (e.g., admin/llm-config, admin/tts-config, and their user-side siblings).
 * Each helper follows the precedent set by configOverrideHelpers.ts:
 *
 * - Response-aware signatures: takes `res: Response`; on failure, sends the
 *   error response directly and returns a sentinel (null / false). Callers
 *   branch on the sentinel and return early.
 * - No Prisma generic gymnastics: helpers that need to read the DB take a
 *   `fetch` thunk so the caller keeps `findUnique`/`select` inference and
 *   the helper stays decoupled from the Prisma type system.
 */

import type { Response } from 'express';
import { z } from 'zod';
import {
  CONFIG_KINDS,
  DEFAULT_CONFIG_KIND,
  type ConfigKind,
} from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type EntityPermissions } from '@tzurot/common-types/utils/permissions';
import { sendError } from './responseHelpers.js';
import { sendZodError } from './zodHelpers.js';
import { ErrorResponses } from './errorResponses.js';

/**
 * Minimal logger surface used by the helpers. Defined structurally so callers
 * can pass any pino logger (or a test stub) without dragging the pino type
 * dependency through this file.
 */
interface MinimalLogger {
  warn: (obj: Record<string, unknown>, message: string) => void;
}

/**
 * Parse a request body against a Zod schema. On failure, sends a zod-shaped
 * validation error via sendZodError and returns null. On success returns the
 * parsed value.
 */
export function parseBodyOrSendError<T>(
  res: Response,
  schema: z.ZodType<T>,
  body: unknown
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    sendZodError(res, result.error);
    return null;
  }
  return result.data;
}

/** Zod schema for the optional `?kind=` config-kind query param. */
const ConfigKindQuerySchema = z.object({
  kind: z.enum(CONFIG_KINDS).default(DEFAULT_CONFIG_KIND),
});

/**
 * Parse the optional `?kind=` query param (`text` | `vision`), defaulting to
 * `text`. Lets the read / by-id config routes scope to a kind so the SAME
 * handler serves both — vision callers pass `?kind=vision`, everyone else gets
 * the text default (so existing callers are unchanged). On an invalid value
 * sends a Zod-shaped 400 and returns `null` (caller returns early); an absent
 * param resolves to the default, never null.
 */
export function parseConfigKindQuery(res: Response, query: unknown): ConfigKind | null {
  // `query ?? {}`: an absent query object means "no params" → the text default,
  // not a 400. Express always populates `req.query` (at least `{}`), but guard
  // the undefined case so the helper never rejects purely for a missing object.
  const result = ConfigKindQuerySchema.safeParse(query ?? {});
  if (!result.success) {
    sendZodError(res, result.error);
    return null;
  }
  return result.data.kind;
}

/** LIST-route `?kind=` schema that also accepts the `all` sentinel (both kinds). */
const ConfigKindOrAllQuerySchema = z.object({
  kind: z.enum([...CONFIG_KINDS, 'all'] as const).default(DEFAULT_CONFIG_KIND),
});

/**
 * Parse the optional `?kind=` query for LIST routes, additionally accepting the
 * `'all'` sentinel meaning "return BOTH kinds" (used by browse to fetch text +
 * vision in one call). Defaults to text so existing callers are unchanged. Only
 * list/browse handlers use this; the strict {@link parseConfigKindQuery} stays
 * for by-id / set / clear so those can never receive `'all'`.
 */
export function parseConfigKindQueryAllowAll(
  res: Response,
  query: unknown
): ConfigKind | 'all' | null {
  const result = ConfigKindOrAllQuerySchema.safeParse(query ?? {});
  if (!result.success) {
    sendZodError(res, result.error);
    return null;
  }
  return result.data.kind;
}

/**
 * Fetch a config row by id (caller supplies the typed thunk) and 404 if
 * absent. Unlike findGlobalConfigOrSendError, no isGlobal guard — user-side
 * routes gate on permissions (computeLlmConfigPermissions → canEdit / canDelete)
 * separately after the row is fetched, so the row's isGlobal value is not
 * load-bearing at this point.
 *
 * The fetch-thunk pattern preserves Prisma `select` inference at the call
 * site, same rationale as findGlobalConfigOrSendError.
 */
export async function findConfigOrSendNotFound<T>(
  res: Response,
  fetchRow: () => Promise<T | null>,
  notFoundResource: string
): Promise<T | null> {
  const row = await fetchRow();
  if (row === null) {
    sendError(res, ErrorResponses.notFound(notFoundResource));
    return null;
  }
  return row;
}

/** Operations governed by the isGlobal guard. Each maps to a scoped error wording. */
export type GlobalGuardOperation =
  'edit' | 'delete' | 'set as system default' | 'set as free tier default';

/**
 * Fetch a config row by id (caller supplies the typed thunk) and verify it is
 * a global config. On not-found → 404; on non-global → 400 with operation-scoped
 * wording. Returns the row on success, null on failure (error already sent).
 */
export async function findGlobalConfigOrSendError<T extends { isGlobal: boolean; kind?: string }>(
  res: Response,
  fetchRow: () => Promise<T | null>,
  options: {
    /** Resource name used by the not-found error (e.g., 'Config', 'TtsConfig'). */
    notFoundResource: string;
    /** Plural lowercase label used in guard wording (e.g., 'configs', 'TTS configs'). */
    resourceLabel: string;
    /** Operation being attempted — determines guard wording. */
    operation: GlobalGuardOperation;
    /**
     * When set, reject (as not-found) any row whose `kind` is present AND differs.
     * Gates the bare admin surface (no `?kind=`, which defaults to text) to text
     * rows: a vision config 404s unless the caller explicitly passes
     * `?kind=vision`, so the text surface can't accidentally edit / delete /
     * (un)default a vision row. The `kind !== undefined` leniency is a production
     * no-op (the column is NOT NULL with a default) — it only spares callers/tests
     * that don't select `kind`. Requires `kind` in the select.
     */
    requireKind?: ConfigKind;
  }
): Promise<T | null> {
  const row = await fetchRow();
  if (row === null) {
    sendError(res, ErrorResponses.notFound(options.notFoundResource));
    return null;
  }
  if (!row.isGlobal) {
    sendError(
      res,
      ErrorResponses.validationError(
        formatGlobalGuardMessage(options.operation, options.resourceLabel)
      )
    );
    return null;
  }
  if (
    options.requireKind !== undefined &&
    row.kind !== undefined &&
    row.kind !== options.requireKind
  ) {
    // A wrong-kind row is "not found" on this surface — don't reveal it exists elsewhere.
    sendError(res, ErrorResponses.notFound(options.notFoundResource));
    return null;
  }
  return row;
}

function formatGlobalGuardMessage(operation: GlobalGuardOperation, resourceLabel: string): string {
  switch (operation) {
    case 'edit':
      return `Can only edit global ${resourceLabel}`;
    case 'delete':
      return `Can only delete global ${resourceLabel}`;
    case 'set as system default':
      return `Only global ${resourceLabel} can be set as system default`;
    case 'set as free tier default':
      return `Only global ${resourceLabel} can be set as free tier default`;
  }
}

/**
 * Look up the admin user by Discord ID and return their internal UUID.
 * Used by admin-only routes that are behind requireOwnerAuth (not
 * requireProvisionedUser), so the internal UUID is not pre-attached to req.
 * On miss → logs and 403s with "Admin user not found in database".
 */
export async function findAdminUserOrSendError(
  res: Response,
  prisma: PrismaClient,
  discordUserId: string,
  logger: MinimalLogger
): Promise<{ id: string } | null> {
  // Direct discordId lookup is allowed here because admin routes are mounted
  // behind requireOwnerAuth — NOT requireProvisionedUser — so the internal
  // UUID is never attached to req via the provisioning middleware. The
  // X-User-Id header carries the Discord ID and we need the UUID for the
  // ownerId FK on the row about to be created. The no-restricted-syntax rule
  // that bans this pattern in `routes/**/*.ts` doesn't reach this file by
  // path, which is the right outcome — this helper is the canonical path.
  const adminUser = await prisma.user.findUnique({
    where: { discordId: discordUserId },
    select: { id: true },
  });

  if (adminUser === null) {
    logger.warn({ discordUserId }, 'Admin user not found in database');
    sendError(res, ErrorResponses.unauthorized('Admin user not found in database'));
    return null;
  }
  return adminUser;
}

/**
 * The subset of a config-service used for name-collision checks. Each
 * service implements this method with its own row and scope types; we only
 * care about the boolean `exists` flag.
 *
 * `postIsGlobal` is the 4th argument used by user-side update routes that
 * may promote a config to global — passing `true` widens the collision
 * check to cover the cross-user global namespace. Admin and create paths
 * omit it; the service defaults to `false`.
 */
interface NameExistsChecker<TScope> {
  checkNameExists(
    name: string,
    scope: TScope,
    excludeId?: string,
    postIsGlobal?: boolean,
    kind?: ConfigKind
  ): Promise<{ exists: boolean }>;
}

/**
 * Check whether a name collision exists in the given scope. On collision
 * sends a NAME_COLLISION error and returns false. On no-collision returns
 * true so callers can use it as a guard condition.
 *
 * Generic on `TScope` so admin routes (`{ type: 'GLOBAL' }`) and user routes
 * (`{ type: 'USER'; userId; discordId }`) share the same helper. The scope
 * is forwarded to the service unchanged.
 *
 * Message composition is the caller's responsibility — admin and user routes
 * benefit from different user-facing wording ("A global config named X
 * already exists" vs "You already have a config named X"), and centralizing
 * either shape here would force the other into awkward phrasing.
 */
export async function ensureNoNameCollision<TScope>(
  res: Response,
  service: NameExistsChecker<TScope>,
  options: {
    /** Candidate name being checked. */
    name: string;
    /** Service-defined scope object — forwarded unchanged. */
    scope: TScope;
    /** When editing an existing row, pass its id so the row's own current
     *  name doesn't count as a collision against itself. Omit on creates. */
    excludeId?: string;
    /** For user-side update paths only — set `true` when the post-update
     *  state would be `isGlobal: true`, so the check widens to the
     *  cross-user global namespace. Admin and create paths omit this. */
    postIsGlobal?: boolean;
    /** Config kind to scope the collision check to. Names are unique per
     *  `(kind, …)` (the partial-unique indexes), so a vision config named "X"
     *  must NOT collide with a text config named "X". Pass `body.kind` on
     *  create; omit (defaults text in the service) for text-only callers. */
    kind?: ConfigKind;
    /** Caller-provided message formatter. Receives `name` (so the caller
     *  doesn't have to capture it in closure) and returns the full
     *  user-facing message. */
    formatCollisionMessage: (name: string) => string;
  }
): Promise<boolean> {
  const { name, scope, excludeId, postIsGlobal, kind, formatCollisionMessage } = options;
  const nameCheck = await service.checkNameExists(name, scope, excludeId, postIsGlobal, kind);
  if (nameCheck.exists) {
    sendError(res, ErrorResponses.nameCollision(formatCollisionMessage(name)));
    return false;
  }
  return true;
}

/** Shape returned by shapeDeleteResponse — body + log fields for clean delete. */
export interface DeleteResponseShape {
  responseBody: { deleted: true } | { deleted: true; warning: string };
  logFields: Record<string, unknown>;
}

/**
 * Compose the response body and log-fields for a successful delete, omitting
 * `warning` from both when it is null. This keeps clean deletes producing
 * `{ deleted: true }` instead of `{ deleted: true, warning: null }`, and
 * avoids `warning: null` log noise on every routine delete.
 */
export function shapeDeleteResponse(
  warning: string | null,
  baseLogFields: Record<string, unknown>
): DeleteResponseShape {
  if (warning === null) {
    return {
      responseBody: { deleted: true },
      logFields: baseLogFields,
    };
  }
  return {
    responseBody: { deleted: true, warning },
    logFields: { ...baseLogFields, warning },
  };
}

/**
 * Attach the ownership/permission fields that the shared config-summary
 * contract (LlmConfigSummarySchema / TtsConfigSummarySchema) requires on every
 * config response.
 *
 * The admin/global config routes are owner-gated (`requireOwnerAuth`), so the
 * caller always "owns" the global config and has full edit/delete rights —
 * these fields are therefore constant rather than per-user computed. They must
 * still be emitted: the response schema marks `isOwned` and `permissions` as
 * required, and a config body that omits them fails response validation at the
 * typed-client boundary. Emitting them here keeps the gateway response honest
 * against the declared contract instead of relying on the consumer to patch
 * them in after the fetch.
 */
export function withAdminOwnership<T>(
  formatted: T
): T & { isOwned: true; permissions: EntityPermissions } {
  return { ...formatted, isOwned: true, permissions: { canEdit: true, canDelete: true } };
}
