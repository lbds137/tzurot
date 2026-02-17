/**
 * Shapes Auth Subcommand
 *
 * Shows instructions for extracting the shapes.inc session cookie,
 * then presents buttons for the user to continue to the modal or cancel.
 *
 * The actual modal opening and button handling is done by interactionHandlers.ts,
 * which is routed through CommandHandler — not inline collectors.
 *
 * Security:
 * - Uses Discord Modal for cookie input (never visible in command history)
 * - Response is ephemeral (only visible to the user)
 * - Cookie is encrypted with AES-256-GCM at rest
 */

import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import { ShapesCustomIds } from '../../utils/customIds.js';

/** Build the auth modal with cookie input fields */
export function buildAuthModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(ShapesCustomIds.auth())
    .setTitle('Shapes.inc Authentication');

  const cookiePart0 = new TextInputBuilder()
    .setCustomId('cookiePart0')
    .setLabel('appSession (or appSession.0)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Paste your appSession cookie value (or appSession.0 if you have two)')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(4000);

  const cookiePart1 = new TextInputBuilder()
    .setCustomId('cookiePart1')
    .setLabel('appSession.1 (only if you have two cookies)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Leave empty if you only have one appSession cookie')
    .setRequired(false)
    .setMaxLength(4000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(cookiePart0),
    new ActionRowBuilder<TextInputBuilder>().addComponents(cookiePart1)
  );

  return modal;
}

/**
 * Handle /shapes auth subcommand
 * Shows instructions with Continue/Cancel buttons.
 * Button clicks are handled by interactionHandlers.ts via CommandHandler routing.
 */
export async function handleAuth(context: ModalCommandContext): Promise<void> {
  const botName = context.interaction.client.user.username;

  const instructionEmbed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('Shapes.inc Authentication')
    .setDescription(
      `To import characters from shapes.inc, ${botName} needs your session cookie.\n\n` +
        '**How to get it:**\n' +
        '1. Log in to [shapes.inc](https://shapes.inc) in your browser\n' +
        '2. Navigate to [shapes.inc/dashboard](https://shapes.inc/dashboard) ' +
        '(this avoids the chat UI which rotates your cookie frequently)\n' +
        '3. Press **F12** (or Ctrl+Shift+I) to open Developer Tools\n' +
        '4. Click the **Application** tab (Chrome) or **Storage** tab (Firefox)\n' +
        '5. In the left sidebar, expand **Cookies** → click `https://shapes.inc`\n' +
        '6. Find `appSession` (or `appSession.0` and `appSession.1`)\n' +
        '7. Double-click each **Value** cell to select it, then copy\n\n' +
        `*Your cookie is encrypted and stored securely. ` +
        `${botName} never sees your shapes.inc password.*`
    );

  const continueButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.authContinue())
    .setLabel('Enter Cookie')
    .setEmoji('🔑')
    .setStyle(ButtonStyle.Primary);

  const cancelButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.authCancel())
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton, cancelButton);

  await context.reply({
    embeds: [instructionEmbed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}
