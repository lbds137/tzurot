/**
 * Helper for `/user/{llm,tts}-config` PUT routes that compute the name
 * a user-owned config should have after a mutation, accounting for the
 * "user-promoted globals get username-suffixed" UX pattern.
 *
 * **Why this exists**: a non-bot-owner user can promote their own config
 * to global via the preset/tts dashboard's `isGlobal` toggle. Without
 * normalization, they could create a config named "OfficialAdminVoice"
 * and toggle it global, confusing other users about provenance. Suffixing
 * the name with the user's username (`OfficialAdminVoice-bob`) makes
 * provenance visible everywhere the name renders.
 *
 * **Why route-level not service-level**: keeps `LlmConfigService.update()`
 * and `TtsConfigService.update()` agnostic of user identity. The route
 * already fetches the current config for ownership checks, so it has
 * `currentName` + `currentIsGlobal` available locally. The route also
 * has direct access to the Discord username via the `x-user-username`
 * header (already validated by `requireProvisionedUser` middleware).
 *
 * Bot-owner gets the original name unchanged (per `normalizeSlugForUser`'s
 * existing semantic). Same helper covers both LLM and TTS — names are
 * citext-unique strings on both sides, and the algorithm is identical.
 */

import type { Request } from 'express';
import { normalizeSlugForUser } from '@tzurot/common-types/utils/slugUtils';

interface PromotionContext {
  /** Current state of the config (from `service.getById`). */
  currentName: string;
  currentIsGlobal: boolean;
  /** Patch fields from the user's request (after Zod parse). */
  requestedName?: string;
  requestedIsGlobal?: boolean;
  /** Discord identity of the calling user (required for normalization). */
  discordId: string;
  discordUsername: string;
}

/**
 * Compute the effective name to write on a config update.
 *
 * Returns:
 * - The requested name unchanged if no promotion is happening
 * - The normalized name (suffixed with username) if the post-update
 *   state is `isGlobal: true` AND the user isn't the bot owner
 * - The bot owner's exact requested name if `isBotOwner` returns true
 *   (handled inside `normalizeSlugForUser`)
 *
 * `undefined` return means "don't touch the name" — matches the convention
 * the route handlers use: only set `data.name` if explicitly changing it.
 */
export function computeNameForPromotion(opts: PromotionContext): string | undefined {
  // Two trigger conditions for normalization:
  //   1. The user is actively promoting their config to global
  //      (currentIsGlobal=false → requestedIsGlobal=true)
  //   2. The user is explicitly renaming a config that is currently OR
  //      will-be global (requestedName is set AND post-state is global)
  //
  // Without this narrow trigger, ANY field update to a pre-existing global
  // config without a suffix would silently rename it (e.g. a description-
  // only edit on a legacy global preset would become a rename). That
  // surprised the user even though no name change was requested.
  const postIsGlobal = opts.requestedIsGlobal ?? opts.currentIsGlobal;
  const isPromotingToGlobal = !opts.currentIsGlobal && opts.requestedIsGlobal === true;
  const isExplicitRenameWhileGlobal = postIsGlobal && opts.requestedName !== undefined;

  if (!isPromotingToGlobal && !isExplicitRenameWhileGlobal) {
    // Pass through whatever the route already had: an explicit rename for
    // a non-global config, or `undefined` for a no-name update.
    return opts.requestedName;
  }

  const baseName = opts.requestedName ?? opts.currentName;
  const normalized = normalizeSlugForUser(baseName, opts.discordId, opts.discordUsername);

  // If normalization didn't actually change the name (bot owner, or already
  // suffixed), preserve the route's original intent: only emit `name` in the
  // patch when the user requested a rename.
  if (normalized === baseName) {
    return opts.requestedName;
  }

  return normalized;
}

/**
 * Apply the owner-driven name-promotion logic to an update body.
 *
 * If `computeNameForPromotion` returns an effective name (the user is
 * promoting their config to global or renaming a global), splice it into
 * the patch under `name`. Otherwise return the body unchanged.
 *
 * Caller is responsible for guarding admin-edits-on-non-owned-configs
 * (which should apply the body verbatim — suffixing under the bot owner's
 * username would mis-attribute provenance). The LLM route uses an
 * `isOwnedByRequester ? applyOwnerNamePromotion(...) : { ...body }` ternary;
 * the TTS route hard-fails non-owner edits before reaching this point so
 * the guard is implicit.
 *
 * Generic on `TBody extends { name?: string; isGlobal?: boolean }` so both
 * LlmConfigUpdateBody and TtsConfigUpdateBody work. Takes a minimal
 * `{ discordId, discordUsername }` shape rather than an Express request to
 * decouple this util from the route layer.
 */
export function applyOwnerNamePromotion<TBody extends { name?: string; isGlobal?: boolean }>(
  body: TBody,
  config: { name: string; isGlobal: boolean },
  user: { discordId: string; discordUsername: string }
): TBody {
  const effectiveName = computeNameForPromotion({
    currentName: config.name,
    currentIsGlobal: config.isGlobal,
    requestedName: body.name,
    requestedIsGlobal: body.isGlobal,
    discordId: user.discordId,
    discordUsername: user.discordUsername,
  });
  return { ...body, ...(effectiveName !== undefined ? { name: effectiveName } : {}) };
}

/**
 * Build the user-facing collision message for a config update where the
 * post-update state may be auto-renamed by the promotion helper.
 *
 * Two messages: when the name was system-computed (user sent only
 * `{ isGlobal: true }`, no explicit rename), explain the promotion auto-
 * rename. Otherwise, the user typed the colliding name themselves.
 *
 * `configKind` is the user-facing entity word (e.g. "config" for LLM,
 * "TTS config" for TTS) so error strings read naturally.
 */
export function buildCollisionMessage(opts: {
  effectiveName: string;
  requestedName: string | undefined;
  configKind: string;
}): string {
  const wasNormalized = opts.effectiveName !== opts.requestedName;
  return wasNormalized
    ? `Promotion would rename your ${opts.configKind} to "${opts.effectiveName}", but that name is already taken`
    : `You already have a ${opts.configKind} named "${opts.effectiveName}"`;
}

/**
 * Read the URI-encoded `x-user-username` header that bot-client sends and
 * `requireProvisionedUser` already validates. Headers are lowercased by
 * Express; the encoding round-trip preserves Discord's allowed username
 * character set (which can include `_`, `.`, etc. that don't survive raw
 * HTTP). Returns the raw username — sanitization for the slug suffix
 * happens inside `normalizeSlugForUser`.
 *
 * Fallback to empty string if missing — `requireProvisionedUser` would
 * have rejected the request before reaching this code, so an absent
 * header is "shouldn't happen" defense rather than a real branch.
 */
export function getDiscordUsernameFromRequest(req: Request): string {
  // `req.headers` may be undefined in unit-test mock requests that construct
  // a minimal Request object — production Express always populates it.
  const raw = req.headers?.['x-user-username'];
  if (typeof raw !== 'string' || raw.length === 0) {
    return '';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}
