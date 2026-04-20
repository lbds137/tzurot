// Hybrid post-action screen: success = direct re-render of browse list with a
// banner in `content` (saves a click); error = terminal screen with
// Back-to-Browse button (forces acknowledgement). Routes to the command's
// registered browse-rebuilder by `session.entityType`.
//
// Callers: destructive-action handlers (delete-confirm, etc.) across the four
// browse-capable commands. Each command's terminal handler invokes this with
// `outcome: { kind: 'success', banner: ... }` on success and
// `{ kind: 'error', content: ... }` on failure.

import type { ButtonInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { renderTerminalScreen, type TerminalScreenSession } from './terminalScreen.js';
import { getBrowseRebuilder } from './browseRebuilderRegistry.js';
import { getSessionManager } from './SessionManager.js';

const logger = createLogger('postActionScreen');

/**
 * Outcome of a post-action flow.
 *
 * - `success`: destructive action completed. `banner` is the short,
 *   visually distinct message to render in `editReply.content` above the
 *   refreshed browse list (e.g. `✅ **Deleted** · MyPreset`). Mobile
 *   Discord clients can de-emphasize the `content` field when a large
 *   embed sits below it — keep banners bold + emoji so they remain
 *   scannable. Use `formatSuccessBanner` from `messages.ts` for consistent
 *   shape.
 * - `error`: destructive action failed. `content` is the full error
 *   message to render as the terminal screen body.
 */
export type PostActionOutcome =
  | { kind: 'success'; banner: string }
  | { kind: 'error'; content: string };

export interface PostActionScreenOptions {
  /** Already-deferred button interaction. */
  interaction: ButtonInteraction;
  /**
   * The session descriptor. May be `null` for unusual flows where no session
   * was ever created — in that case only the terminal-cleanup path is
   * meaningful (no Back-to-Browse button, no rebuild).
   */
  session: TerminalScreenSession | null;
  outcome: PostActionOutcome;
}

/**
 * Route a post-action outcome through the unified helper.
 *
 * Branching:
 * - `success` + `browseContext` + registered rebuilder → call the rebuilder;
 *   on non-null result, delete the session and `editReply` the rebuilt view
 *   with the banner in `content`.
 * - `success` + `browseContext` + **no rebuilder** → log a warning and fall
 *   through to the error-terminal path. This should never happen in
 *   production (all four commands register rebuilders at module load); the
 *   warn makes the misconfiguration loud without crashing the interaction.
 * - `success` + `browseContext` + rebuilder returns `null` → same fall-
 *   through (the rebuild itself failed, e.g., fetch error on re-query).
 * - `success` **without** `browseContext` → terminal cleanup path. The
 *   banner is rendered as `content`; no back button. Session is deleted.
 * - `error` path → delegate to `renderTerminalScreen`, which renders the
 *   error content with a Back-to-Browse button if `browseContext` is
 *   present, or without if not.
 */
export async function renderPostActionScreen(opts: PostActionScreenOptions): Promise<void> {
  const { interaction, session, outcome } = opts;

  if (outcome.kind === 'success' && session?.browseContext !== undefined) {
    const rebuilder = getBrowseRebuilder(session.entityType);
    if (rebuilder === undefined) {
      logger.warn(
        { entityType: session.entityType, entityId: session.entityId },
        'No BrowseRebuilder registered for entity type; falling through to error terminal'
      );
      await renderTerminalScreen({
        interaction,
        session,
        content: `${outcome.banner}\n\n❌ Could not reload the browse list.`,
      });
      return;
    }

    try {
      const rebuilt = await rebuilder(interaction, session.browseContext, outcome.banner);
      if (rebuilt === null) {
        // Rebuild itself failed — e.g. the re-fetch returned null.
        // Preserve the success banner in the terminal fallback so the user
        // sees that the destructive action *did* succeed.
        await renderTerminalScreen({
          interaction,
          session,
          content: `${outcome.banner}\n\n❌ Could not reload the browse list.`,
        });
        return;
      }

      // Success path: clean up session (user is leaving the dashboard for the
      // browse list) and render the rebuilt view.
      await getSessionManager().delete(session.userId, session.entityType, session.entityId);
      await interaction.editReply(rebuilt);
      return;
    } catch (error) {
      logger.error(
        { err: error, entityType: session.entityType, entityId: session.entityId },
        'BrowseRebuilder threw; falling through to error terminal'
      );
      await renderTerminalScreen({
        interaction,
        session,
        content: `${outcome.banner}\n\n❌ Could not reload the browse list.`,
      });
      return;
    }
  }

  if (outcome.kind === 'success') {
    // No browseContext — dashboard opened without /browse (e.g. /preset view).
    // Render the banner as a clean terminal; no back button needed.
    await renderTerminalScreen({
      interaction,
      session,
      content: outcome.banner,
    });
    return;
  }

  // Error path.
  await renderTerminalScreen({
    interaction,
    session,
    content: outcome.content,
  });
}
