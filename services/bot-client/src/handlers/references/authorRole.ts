import { KNOWN_PROXY_APP_IDS } from '@tzurot/common-types/constants/proxyBots';
import { type ReferenceAuthorRole } from '@tzurot/common-types/types/schemas/message';

/** The authorship signals a Discord message carries, narrowed for classification. */
export interface AuthorRoleSignals {
  /** `message.webhookId` — present (non-null) when the message was sent via a webhook. */
  webhookId: string | null;
  /** `message.author.bot` — true for any bot/webhook author. */
  authorIsBot: boolean;
  /** `message.applicationId` — the owning application's id, when Discord populates it. */
  applicationId: string | null;
  /** `message.client.user?.id` — the running bot's own user/app id. */
  clientUserId: string | undefined;
}

/**
 * Classify how a referenced message's author relates to the model — the `<quote role>`
 * signal. Decided in bot-client because only here do we have the Discord message's
 * `applicationId` (the owning bot/app) and our own `clientUserId`.
 *
 * - **assistant** — our own bot's webhook (`applicationId === clientUserId`). Covers
 *   every one of our personas; rename-immune and collision-free (no name matching).
 * - **user** — a real human (not webhook/bot), OR a message-proxy webhook (PluralKit /
 *   TupperBox) re-posting a human, identified by a known proxy `applicationId`.
 * - **bot** — any other webhook/bot: a non-persona automation. The catch-all for
 *   "not clearly our persona, not clearly an unproxied human", which is also where
 *   proxied messages land until their `applicationId` is added to KNOWN_PROXY_APP_IDS.
 */
export function classifyReferenceAuthorRole(
  signals: AuthorRoleSignals,
  knownProxyAppIds: readonly string[] = KNOWN_PROXY_APP_IDS
): ReferenceAuthorRole {
  const isMachineAuthored = signals.webhookId !== null || signals.authorIsBot;
  if (!isMachineAuthored) {
    return 'user';
  }
  if (signals.clientUserId !== undefined && signals.applicationId === signals.clientUserId) {
    return 'assistant';
  }
  if (signals.applicationId !== null && knownProxyAppIds.includes(signals.applicationId)) {
    return 'user';
  }
  return 'bot';
}
