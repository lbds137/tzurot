/**
 * Per-interaction typed gateway clients.
 *
 * `clientsFor(interaction)` is the single boundary where a Discord
 * interaction is turned into branded `ActorDiscordId` + `GatewayUser`
 * inputs for the generated clients. Inside command handlers, never
 * call `asActor` directly — always go through `clientsFor` so the
 * brand is applied once, at the right place.
 *
 * Three flavors:
 * - `serviceClient` — no actor, targets `/api/internal/*`. Singleton-able
 *   because there's no per-call state, but we mint per-interaction for
 *   uniformity with the others.
 * - `ownerClient` — owner-only routes at `/api/admin/*`. Pass `subject`
 *   on `acceptsSubject` routes (e.g., denylist add).
 * - `userClient` — user-callable routes at `/api/user/*`. Always carries
 *   the full Discord user context (id + username + displayName) so the
 *   gateway can provision the row + apply per-user filters.
 */

import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  User as DiscordUser,
} from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { type GatewayUser } from '@tzurot/common-types/types/gateway-context';
import {
  asActor,
  ServiceClient,
  OwnerClient,
  UserClient,
  type ActorDiscordId,
} from '@tzurot/clients';
import { getValidatedServiceSecret } from '../startup.js';

/**
 * Build a `GatewayUser` from a Discord.js `User` object. Centralizes the
 * `globalName ?? username` fallback — callers never decide locally. Works
 * for both `interaction.user` and `message.author` (both are `User`).
 */
export function toGatewayUser(user: DiscordUser): GatewayUser {
  return {
    discordId: user.id,
    username: user.username,
    displayName: user.globalName ?? user.username,
    isBot: user.bot,
  };
}

/**
 * Non-throwing check that the gateway base URL is configured. Used by
 * command preflight (e.g. `commandHelpers`) to surface a friendly
 * "not configured" message instead of letting `getGatewayBaseUrl` throw.
 */
export function isGatewayConfigured(): boolean {
  try {
    getGatewayBaseUrl();
    return true;
  } catch {
    return false;
  }
}

/**
 * Union of every Discord interaction shape that carries a `user`.
 * `MessageComponentInteraction` is the base class for `ButtonInteraction`
 * and `StringSelectMenuInteraction`, so both are covered without
 * enumerating them. The factory only reads `interaction.user`, which is
 * defined on the base.
 */
export type ClientCarryingInteraction =
  | AutocompleteInteraction
  | ChatInputCommandInteraction
  | MessageComponentInteraction
  | MessageContextMenuCommandInteraction
  | ModalSubmitInteraction;

/**
 * All three clients are minted eagerly even when a caller only needs
 * one — the constructors are cheap (no I/O, no shared mutable state),
 * just config + brand assignment. Lazy initialization would add more
 * code surface than it saves work.
 */
export interface BoundGatewayClients {
  readonly serviceClient: ServiceClient;
  readonly ownerClient: OwnerClient;
  readonly userClient: UserClient;
  readonly actor: ActorDiscordId;
  readonly user: GatewayUser;
}

function getGatewayBaseUrl(): string {
  // The Zod schema for GATEWAY_URL transforms missing/empty values to a
  // localhost default, so config.GATEWAY_URL is typed as `string` (never
  // undefined). The length-0 check stays as defense in depth against a
  // future schema change that drops the localhost fallback.
  const url = getConfig().GATEWAY_URL;
  if (url.length === 0) {
    throw new Error('GATEWAY_URL is not configured');
  }
  return url;
}

function buildClients(discordUser: DiscordUser): BoundGatewayClients {
  const baseUrl = getGatewayBaseUrl();
  const serviceSecret = getValidatedServiceSecret();
  const actor = asActor(discordUser.id);
  const user = toGatewayUser(discordUser);

  return {
    serviceClient: new ServiceClient({ baseUrl, serviceSecret }),
    ownerClient: new OwnerClient({ baseUrl, serviceSecret, actor }),
    userClient: new UserClient({ baseUrl, serviceSecret, actor, user }),
    actor,
    user,
  };
}

/**
 * Build the typed clients for a Discord interaction. Mints the actor
 * brand exactly once; downstream handlers never construct clients
 * themselves.
 */
export function clientsFor(interaction: ClientCarryingInteraction): BoundGatewayClients {
  return buildClients(interaction.user);
}

/**
 * Build the typed clients for a Discord user directly. Use this in
 * non-interaction contexts (message handlers, processors, startup
 * services) where there is no `interaction.user` to read from but the
 * Discord user is available some other way.
 */
export function clientsForUser(discordUser: DiscordUser): BoundGatewayClients {
  return buildClients(discordUser);
}

/**
 * Build a `ServiceClient` for `/api/internal/*` calls that don't carry
 * a Discord actor. Used by startup services (e.g., DM prewarmer) and
 * other infrastructure paths where there's no user context yet.
 */
export function getServiceClient(): ServiceClient {
  return new ServiceClient({
    baseUrl: getGatewayBaseUrl(),
    serviceSecret: getValidatedServiceSecret(),
  });
}
