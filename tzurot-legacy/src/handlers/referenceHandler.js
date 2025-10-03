/**
 * Reference Handler Module
 *
 * This module handles message references in Discord, including:
 * - Replies to previous messages
 * - Discord message links in content
 * - Cross-server message link handling
 */

const logger = require('../logger');
const { getPersonalityFromMessage } = require('../core/conversation');
const { parseEmbedsToText } = require('../utils/embedUtils');
const messageTrackerHandler = require('./messageTrackerHandler');
const { getApplicationBootstrap } = require('../application/bootstrap/ApplicationBootstrap');
const pluralkitReplyTracker = require('../utils/pluralkitReplyTracker');

/**
 * Get personality by name using DDD system
 * @param {string} name - Personality name
 * @returns {Promise<Object|null>} Personality object or null
 */
async function getPersonality(name) {
  const bootstrap = getApplicationBootstrap();
  if (!bootstrap.initialized) {
    throw new Error('ApplicationBootstrap not initialized - system is starting up');
  }
  const service = bootstrap.getPersonalityApplicationService();
  return await service.getPersonality(name);
}

/**
 * Get personality by alias using DDD system
 * @param {string} alias - Personality alias
 * @returns {Promise<Object|null>} Personality object or null
 */
async function getPersonalityByAlias(alias) {
  // DDD system searches by name or alias in one method
  const bootstrap = getApplicationBootstrap();
  if (!bootstrap.initialized) {
    throw new Error('ApplicationBootstrap not initialized - system is starting up');
  }
  const service = bootstrap.getPersonalityApplicationService();
  return await service.getPersonality(alias);
}

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
 * @param {object} client - Discord.js client instance (optional, for PluralKit delay processing)
 * @returns {Promise<object>} - Returns { processed: boolean, wasReplyToNonPersonality: boolean }
 */
