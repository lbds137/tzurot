// Shared handler for the Back-to-Browse button rendered by
// `renderTerminalScreen` and `renderPostActionScreen`. Replaces the four
// near-identical per-command `handleBackButton` implementations.
//
// Each of /preset, /character, /persona, /deny used to carry its own
// handleBackButton that did the same five-step flow:
//   1. fetch session → 2. read browseContext → 3. call buildBrowseResponse
//   → 4. sessionManager.delete + editReply → 5. error fallbacks.
// Step 3 was the only variable — solved centrally by the browse-rebuilder
// registry — so the flow collapses into this single handler.
//
// All error branches render the error-terminal with NO back button:
// re-rendering the back button on a back-button failure would just loop
// the user into the same failure.

import type { ButtonInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { getSessionManager } from './SessionManager.js';
import { renderTerminalScreen, type BrowseCapableEntityType } from './terminalScreen.js';
import { getBrowseRebuilder } from './browseRebuilderRegistry.js';
import { formatSessionExpiredMessage, DASHBOARD_MESSAGES } from './messages.js';
import type { BrowseContext } from './types.js';

const logger = createLogger('sharedBackButtonHandler');

/** Action-suffix used in all three error-terminal "couldn't go back" branches. */
const BROWSE_LOAD_ACTION = 'load browse list';

/**
 * Map each browse-capable entity type to the recovery slash-command shown in
 * session-expired messages. Keyed by the closed union so adding a new entry
 * to `BrowseCapableEntityType` without updating this table is a compile
 * error.
 */
const RECOVERY_COMMAND: Record<BrowseCapableEntityType, string> = {
  preset: '/preset browse',
  character: '/character browse',
  persona: '/persona browse',
  deny: '/deny browse',
};

/**
 * Extract `browseContext` from a session's data field in a type-safe way.
 * Session data shape varies per command, but all four commands serialize a
 * `BrowseContext`-shaped object at `data.browseContext` when the dashboard
 * was opened from `/browse`. Returns `undefined` when missing or malformed.
 *
 * Intentionally a subset check: validates the three fields that all browse
 * variants require (`source`, `page`, `filter`) and accepts optional fields
 * (`sort`, `query`) as-is. A future required field on `BrowseContext` will
 * slip through this guard — if `BrowseContext` grows load-bearing fields,
 * migrate this to a Zod `safeParse` so the guard stays self-maintaining.
 */
function extractBrowseContext(sessionData: unknown): BrowseContext | undefined {
  if (sessionData === null || typeof sessionData !== 'object') {
    return undefined;
  }
  const candidate = (sessionData as { browseContext?: unknown }).browseContext;
  if (candidate === null || typeof candidate !== 'object') {
    return undefined;
  }
  const ctx = candidate as Partial<BrowseContext>;
  if (ctx.source !== 'browse') {
    return undefined;
  }
  if (typeof ctx.page !== 'number') {
    return undefined;
  }
  if (typeof ctx.filter !== 'string') {
    return undefined;
  }
  return ctx as BrowseContext;
}

/**
 * Handle a Back-to-Browse button click for any browse-capable command.
 *
 * Expects the interaction to be already deferred (caller `deferUpdate`s).
 *
 * On success: clears the session and re-renders the browse list in place.
 * On any error branch (expired session, missing browseContext, rebuilder
 * missing/null/throws): renders a clean error terminal with no back button.
 */
export async function handleSharedBackButton(
  interaction: ButtonInteraction,
  entityType: BrowseCapableEntityType,
  entityId: string
): Promise<void> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get(interaction.user.id, entityType, entityId);

  // The terminal-screen descriptor we'll use for ALL error branches — never
  // carries browseContext (re-rendering the back button would loop). Built
  // once, shared across branches.
  const errorSession = {
    userId: interaction.user.id,
    entityType,
    entityId,
    browseContext: undefined,
  };

  if (session === null) {
    await renderTerminalScreen({
      interaction,
      session: errorSession,
      content: formatSessionExpiredMessage(RECOVERY_COMMAND[entityType]),
    });
    return;
  }

  const browseContext = extractBrowseContext(session.data);
  if (browseContext === undefined) {
    // Session exists but no (or malformed) browseContext — the back button
    // shouldn't have been rendered in the first place. Treat as expired.
    logger.warn(
      { entityType, entityId },
      '[back] Session had no browseContext; rendering expired terminal'
    );
    await renderTerminalScreen({
      interaction,
      session: errorSession,
      content: formatSessionExpiredMessage(RECOVERY_COMMAND[entityType]),
    });
    return;
  }

  const rebuilder = getBrowseRebuilder(entityType);
  if (rebuilder === undefined) {
    logger.error({ entityType, entityId }, '[back] No BrowseRebuilder registered for entity type');
    await renderTerminalScreen({
      interaction,
      session: errorSession,
      content: DASHBOARD_MESSAGES.OPERATION_FAILED(BROWSE_LOAD_ACTION),
    });
    return;
  }

  let rebuilt;
  try {
    rebuilt = await rebuilder(interaction, browseContext);
  } catch (error) {
    logger.error({ err: error, entityType, entityId }, '[back] BrowseRebuilder threw');
    await renderTerminalScreen({
      interaction,
      session: errorSession,
      content: DASHBOARD_MESSAGES.OPERATION_FAILED(BROWSE_LOAD_ACTION),
    });
    return;
  }

  if (rebuilt === null) {
    await renderTerminalScreen({
      interaction,
      session: errorSession,
      content: DASHBOARD_MESSAGES.OPERATION_FAILED(BROWSE_LOAD_ACTION),
    });
    return;
  }

  // Happy path — leaving the dashboard for the browse list.
  await sessionManager.delete(interaction.user.id, entityType, entityId);
  await interaction.editReply(rebuilt);
  logger.info({ userId: interaction.user.id, entityType, entityId }, '[back] Returned to browse');
}
