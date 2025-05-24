/**
 * Reference Handler Module
 *
 * This module handles message references in Discord, including:
 * - Replies to previous messages
 * - Discord message links in content
 * - Cross-server message link handling
 */

const logger = require('../logger');
const { getPersonalityFromMessage } = require('../conversationManager');
const { getPersonality, getPersonalityByAlias } = require('../personalityManager');
const { parseEmbedsToText } = require('../utils/embedUtils');

/**
 * The regex pattern for matching Discord message links
 * Supports regular discord.com, ptb.discord.com, canary.discord.com, and discordapp.com variations
 */
const MESSAGE_LINK_REGEX =
  /https:\/\/(ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;

/**
 * Handle a message reference (a reply to another message)
 * @param {object} message - Discord.js message object
 * @param {function} handlePersonalityInteraction - Callback for handling personality interactions
 * @returns {Promise<boolean>} - Returns true if reference was handled, false otherwise
 */
async function handleMessageReference(message, handlePersonalityInteraction) {
  if (!message.reference) {
    return false;
  }

  logger.debug(
    `Detected reply from ${message.author.tag} to message ID: ${message.reference.messageId}`
  );

  try {
    const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
    logger.debug(
      `Fetched referenced message. Webhook ID: ${referencedMessage.webhookId || 'none'}`
    );

    // Check if the referenced message itself has a reference (nested reply)
    if (referencedMessage.reference) {
      logger.info(
        `[ReferenceHandler] Detected nested reference - reply to a reply. Original reference: ${referencedMessage.reference.messageId}`
      );
      
      try {
        // Fetch the second-level referenced message
        const nestedReferencedMessage = await message.channel.messages.fetch(referencedMessage.reference.messageId);
        
        // Create a synthetic Discord message link for the nested reference
        const syntheticLink = `https://discord.com/channels/${message.guild?.id || '@me'}/${message.channel.id}/${nestedReferencedMessage.id}`;
        
        // Append the synthetic link to the message content
        // This will be processed by processMessageLinks in personalityHandler
        message.content = message.content ? `${message.content} ${syntheticLink}` : syntheticLink;
        
        logger.info(
          `[ReferenceHandler] Added synthetic link for nested reference: ${syntheticLink}`
        );
        logger.debug(
          `[ReferenceHandler] Updated message content: ${message.content}`
        );
      } catch (nestedError) {
        if (nestedError.message === 'Unknown Message') {
          logger.warn(`[ReferenceHandler] Nested referenced message ${referencedMessage.reference.messageId} no longer exists`);
        } else {
          logger.error('[ReferenceHandler] Error fetching nested reference:', nestedError);
        }
      }
    }

    // Check if the referenced message was from one of our personalities
    logger.debug(
      `Reply detected to message ${referencedMessage.id} with webhookId: ${referencedMessage.webhookId || 'none'}`
    );

    if (referencedMessage.webhookId) {
      logger.debug(`Looking up personality for message ID: ${referencedMessage.id}`);
      // Pass the webhook username as a fallback for finding personalities
      const webhookUsername = referencedMessage.author ? referencedMessage.author.username : null;
      logger.debug(`Webhook username: ${webhookUsername || 'unknown'}`);

      // Log webhook details for debugging
      if (referencedMessage.author && referencedMessage.author.bot) {
        logger.debug(
          `Referenced message is from bot: ${JSON.stringify({
            username: referencedMessage.author.username,
            id: referencedMessage.author.id,
            webhookId: referencedMessage.webhookId,
          })}`
        );
      }

      const personalityName = getPersonalityFromMessage(referencedMessage.id, {
        webhookUsername,
      });
      logger.debug(`Personality lookup result: ${personalityName || 'null'}`);

      if (personalityName) {
        logger.debug(`Found personality name: ${personalityName}, looking up personality details`);

        // First try to get personality directly as it could be a full name
        let personality = getPersonality(personalityName);

        // If not found as direct name, try it as an alias
        if (!personality) {
          personality = getPersonalityByAlias(personalityName);
        }

        logger.debug(`Personality lookup result: ${personality ? personality.fullName : 'null'}`);

        if (personality) {
          // Process the message with this personality
          logger.debug(
            `Processing reply with personality: ${personality.fullName} from user ${message.author.id}`
          );
          // Since this is a reply, not a direct @mention, pass null for triggeringMention
          // IMPORTANT: Use message.author.id to ensure the replying user's ID is used
          // This ensures authentication context is preserved correctly
          await handlePersonalityInteraction(message, personality, null);
          return true;
        } else {
          logger.debug(`No personality data found for name/alias: ${personalityName}`);
        }
      } else {
        logger.debug(`No personality found for message ID: ${referencedMessage.id}`);
      }
    } else {
      logger.debug(
        `Referenced message is not from a webhook: ${referencedMessage.author?.tag || 'unknown author'}`
      );
    }
  } catch (error) {
    if (error.message === 'Unknown Message') {
      logger.warn(`Referenced message ${message.reference.messageId} no longer exists (deleted or inaccessible)`);
    } else {
      logger.error('Error handling message reference:', error);
    }
  }

  return false;
}

/**
 * Process a message content for Discord message links
 * @param {object} message - Discord.js message object
 * @param {string} messageContent - The message content to process
 * @param {object|null} referencedPersonalityInfo - Information about the referenced personality
 * @param {boolean} isReferencedMessageFromBot - Whether the referenced message is from a bot
 * @param {string|null} referencedWebhookName - The webhook name of the referenced message
 * @param {string|null} triggeringMention - The triggering mention text, if any
 * @param {object} client - Discord.js client instance
 * @param {boolean} hasActivePersonality - Whether there's an active conversation or activated channel
 * @returns {Promise<object>} - Returns processed content and reference information
 */
async function processMessageLinks(
  message,
  messageContent,
  referencedPersonalityInfo,
  isReferencedMessageFromBot,
  referencedWebhookName,
  triggeringMention,
  client,
  hasActivePersonality = false
) {
  // Default return object with original content and no reference info
  const result = {
    messageContent,
    referencedMessageContent: '',
    referencedMessageAuthor: '',
    isReferencedMessageFromBot: false,
    referencedPersonalityInfo: null,
    referencedWebhookName: null,
    hasProcessedLink: false,
    referencedImageUrl: null,
    referencedAudioUrl: null,
  };

  if (typeof messageContent !== 'string') {
    return result;
  }

  // Look for Discord message links in all domain variations (regular, PTB, canary)
  const messageLinkMatch = messageContent.match(MESSAGE_LINK_REGEX);

  // If we have a match AND either:
  // 1. We're replying to a personality webhook OR
  // 2. This is a direct personality interaction via @mention OR
  // 3. There's an active conversation or activated channel personality
  const isReplyToPersonality =
    message.reference &&
    (referencedPersonalityInfo?.name || (isReferencedMessageFromBot && referencedWebhookName));

  if (!messageLinkMatch || !(isReplyToPersonality || triggeringMention || hasActivePersonality)) {
    if (messageLinkMatch) {
      logger.debug(
        `[ProcessMessageLinks] Found link but conditions not met - isReplyToPersonality: ${isReplyToPersonality}, triggeringMention: ${triggeringMention}, hasActivePersonality: ${hasActivePersonality}`
      );
    }
    return result;
  }

  logger.info(
    `[Bot] Found message link in content while ${isReplyToPersonality ? 'replying to personality' : triggeringMention ? 'mentioning personality' : 'in active conversation'}: ${messageLinkMatch[0]}`
  );

  // Check if there are multiple links (log for info purposes)
  const allLinks = [...messageContent.matchAll(new RegExp(MESSAGE_LINK_REGEX, 'g'))];
  if (allLinks.length > 1) {
    logger.info(
      `[Bot] Multiple message links found (${allLinks.length}), processing only the first one`
    );
  }

  try {
    // Extract channel and message IDs from the first link - account for subdomain capture group
    // Group 1 is the optional subdomain (ptb. or canary.), so we need to offset indexes
    const linkedGuildId = messageLinkMatch[2];
    const linkedChannelId = messageLinkMatch[3];
    const linkedMessageId = messageLinkMatch[4];

    // Replace the message link with a placeholder that clarifies what was linked
    result.messageContent = messageContent
      .replace(messageLinkMatch[0], '[Discord message link]')
      .trim();

    try {
      // Try to get the guild - check both the cache and attempt to fetch if needed
      const guild = client.guilds.cache.get(linkedGuildId);

      if (guild) {
        logger.info(
          `[Bot] Found guild in cache for cross-server link: ${guild.name} (${linkedGuildId})`
        );

        // Try to get the channel from this guild
        const linkedChannel = guild.channels.cache.get(linkedChannelId);
        if (linkedChannel && linkedChannel.isTextBased()) {
          try {
            // Fetch the message from the channel
            const linkedMessage = await linkedChannel.messages.fetch(linkedMessageId);

            if (linkedMessage) {
              // Extract content and author information
              result.referencedMessageContent = linkedMessage.content || '';
              result.referencedMessageAuthor = linkedMessage.author?.username || 'another user';
              result.referencedMessageAuthorId = linkedMessage.author?.id || null;
              result.isReferencedMessageFromBot = linkedMessage.author?.bot || false;

              // Initialize personality info variables for linked messages too
              result.referencedPersonalityInfo = null;
              result.referencedWebhookName = null;

              // If it's a webhook, try to get personality name
              if (linkedMessage.webhookId) {
                result.referencedWebhookName = linkedMessage.author?.username || null;

                // Try to get the personality from webhook username or from our message map
                try {
                  const { getPersonalityFromMessage } = require('../conversationManager');
                  const personalityManager = require('../personalityManager');

                  // Try to look up by message ID first
                  const personalityName = getPersonalityFromMessage(linkedMessage.id, {
                    webhookUsername: result.referencedWebhookName || undefined,
                  });

                  if (personalityName) {
                    // Get display name for the personality if available
                    try {
                      // Use the listPersonalitiesForUser function with null to get all personalities
                      const allPersonalities = personalityManager.listPersonalitiesForUser(null);

                      // Find the matching personality by name
                      const personalityData = allPersonalities.find(
                        p => p.fullName === personalityName
                      );

                      if (personalityData) {
                        result.referencedPersonalityInfo = {
                          name: personalityName,
                          displayName: personalityData.displayName,
                        };

                        logger.info(
                          `[Bot] Identified linked message as from personality: ${personalityName}`
                        );
                      } else {
                        // If we can't find the personality data, just use the name
                        result.referencedPersonalityInfo = {
                          name: personalityName,
                          displayName: personalityName.split('-')[0], // Simple extraction of first part of name
                        };
                        logger.info(
                          `[Bot] Using simple name extraction for linked message personality: ${personalityName}`
                        );
                      }
                    } catch (personalityLookupError) {
                      logger.error(
                        `[Bot] Error looking up personality data for linked message: ${personalityLookupError.message}`
                      );
                      // Still set the name even if we couldn't get full data
                      result.referencedPersonalityInfo = {
                        name: personalityName,
                        displayName: personalityName.split('-')[0], // Simple extraction of first part of name
                      };
                    }
                  }
                } catch (personalityLookupError) {
                  logger.error(
                    `[Bot] Error looking up linked message personality: ${personalityLookupError.message}`
                  );
                }
              }

              // Skip media attachments for personalities since they're redundant with text content
              // There are two ways to identify a personality message:
              // 1. It has a webhook ID and we found a personality name with lookups
              // 2. For DM channels, it's a bot message with the **Name:** prefix format
              const isPersonalityByLookup =
                linkedMessage.webhookId && result.referencedPersonalityInfo?.name;
              const isDMPersonalityFormat =
                linkedMessage.channel.isDMBased() &&
                linkedMessage.author?.id === client.user.id &&
                linkedMessage.content?.match(/^\*\*([^:]+):\*\* /);

              const isFromPersonality = isPersonalityByLookup || isDMPersonalityFormat;

              if (isDMPersonalityFormat && !result.referencedPersonalityInfo?.name) {
                // If we identified a DM personality format but didn't set referencedPersonalityInfo,
                // extract the personality name from the prefix
                const dmFormatMatch = linkedMessage.content.match(/^\*\*([^:]+):\*\* /);
                if (dmFormatMatch && dmFormatMatch[1]) {
                  const extractedName = dmFormatMatch[1];
                  result.referencedPersonalityInfo = {
                    name: extractedName, // We don't know the full name here
                    displayName: extractedName,
                  };
                  logger.info(`[Bot] Extracted personality name from DM format: ${extractedName}`);
                }
              }

              // Handle embeds if present - adding their content to the referenced message
              if (linkedMessage.embeds && linkedMessage.embeds.length > 0) {
                try {
                  const embedText = parseEmbedsToText(linkedMessage.embeds, 'linked message');
                  if (embedText) {
                    // Add the embed text to the referenced message content
                    result.referencedMessageContent += embedText;
                    logger.debug(`[Bot] Added embed content from linked message`);
                  }
                } catch (embedError) {
                  logger.error(
                    `[Bot] Error parsing embeds from linked message: ${embedError.message}`
                  );
                }
              }

              // Handle attachments - convert to [Image: url] or [Audio: url] format
              if (
                linkedMessage.attachments &&
                linkedMessage.attachments.size > 0 &&
                !isFromPersonality
              ) {
                try {
                  for (const [_, attachment] of linkedMessage.attachments) {
                    const isAudio =
                      attachment.contentType && attachment.contentType.startsWith('audio/');
                    const isImage =
                      attachment.contentType && attachment.contentType.startsWith('image/');

                    if (isImage) {
                      result.referencedMessageContent += `\n[Image: ${attachment.url}]`;
                      // Store the first image URL for media processing
                      if (!result.referencedImageUrl) {
                        result.referencedImageUrl = attachment.url;
                      }
                      logger.debug(
                        `[Bot] Added image attachment from linked message: ${attachment.url}`
                      );
                    } else if (isAudio) {
                      result.referencedMessageContent += `\n[Audio: ${attachment.url}]`;
                      // Store the first audio URL for media processing (audio takes priority)
                      if (!result.referencedAudioUrl) {
                        result.referencedAudioUrl = attachment.url;
                      }
                      logger.debug(
                        `[Bot] Added audio attachment from linked message: ${attachment.url}`
                      );
                    } else {
                      logger.debug(
                        `[Bot] Skipping non-media attachment in linked message: ${attachment.contentType}`
                      );
                    }
                  }
                } catch (attachmentError) {
                  logger.error(
                    `[Bot] Error processing attachments from linked message: ${attachmentError.message}`
                  );
                }
              }

              result.hasProcessedLink = true;
            }
          } catch (messageError) {
            logger.error(`[Bot] Error fetching linked message: ${messageError.message}`);
          }
        } else {
          logger.warn(
            `[Bot] Cannot find linked channel or it's not text-based: ${linkedChannelId}`
          );
        }
      } else {
        logger.warn(`[Bot] Bot cannot access the linked message's guild: ${linkedGuildId}`);
      }
    } catch (guildError) {
      logger.error(`[Bot] Error accessing guild for linked message: ${guildError.message}`);
    }
  } catch (linkError) {
    logger.error(`[Bot] Error processing message link: ${linkError.message}`);
  }

  return result;
}

module.exports = {
  handleMessageReference,
  processMessageLinks,
  MESSAGE_LINK_REGEX,
};
