/**
 * Character Command - API Client Functions
 *
 * Handles communication with the API gateway for character operations.
 * Each helper takes a typed `userClient` (minted at the interaction boundary
 * via `clientsFor`) so the wire shape, auth headers, and response validation
 * all flow through the route manifest.
 *
 * Schema drift note: `CharacterData` is a bot-client display shape that
 * predates the typed client. `toCharacterData` coerces two fields so the shape
 * assigns directly to the gateway's create/update input (no cast needed):
 *   - `characterInfo` / `personalityTraits` are non-nullable on
 *     `CharacterData` but nullable in the gateway response schema (a legacy
 *     character predating the `min(1)` create constraint can carry null).
 *     Coerced with `?? ''` here so the display shape stays string-typed;
 *     `omitEmptyRequiredText` drops the empty value back out of update
 *     payloads, since the update schema rejects `''`.
 *   - `avatarData` is a bot-client convenience field (used during
 *     create/update flows in import.ts); the gateway response carries
 *     `hasAvatar: boolean` instead. Defaulted to `null` on incoming data.
 *     The create/update schemas accept `null` (= no avatar), so it round-trips
 *     cleanly; the avatar itself is set separately via `/character avatar set`.
 */

import {
  escapeMarkdown,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import type { EnvConfig } from '@tzurot/common-types/config/config';
import { GatewayApiError, type UserClient } from '@tzurot/clients';
import type { CharacterData } from './characterTypes.js';

/**
 * Extended character data that includes canEdit flag from API
 */
export interface FetchedCharacter extends CharacterData {
  canEdit: boolean;
}

/**
 * Coerce a `PersonalityFull`-shaped object into the bot-client `CharacterData`
 * shape, filling in the two fields the schema doesn't surface
 * (`characterInfo`/`personalityTraits` coerced from nullable; `avatarData`
 * defaulted to null since the response only carries `hasAvatar`).
 */
export function toCharacterData<
  T extends { characterInfo: string | null; personalityTraits: string | null },
>(
  p: T
): Omit<T, 'characterInfo' | 'personalityTraits'> & {
  characterInfo: string;
  personalityTraits: string;
  avatarData: string | null;
} {
  return {
    ...p,
    characterInfo: p.characterInfo ?? '',
    personalityTraits: p.personalityTraits ?? '',
    avatarData: null,
  };
}

/**
 * Drop `characterInfo`/`personalityTraits` from an update payload when they're
 * empty strings. `toCharacterData` coerces these nullable fields to `''` for the
 * `CharacterData` display shape, but the gateway update schema declares them
 * `z.string().min(1)` — and every section save replays the WHOLE session, so a
 * character whose text is empty (a legacy row predating the `min(1)` create
 * constraint) would 400 on an unrelated edit. Omitting an unchanged required
 * field leaves it untouched server-side (the update is a partial PUT), so the
 * edit goes through. Exported so the round-trip contract test exercises the real
 * sanitizer rather than a reimplementation.
 *
 * Constraint is `string`, not `string | null`: by the time a payload reaches
 * here it has passed through `toCharacterData`, which coerces null → '', so the
 * fields are always `string | undefined`. Admitting null would invite a future
 * caller to pass one that this helper wouldn't strip (it only drops '') — and
 * the gateway update schema rejects null anyway.
 */
export function omitEmptyRequiredText<
  T extends { characterInfo?: string; personalityTraits?: string },
>(data: T): Partial<T> {
  const out: Partial<T> = { ...data };
  if (out.characterInfo === '') {
    delete out.characterInfo;
  }
  if (out.personalityTraits === '') {
    delete out.personalityTraits;
  }
  return out;
}

/**
 * Fetch a character by slug
 * Uses the /user/personality/:slug endpoint which requires user authentication
 * Returns character data with canEdit flag from server-side permission check
 */
export async function fetchCharacter(
  slugOrId: string,
  _config: EnvConfig,
  userClient: UserClient
): Promise<FetchedCharacter | null> {
  const result = await userClient.getPersonality(slugOrId);

  if (!result.ok) {
    if (result.status === 404 || result.status === 403) {
      // 403 collapses to absence deliberately: "not visible to you" must be
      // indistinguishable from "does not exist" (privacy — same rationale as
      // the definition-redaction seam).
      return null;
    }
    // Typed throw preserves the transport kind so classifyGatewayFailure
    // renders the honest shape (a plain Error here collapsed a timeout into
    // the generic failure line).
    throw new GatewayApiError(
      `Failed to fetch character: ${result.status} - ${result.error}`,
      result.status,
      result.kind
    );
  }

  return {
    ...toCharacterData(result.data.personality),
    canEdit: result.data.canEdit,
  };
}

/**
 * Fetch all characters visible to a user (owned + public)
 * Returns two arrays: user's owned characters and public characters from others
 */
export async function fetchAllCharacters(
  userClient: UserClient,
  _config: EnvConfig
): Promise<{ owned: CharacterData[]; publicOthers: CharacterData[] }> {
  const result = await userClient.listPersonalities();

  if (!result.ok) {
    throw new GatewayApiError(
      `Failed to fetch characters: ${result.status} - ${result.error}`,
      result.status,
      result.kind
    );
  }

  const data = result.data;

  // The list endpoint returns summaries, but we need full data for the dashboard
  // For now, just return the summaries cast to CharacterData (we'll fetch full data when editing)
  const owned: CharacterData[] = [];
  const publicOthers: CharacterData[] = [];

  for (const p of data.personalities) {
    const charData = {
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      slug: p.slug,
      isPublic: p.isPublic,
      ownerId: p.ownerDiscordId, // Use Discord ID for fetching display names
      // These fields are not in the list response, but needed for CharacterData interface.
      // definitionPublic/definitionRedacted are placeholder `false` here — the
      // list summary carries no card visibility — so consumers must re-fetch the
      // full character on select (browse/select does) before trusting them.
      definitionPublic: false,
      definitionRedacted: false,
      characterInfo: '',
      personalityTraits: '',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      errorMessage: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      voiceEnabled: false,
      hasVoiceReference: false,
      imageEnabled: false,
      avatarData: null,
      createdAt: '',
      updatedAt: '',
    } as CharacterData;

    // Use truthful isOwned from API for categorization
    // The API now correctly reports isOwned based on actual creation, not admin status
    if (p.isOwned) {
      owned.push(charData);
    } else {
      publicOthers.push(charData);
    }
  }

  return { owned, publicOthers };
}

/**
 * Fetch characters owned by user (wrapper for fetchAllCharacters)
 */
export async function fetchUserCharacters(
  userClient: UserClient,
  config: EnvConfig
): Promise<CharacterData[]> {
  const { owned } = await fetchAllCharacters(userClient, config);
  return owned;
}

/**
 * Fetch public characters from others (wrapper for fetchAllCharacters)
 */
export async function fetchPublicCharacters(
  userClient: UserClient,
  config: EnvConfig
): Promise<CharacterData[]> {
  const { publicOthers } = await fetchAllCharacters(userClient, config);
  return publicOthers;
}

/**
 * Fetch Discord usernames for a list of user IDs
 */
export async function fetchUsernames(
  client: ChatInputCommandInteraction['client'],
  userIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  await Promise.all(
    userIds.map(async id => {
      try {
        const user = await client.users.fetch(id);
        names.set(id, user.displayName ?? user.username);
      } catch {
        names.set(id, 'Unknown');
      }
    })
  );

  return names;
}

/**
 * Create a new character.
 *
 * The body type is widened to `Record<string, unknown>` at the typed-client
 * boundary because the bot-client's `Partial<CharacterData>` and the
 * gateway's `PersonalityCreateSchema` overlap but aren't structurally
 * identical (CharacterData's `[key: string]: unknown` index signature
 * widens the field types, and `Partial<>` can't express the
 * "name/slug/characterInfo/personalityTraits required" constraint that
 * the schema enforces at parse time). The gateway-side Zod parser is
 * the authoritative validation gate.
 */
export async function createCharacter(
  data: Partial<CharacterData> & {
    name: string;
    slug: string;
    characterInfo: string;
    personalityTraits: string;
  },
  userClient: UserClient,
  _config: EnvConfig
): Promise<{ character: FetchedCharacter; shadowedAliases: string[] }> {
  const result = await userClient.createPersonality(data);

  if (!result.ok) {
    // Consistent with updateCharacter: carry the status + kind (so a create flow
    // could surface the honest outcome-uncertain notice) and guard the message
    // against an undefined gateway error.
    throw new GatewayApiError(
      `Failed to create character: ${result.status} - ${result.error ?? 'Unknown'}`,
      result.status,
      result.kind
    );
  }

  return {
    // The create response carries no canEdit field (it would always be true:
    // you own what you just created) — graft it so the dashboard's
    // showDelete derivation sees an owned character, matching the
    // fetch/update paths.
    character: { ...toCharacterData(result.data.personality), canEdit: true },
    // Warn-don't-block ride-along: GLOBAL aliases the new name/slug shadows.
    shadowedAliases: result.data.shadowedAliases ?? [],
  };
}

/**
 * Update a character.
 */
export async function updateCharacter(
  slug: string,
  data: Partial<CharacterData>,
  userClient: UserClient,
  _config: EnvConfig
): Promise<{ character: FetchedCharacter; shadowedAliases: string[] }> {
  const result = await userClient.updatePersonality(slug, omitEmptyRequiredText(data));

  if (!result.ok) {
    // GatewayApiError carries status + kind so the dashboard can distinguish
    // an outcome-uncertain abort (timeout/network → "still applying") from a real
    // HTTP rejection (whose message it surfaces). Message format matches the
    // classifier's caller-wrapper convention (`: {status} - {message}`).
    throw new GatewayApiError(
      `Failed to update character: ${result.status} - ${result.error ?? 'Unknown'}`,
      result.status,
      result.kind
    );
  }

  return {
    // canEdit rides the update response (same schema as GET) — dropping it
    // made the post-edit dashboard re-render lose its permission-gated
    // buttons (Delete) until a refresh re-fetched the flag.
    character: { ...toCharacterData(result.data.personality), canEdit: result.data.canEdit },
    // Present only after a rename that shadows GLOBAL aliases (warn-don't-block).
    shadowedAliases: result.data.shadowedAliases ?? [],
  };
}

/**
 * Render text for the reverse-shadow advisory (create/rename shadowing
 * existing GLOBAL aliases). Shared by the create, dashboard-edit, and
 * import flows so the copy can't drift between them.
 */
export function formatShadowedAliasWarning(shadowedAliases: string[]): string {
  const list = shadowedAliases.map(alias => `\`${escapeMarkdown(alias)}\``).join(', ');
  const noun = shadowedAliases.length === 1 ? 'alias' : 'aliases';
  return `This character's name now shadows the global ${noun} ${list} — ${
    shadowedAliases.length === 1 ? 'that alias' : 'those aliases'
  } won't resolve while the name matches.`;
}

/**
 * Send the reverse-shadow advisory as an ephemeral followUp; no-op when
 * nothing was shadowed. One sender for the create, dashboard-rename, and
 * import flows — the action itself succeeded, so this never replaces the
 * primary reply.
 */
export async function sendShadowedAliasFollowUp(
  target: { followUp: (options: InteractionReplyOptions) => Promise<unknown> },
  shadowedAliases: string[]
): Promise<void> {
  if (shadowedAliases.length === 0) {
    return;
  }
  await target.followUp({
    content: renderSpec(CATALOG.info.warning(formatShadowedAliasWarning(shadowedAliases))),
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Toggle character visibility
 */
export async function toggleVisibility(
  slug: string,
  isPublic: boolean,
  userClient: UserClient,
  _config: EnvConfig
): Promise<{ id: string; slug: string; isPublic: boolean }> {
  const result = await userClient.setPersonalityVisibility(slug, { isPublic });

  if (!result.ok) {
    throw new Error(`Failed to toggle visibility: ${result.status} - ${result.error}`);
  }

  return result.data.personality;
}
