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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ModalBuilder,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { SHAPES_TOKEN_MIN_LENGTH } from '@tzurot/common-types/types/shapes-import';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import { buildToolkitModal } from '../../utils/modal/toolkit.js';
import { ShapesCustomIds } from '../../utils/customIds.js';

/** Build the auth modal with a single cookie input field (Better Auth, 2026-04+) */
export function buildAuthModal(): ModalBuilder {
  return buildToolkitModal({
    customId: ShapesCustomIds.auth(),
    title: 'Shapes.inc Authentication',
    items: [
      {
        kind: 'text',
        id: 'cookieValue',
        label: 'Session cookie value',
        // The #1 auth trap from the instruction embed, repeated at the
        // point of entry: the chat subdomain's cookie looks identical.
        description: "From shapes.inc — a talk.shapes.inc cookie won't work.",
        style: 'paragraph',
        placeholder: 'Paste the value of __Secure-better-auth.session_token',
        required: true,
        minLength: SHAPES_TOKEN_MIN_LENGTH,
        maxLength: 4000,
      },
    ],
  });
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
        '2. Navigate to [shapes.inc/dashboard](https://shapes.inc/dashboard)\n' +
        '3. Press **F12** (or Ctrl+Shift+I) to open Developer Tools\n' +
        '4. Click the **Application** tab (Chrome) or **Storage** tab (Firefox)\n' +
        '5. In the left sidebar, expand **Cookies** → click `https://shapes.inc`\n' +
        '6. Find the cookie named `__Secure-better-auth.session_token` ' +
        '(sort by the HttpOnly column to find it faster — it has that flag set)\n' +
        '7. Double-click the **Value** cell to select it, then copy\n\n' +
        '⚠️ **Must be from `shapes.inc`, not `talk.shapes.inc`.** ' +
        "The chat subdomain is a separate app with its own auth and its cookie won't work here.\n\n" +
        `*Your cookie is encrypted at rest with AES-256-GCM. ` +
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
