/**
 * /feedback — submit feedback about the bot (the project's official contact
 * channel, named in the ToS/privacy policy alongside GitHub issues).
 *
 * Ephemeral for the submitter; each accepted submission also posts one
 * SILENT embed (no pings) to the private owner channel configured via
 * FEEDBACK_CHANNEL_ID, which the owner reads on their own schedule. The
 * gateway stores the row first — a failed channel post loses only the
 * notification, never the feedback.
 */

import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown, type Client } from 'discord.js';
import { feedbackOptions } from '@tzurot/common-types/generated/commandOptions';
import { FEEDBACK_LIMITS } from '@tzurot/common-types/constants/feedback';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { sanitizeErrorForDiscord } from '../../utils/errorSanitization.js';
import { postOwnerChannelEmbed } from '../../utils/ownerChannel.js';

const logger = createLogger('feedback-command');

/**
 * Best-effort owner-channel notification. Delivery (channel guardrails,
 * no-ping send, swallow-and-warn) lives in the shared owner-channel helper —
 * the row is already stored server-side, so a failed post loses nothing.
 */
async function postToOwnerChannel(
  client: Client,
  submitter: { id: string; username: string },
  content: string,
  feedbackId: string
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('📬 New Feedback')
    .setAuthor({ name: `${submitter.username} (${submitter.id})` })
    .setDescription(escapeMarkdown(content))
    .setFooter({ text: `feedback:${feedbackId}` })
    .setTimestamp();
  await postOwnerChannelEmbed(client, embed);
}

async function execute(context: SafeCommandContext): Promise<void> {
  const deferred = context as DeferredCommandContext;
  const content = feedbackOptions(deferred.interaction).message();
  const userId = deferred.user.id;

  try {
    const { userClient } = clientsFor(deferred.interaction);
    const result = await userClient.submitFeedback({ content });

    if (!result.ok) {
      // Gate rejections carry the specific limit in the message — render it.
      await deferred.editReply({
        content: `❌ ${sanitizeErrorForDiscord(result.error)}`,
      });
      return;
    }

    await deferred.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(DISCORD_COLORS.SUCCESS)
          .setTitle('💬 Feedback Sent')
          .setDescription(
            'Thanks — your feedback goes straight to the developer. ' +
              'If it needs a reply, keep an eye on release notes or GitHub.'
          )
          .setTimestamp(),
      ],
    });

    await postToOwnerChannel(
      deferred.interaction.client,
      { id: userId, username: deferred.user.username },
      content,
      result.data.feedbackId
    );
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error submitting feedback');
    await deferred.editReply({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  }
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Send feedback about the bot to the developer')
    .addStringOption(opt =>
      opt
        .setName('message')
        .setDescription('Your feedback (bug reports, ideas, anything)')
        .setRequired(true)
        .setMaxLength(FEEDBACK_LIMITS.MAX_LENGTH)
    ),
  deferralMode: 'ephemeral',
  execute,
});
