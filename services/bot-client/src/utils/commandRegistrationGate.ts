/**
 * Slash-command registration gate
 *
 * Railway is the only place that should auto-register slash commands on
 * boot. Local `.env` and Railway dev share one Discord application id, so a
 * local `pnpm dev` run auto-registering would silently overwrite whatever
 * command set the dev deploy last registered. `RAILWAY_ENVIRONMENT_NAME` is
 * injected by Railway on every deployed environment and absent locally,
 * which makes it the switch: present → register, absent → skip.
 *
 * The second half of this module supports change detection: hashing the
 * exact PUT body and keying the last-registered hash in Redis so a boot that
 * would send an unchanged command set can skip the PUT entirely.
 */

import { createHash } from 'node:crypto';
import type { EnvConfig } from '@tzurot/common-types/config/config';

// A durable "last registered" marker, not a cache: no TTL by design. A key
// for a rotated client id is orphaned, at the cost of one string per scope.
const KEY_PREFIX = 'bot:commands:deployed:';

/**
 * Whether this boot should auto-register slash commands. True iff
 * `RAILWAY_ENVIRONMENT_NAME` is set to a non-empty string.
 */
export function shouldAutoRegisterCommands(
  config: Pick<EnvConfig, 'RAILWAY_ENVIRONMENT_NAME'>
): boolean {
  return (
    config.RAILWAY_ENVIRONMENT_NAME !== undefined && config.RAILWAY_ENVIRONMENT_NAME.length > 0
  );
}

/**
 * Stable hash of the PUT body, over each command's serialization in sorted
 * order: the body order comes from a bare `readdirSync`, which is not
 * guaranteed stable across image rebuilds, and order alone is not a change.
 */
export function hashCommandBody(commands: unknown[]): string {
  const canonical = commands.map(command => JSON.stringify(command)).sort();
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Which route a registration PUTs to, and the key its hash is stored under. */
export type DeployScope = { global: true } | { global: false; guildId: string };

/** The Redis key holding the last-registered command hash for one scope. */
export function deployedCommandsKey(clientId: string, scope: DeployScope): string {
  return scope.global
    ? `${KEY_PREFIX}${clientId}:global`
    : `${KEY_PREFIX}${clientId}:guild:${scope.guildId}`;
}

/** The minimal Redis surface the gate needs — an ioredis client satisfies this structurally. */
export interface DeployedCommandsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}
