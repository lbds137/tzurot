/**
 * /character alias — manage a character's @mention aliases (v2 parity).
 *
 * Aliases resolve mentions at runtime (gateway PersonalityLoader step 2), and
 * until this surface existed the v2-migrated rows were invisible routing
 * data. One subcommand with an `action` choice (list | add | remove) — the
 * character command router dispatches on flat subcommand names, and the
 * avatar/voice handlers set the precedent for multiplexing modes in one
 * handler.
 */

import { escapeMarkdown } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('character-alias-command');

type AliasAction = 'list' | 'add' | 'remove';

function describeGatewayFailure(status: number, error: string): string {
  if (status === 400 || status === 409) {
    // Gateway rejection prose is already user-clean (shadow check, conflict).
    return renderSpec(CATALOG.error.gatewayRejection(error));
  }
  if (status === 403) {
    return renderSpec(CATALOG.error.permissionDenied('manage aliases for this character'));
  }
  if (status === 404) {
    return renderSpec(CATALOG.error.notFound('Character or alias'));
  }
  return renderSpec(CATALOG.error.operationFailed('managing aliases'));
}

export async function handleAlias(context: DeferredCommandContext): Promise<void> {
  const action = context.interaction.options.getString('action', true) as AliasAction;
  const slug = context.interaction.options.getString('character', true);
  const trimmedAlias = context.interaction.options.getString('alias')?.trim() ?? '';

  if ((action === 'add' || action === 'remove') && trimmedAlias === '') {
    await context.editReply(
      renderSpec(CATALOG.error.validation(`The \`alias\` option is required for **${action}**.`))
    );
    return;
  }

  const { userClient } = clientsFor(context.interaction);

  try {
    if (action === 'list') {
      const result = await userClient.listPersonalityAliases(slug);
      if (!result.ok) {
        await context.editReply(describeGatewayFailure(result.status, result.error));
        return;
      }
      if (result.data.aliases.length === 0) {
        await context.editReply(
          renderSpec(
            CATALOG.info.note(
              `**${escapeMarkdown(slug)}** has no aliases. Add one with \`/character alias action:Add\`.`
            )
          )
        );
        return;
      }
      const lines = result.data.aliases.map(entry => `• \`@${escapeMarkdown(entry.alias)}\``);
      await context.editReply(
        renderSpec(
          CATALOG.info.note(
            `Aliases for **${escapeMarkdown(slug)}** (they resolve @mentions exactly like the name):\n${lines.join('\n')}`
          )
        )
      );
      return;
    }

    if (action === 'add') {
      const result = await userClient.addPersonalityAlias(slug, { alias: trimmedAlias });
      if (!result.ok) {
        await context.editReply(describeGatewayFailure(result.status, result.error));
        return;
      }
      await context.editReply(
        renderSpec(
          CATALOG.success.banner(
            'Added alias',
            `\`@${escapeMarkdown(result.data.alias.alias)}\` → ${escapeMarkdown(slug)}`
          )
        )
      );
      return;
    }

    const result = await userClient.removePersonalityAlias(slug, trimmedAlias);
    if (!result.ok) {
      await context.editReply(describeGatewayFailure(result.status, result.error));
      return;
    }
    await context.editReply(
      renderSpec(
        CATALOG.success.banner(
          'Removed alias',
          `\`@${escapeMarkdown(result.data.removedAlias)}\` from ${escapeMarkdown(slug)}`
        )
      )
    );
  } catch (error) {
    logger.error({ err: error, action, slug }, 'Alias command failed');
    await context.editReply(renderSpec(CATALOG.error.operationFailed('managing aliases')));
  }
}
