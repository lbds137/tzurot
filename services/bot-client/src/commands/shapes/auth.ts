/**
 * Shapes Auth Subcommand
 *
 * Opens a modal for secure session cookie input. The user pastes their
 * shapes.inc session cookie parts (appSession.0 and appSession.1) which
 * are then encrypted and stored via the gateway.
 *
 * Security:
 * - Uses Discord Modal for cookie input (never visible in command history)
 * - Response is ephemeral (only visible to the user)
 * - Cookie is encrypted with AES-256-GCM at rest
 */

import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import { ShapesCustomIds } from '../../utils/customIds.js';

const logger = createLogger('shapes-auth');

/**
 * Handle /shapes auth subcommand
 * Shows a modal for session cookie input
 */
export async function handleAuth(context: ModalCommandContext): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(ShapesCustomIds.auth())
    .setTitle('Shapes.inc Authentication');

  const cookiePart0 = new TextInputBuilder()
    .setCustomId('cookiePart0')
    .setLabel('appSession.0')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Paste the value of appSession.0 from your browser cookies')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(4000);

  const cookiePart1 = new TextInputBuilder()
    .setCustomId('cookiePart1')
    .setLabel('appSession.1')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Paste the value of appSession.1 from your browser cookies')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(4000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(cookiePart0),
    new ActionRowBuilder<TextInputBuilder>().addComponents(cookiePart1)
  );

  await context.showModal(modal);

  logger.info({ userId: context.user.id }, '[Shapes] Showing auth modal');
}