async function handleMessageReference(message, handlePersonalityInteraction, client = null) {
  if (!message.reference) {
    return { processed: false, wasReplyToNonPersonality: false };
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
    // DISABLED: This approach was modifying message content and causing issues with text extraction
    // The personalityHandler already handles nested references properly through its own reference processing
    if (referencedMessage.reference) {
      logger.info(
        `[ReferenceHandler] Detected nested reference - reply to a reply. Original reference: ${referencedMessage.reference.messageId}`
      );
      // Note: We no longer modify message content with synthetic links as this was causing
      // the bot to skip the current message's text content and only use the linked message
    }

    // Check if the referenced message was from one of our personalities
    logger.debug(
      `Reply detected to message ${referencedMessage.id} with webhookId: ${referencedMessage.webhookId || 'none'}`
    );

    if (referencedMessage.webhookId) {
      logger.debug(`Looking up personality for message ID: ${referencedMessage.id}`);

      // Check if this webhook belongs to the current bot instance
      // This prevents both dev and prod bots from responding to the same personality webhook
      if (
        client &&
        referencedMessage.applicationId &&
        referencedMessage.applicationId !== client.user.id
      ) {
        logger.debug(
          `Ignoring reply to webhook from different bot instance. Webhook applicationId: ${referencedMessage.applicationId}, Current bot ID: ${client.user.id}`
        );
        return { processed: false, wasReplyToNonPersonality: true };
      }

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
            applicationId: referencedMessage.applicationId,
          })}`
        );
      }

      const personalityName = await getPersonalityFromMessage(referencedMessage.id, {
        webhookUsername,
      });
      logger.debug(`Personality lookup result: ${personalityName || 'null'}`);

      if (personalityName) {
        logger.debug(`Found personality name: ${personalityName}, looking up personality details`);

        // First try to get personality directly as it could be a full name
        let personality = await getPersonality(personalityName);
        logger.debug(
          `Direct personality lookup for "${personalityName}": ${personality ? 'found' : 'not found'}`
        );

        // If not found as direct name, try it as an alias
        if (!personality) {
          logger.debug(
            `Attempting alias lookup with userId: ${message.author.id} and name: ${personalityName}`
          );
          personality = await getPersonalityByAlias(personalityName);
          logger.debug(`Alias lookup result: ${personality ? 'found' : 'not found'}`);
        }

        logger.debug(
          `Final personality lookup result: ${personality ? personality.fullName : 'null'}`
        );

        if (personality) {
          // Process the message with this personality
          logger.debug(
            `Processing reply with personality: ${personality.fullName} from user ${message.author.id}`
          );
          // Since this is a reply, not a direct @mention, pass null for triggeringMention
          // IMPORTANT: Use message.author.id to ensure the replying user's ID is used
          // This ensures authentication context is preserved correctly

          // Skip delay for DMs (PluralKit doesn't work in DMs)
          if (message.channel.isDMBased()) {
            // Process DM messages immediately
            await handlePersonalityInteraction(message, personality, null);
          } else {
            // Track this as a pending reply for Pluralkit handling
            pluralkitReplyTracker.trackPendingReply({
              channelId: message.channel.id,
              userId: message.author.id,
              content: message.content,
              personality: personality,
              referencedMessageId: referencedMessage.id,
              originalMessageId: message.id, // Track the original message ID
            });

            // For server channels, implement the delay for PluralKit proxy handling
            // If client is provided, use delayed processing for PluralKit compatibility
            if (client) {
              await messageTrackerHandler.delayedProcessing(
                message,
                personality,
                null,
                client,
                handlePersonalityInteraction
              );
            } else {
              // Fallback to direct handling if no client provided
              await handlePersonalityInteraction(message, personality, null);
            }
          }
          return { processed: true, wasReplyToNonPersonality: false };
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

      // This was a reply to a non-personality message
      // Check if the referenced message contains Discord message links that should be processed
      if (referencedMessage.content && typeof referencedMessage.content === 'string') {
        const hasMessageLink = MESSAGE_LINK_REGEX.test(referencedMessage.content);
        if (hasMessageLink) {
          logger.debug(
            `Referenced non-personality message contains Discord link(s), will need further processing`
          );
          // Return a special flag indicating this needs link processing in the messageHandler
          // Also return the referenced message content so it can be processed for links
          return {
            processed: false,
            wasReplyToNonPersonality: true,
            containsMessageLinks: true,
            referencedMessageContent: referencedMessage.content,
            referencedMessageAuthor: referencedMessage.author?.username || 'another user',
          };
        }
      }

      // No message links found in referenced message, but still return the content
      // for potential mention processing in messageHandler
      return {
        processed: false,
        wasReplyToNonPersonality: true,
        referencedMessageContent: referencedMessage.content,
        referencedMessageAuthor: referencedMessage.author?.username || 'another user',
      };
    }
  } catch (error) {
    if (error.message === 'Unknown Message') {
      logger.warn(
        `Referenced message ${message.reference.messageId} no longer exists (deleted or inaccessible)`
      );
    } else {
      logger.error('Error handling message reference:', error);
    }
  }

  return { processed: false, wasReplyToNonPersonality: false };
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
                  const { getPersonalityFromMessage } = require('../core/conversation');

                  // Try to look up by message ID first
                  const personalityName = await getPersonalityFromMessage(linkedMessage.id, {
                    webhookUsername: result.referencedWebhookName || undefined,
                  });

                  if (personalityName) {
                    // Get display name for the personality if available using DDD system
                    try {
                      // First try to get personality directly as it could be a full name
                      let personalityData = await getPersonality(personalityName);

                      // If not found as direct name, try it as an alias
                      if (!personalityData) {
                        personalityData = await getPersonalityByAlias(personalityName);
                      }

                      if (personalityData) {
                        result.referencedPersonalityInfo = {
                          name: personalityName,
                          displayName:
                            personalityData.profile?.displayName ||
                            personalityData.name ||
                            personalityName,
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

                  // Also extract media URLs from embeds and add them as markers
                  if (!isFromPersonality) {
                    const { extractMediaFromEmbeds } = require('../utils/embedUtils');
                    const { audioUrl, imageUrl } = extractMediaFromEmbeds(linkedMessage.embeds);

                    if (imageUrl && !result.referencedImageUrl) {
                      result.referencedImageUrl = imageUrl;
                      // Add the image marker to content if not already present
                      if (!result.referencedMessageContent.includes(`[Image: ${imageUrl}]`)) {
                        result.referencedMessageContent += `\n[Image: ${imageUrl}]`;
                      }
                      logger.debug(`[Bot] Extracted image from embed: ${imageUrl}`);
                    }

                    if (audioUrl && !result.referencedAudioUrl) {
                      result.referencedAudioUrl = audioUrl;
                      // Add the audio marker to content if not already present
                      if (!result.referencedMessageContent.includes(`[Audio: ${audioUrl}]`)) {
                        result.referencedMessageContent += `\n[Audio: ${audioUrl}]`;
                      }
                      logger.debug(`[Bot] Extracted audio from embed: ${audioUrl}`);
                    }
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

              // Also check for media markers in the linked message content
              // This handles media that was extracted from embeds
              if (!isFromPersonality) {
                // Extract image URLs from [Image: url] markers
                const imageMatches = [...linkedMessage.content.matchAll(/\[Image: ([^\]]+)\]/g)];
                for (const match of imageMatches) {
                  const imageUrl = match[1];
                  if (!result.referencedImageUrl) {
                    result.referencedImageUrl = imageUrl;
                    logger.debug(`[Bot] Found image marker in linked message content: ${imageUrl}`);
                  }
                  // Still add to content for context
                  if (!result.referencedMessageContent.includes(`[Image: ${imageUrl}]`)) {
                    result.referencedMessageContent += `\n[Image: ${imageUrl}]`;
                  }
                }

                // Extract audio URLs from [Audio: url] markers
                const audioMatches = [...linkedMessage.content.matchAll(/\[Audio: ([^\]]+)\]/g)];
                for (const match of audioMatches) {
                  const audioUrl = match[1];
                  if (!result.referencedAudioUrl) {
                    result.referencedAudioUrl = audioUrl;
                    logger.debug(`[Bot] Found audio marker in linked message content: ${audioUrl}`);
                  }
                  // Still add to content for context
                  if (!result.referencedMessageContent.includes(`[Audio: ${audioUrl}]`)) {
                    result.referencedMessageContent += `\n[Audio: ${audioUrl}]`;
                  }
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
