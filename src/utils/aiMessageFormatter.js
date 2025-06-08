const logger = require('../logger');
const { sanitizeApiText } = require('./contentSanitizer');
const { getPersonality } = require('../core/personality');

/**
 * Formats messages for API request, handling text, images, audio, and referenced messages
 * @module utils/aiMessageFormatter
 */

/**
 * Format messages for API request, handling text, images, and referenced messages
 * @param {string|Array|Object} content - Text message, array of content objects, or complex object with reference
 * @param {string} personalityName - The name of the personality to use in media prompts
 * @param {string} [userName] - The user's formatted name (displayName + username)
 * @param {boolean} [isProxyMessage] - Whether this is a proxy system message (PluralKit, etc)
 * @returns {Promise<Array>} Formatted messages array for API request
 */
async function formatApiMessages(
  content,
  personalityName,
  userName = 'a user',
  isProxyMessage = false
) {
  try {
    // Check if the content is an object with a special reference format
    if (
      content &&
      typeof content === 'object' &&
      !Array.isArray(content) &&
      content.messageContent
    ) {
      // Log for debugging with user info
      logger.debug(`[AIMessageFormatter] Formatting message from ${userName}`);
      logger.debug(`[AIMessageFormatter] Formatting special reference message format`);

      // If we have a referenced message
      if (content.referencedMessage) {
        // Always use a consistent implementation without test-specific branches
        logger.debug(`[AIMessageFormatter] Processing referenced message`);

        // Get the name of the Discord user who is making the reference
        const userName = content.userName || 'The user';

        // Sanitize the content of the referenced message (remove control characters)
        const sanitizedReferenceContent = content.referencedMessage.content
          ? sanitizeApiText(content.referencedMessage.content)
          : '';

        logger.debug(
          `[AIMessageFormatter] Processing referenced message: ${JSON.stringify({
            authorType: content.referencedMessage.isFromBot ? 'bot' : 'user',
            contentPreview: sanitizedReferenceContent.substring(0, 50) || 'No content',
            referencingUser: userName,
          })}`
        );

        try {
          // Initialize cleaned reference content early for use throughout the function
          const cleanedRefContent = content.referencedMessage.content;

          // First, check if media URLs were provided directly (from embed extraction)
          let mediaUrl = null;
          let mediaType = null;

          if (content.referencedMessage.audioUrl) {
            mediaUrl = content.referencedMessage.audioUrl;
            mediaType = 'audio';
            logger.debug(
              `[AIMessageFormatter] Using provided audio URL from reference: ${mediaUrl}`
            );
          } else if (content.referencedMessage.imageUrl) {
            mediaUrl = content.referencedMessage.imageUrl;
            mediaType = 'image';
            logger.debug(
              `[AIMessageFormatter] Using provided image URL from reference: ${mediaUrl}`
            );
          } else {
            // Fallback to extracting from text content for backward compatibility
            const hasImage = sanitizedReferenceContent.includes('[Image:');
            const hasAudio = sanitizedReferenceContent.includes('[Audio:');

            if (hasAudio) {
              // Audio has priority over images
              const audioMatch = sanitizedReferenceContent.match(/\[Audio: (https?:\/\/[^\s\]]+)]/);
              if (audioMatch && audioMatch[1]) {
                mediaUrl = audioMatch[1];
                mediaType = 'audio';
                logger.debug(`[AIMessageFormatter] Found audio URL in reference text: ${mediaUrl}`);
              }
            } else if (hasImage) {
              const imageMatch = sanitizedReferenceContent.match(/\[Image: (https?:\/\/[^\s\]]+)]/);
              if (imageMatch && imageMatch[1]) {
                mediaUrl = imageMatch[1];
                mediaType = 'image';
                logger.debug(`[AIMessageFormatter] Found image URL in reference text: ${mediaUrl}`);
              }
            }
          }

          // Clean the referenced message content (remove media URLs and embed media references)
          let cleanContent = sanitizedReferenceContent
            .replace(/\[Image: https?:\/\/[^\s\]]+]/g, '')
            .replace(/\[Audio: https?:\/\/[^\s\]]+]/g, '')
            .replace(/\[Embed Image: https?:\/\/[^\s\]]+]/g, '')
            .replace(/\[Embed Thumbnail: https?:\/\/[^\s\]]+]/g, '')
            .trim();

          // If the content is empty after removing media URLs, add a placeholder
          if (!cleanContent && mediaUrl) {
            cleanContent = mediaType === 'image' ? '[Image]' : '[Audio Message]';
            logger.info(
              `[AIMessageFormatter] Adding media placeholder to empty reference: ${cleanContent}`
            );
          }

          // Get user's message content (text or multimodal)
          const userMessageContent = content.messageContent;

          // Check if user is referencing their own message (need this early for media reference text)
          const currentUserId = content.userId;
          const referencedAuthorId = content.referencedMessage.authorId;
          const currentUserName = content.userName || 'The user';
          const referencedAuthor = content.referencedMessage.author;
          // Compare by user ID if available, otherwise fall back to username comparison
          const isUserSelfReference =
            currentUserId && referencedAuthorId
              ? currentUserId === referencedAuthorId
              : currentUserName === referencedAuthor;

          // Create natural phrasing for referenced messages with media
          let mediaContext = '';
          if (mediaType === 'image') {
            mediaContext = isUserSelfReference ? ' (with an image I shared)' : ` (with an image)`;
            logger.debug(`[AIMessageFormatter] Created image reference context`);
          } else if (mediaType === 'audio') {
            mediaContext = isUserSelfReference ? ' (with audio I shared)' : ` (with audio)`;
            logger.debug(`[AIMessageFormatter] Created audio reference context`);
          }

          // Create natural reference text
          // For webhook messages (like PluralKit), prefer the webhook name over generic "another user"
          let authorText;
          if (isUserSelfReference) {
            authorText = 'I';
          } else if (content.referencedMessage.isFromBot && content.referencedMessage.webhookName) {
            // Use webhook name for PluralKit and similar webhook messages
            authorText = content.referencedMessage.webhookName;
          } else if (
            content.referencedMessage.isFromBot &&
            content.referencedMessage.personalityDisplayName
          ) {
            // Use personality display name if available
            authorText = content.referencedMessage.personalityDisplayName;
          } else {
            // Fall back to the author field
            authorText = content.referencedMessage.author;
          }
          const fullReferenceContent = `${authorText} said${mediaContext}:\n"${cleanContent}"`;

          // For bot messages, try to get the proper display name
          let assistantReferenceContent = '';

          if (content.referencedMessage.isFromBot) {
            // Try to get proper display name from the personality manager
            const fullName = content.referencedMessage.personalityName;
            let displayName;

            // Try to get the personality from the personality manager
            const personalityObject = fullName ? await getPersonality(fullName) : null;
            if (personalityObject && personalityObject.displayName) {
              // Use display name from personality manager if available
              displayName = personalityObject.displayName;
            } else {
              // Fall back to provided display name or the personality name
              displayName =
                content.referencedMessage.personalityDisplayName ||
                content.referencedMessage.displayName ||
                fullName;
            }

            // Format name with display name and full name in parentheses, unless they're the same
            const formattedName =
              displayName && fullName && displayName !== fullName
                ? `${displayName} (${fullName})`
                : displayName ||
                  fullName ||
                  content.referencedMessage.webhookName ||
                  content.referencedMessage.author ||
                  'the bot';

            // Check if the referenced personality is the same as the current personality
            const isSamePersonality = content.referencedMessage.personalityName === personalityName;

            if (isSamePersonality) {
              // Second-person reference when user is talking to the same personality
              assistantReferenceContent = `You said${mediaContext}: "${cleanContent}"`;
            } else {
              // Third-person reference if it's a different personality
              assistantReferenceContent = `${formattedName} said${mediaContext}: "${cleanContent}"`;
            }
          }

          // When the reference is to a bot message (personality), format it as appropriate
          // For bot messages we want to use assistant role ONLY for the current personality
          // For other personalities and users, we use user role to ensure the AI can see them consistently
          let referenceDescriptor;

          if (content.referencedMessage.isFromBot) {
            // Check if it's the same personality as the one we're using now
            const isSamePersonality = content.referencedMessage.personalityName === personalityName;

            if (isSamePersonality) {
              // Use assistant role for the personality's own messages to avoid echo
              // Use cleaned content to avoid media duplication
              referenceDescriptor = {
                role: 'assistant',
                content: assistantReferenceContent || cleanedRefContent,
              };
              logger.debug(
                `[AIMessageFormatter] Using assistant role for reference to same personality: ${personalityName}`
              );
            } else {
              // Use user role for references to other personalities
              // Use cleaned content to avoid media duplication
              referenceDescriptor = {
                role: 'user',
                content: assistantReferenceContent || cleanedRefContent,
              };
              logger.debug(
                `[AIMessageFormatter] Using user role for reference to different personality: ${content.referencedMessage.personalityName}`
              );
            }
          } else {
            // Use user role for user messages
            // For user messages, create a cleaned version of the fullReferenceContent
            const cleanedFullReferenceContent = fullReferenceContent
              .replace(/\[Image: https?:\/\/[^\s\]]+\]/g, '')
              .replace(/\[Audio: https?:\/\/[^\s\]]+\]/g, '')
              .trim();
            referenceDescriptor = { role: 'user', content: cleanedFullReferenceContent };
            logger.debug(`[AIMessageFormatter] Using user role for reference to user message`);
          }

          // Create media message ONCE for the referenced message content (avoiding duplication)
          let mediaMessage = null;

          // Use the mediaUrl and mediaType that were already extracted earlier
          if (mediaUrl && mediaType) {
            if (mediaType === 'image') {
              mediaMessage = {
                role: 'user',
                content: [
                  { type: 'text', text: 'Please examine this image:' },
                  { type: 'image_url', image_url: { url: mediaUrl } },
                ],
              };
              logger.debug(`[AIMessageFormatter] Created media message for image: ${mediaUrl}`);
            } else if (mediaType === 'audio') {
              mediaMessage = {
                role: 'user',
                content: [
                  { type: 'text', text: 'Audio content:' },
                  { type: 'audio_url', audio_url: { url: mediaUrl } },
                ],
              };
              logger.debug(`[AIMessageFormatter] Created media message for audio: ${mediaUrl}`);
            }
          }

          // Hybrid approach: combine messages when replying to yourself, separate for different senders
          const isReplyingToSelf = currentUserName.includes(referencedAuthor);

          let messages;

          if (isReplyingToSelf) {
            // Same sender: combine into single message to avoid duplication
            const combinedContent = [];

            // Combine all text content into a single text element
            let combinedText = '';

            if (Array.isArray(userMessageContent)) {
              // Extract text from multimodal user content
              const userTextParts = userMessageContent
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join(' ');
              combinedText += userTextParts;
            } else {
              const sanitizedUserContent =
                typeof userMessageContent === 'string'
                  ? sanitizeApiText(userMessageContent)
                  : 'Message content missing';
              combinedText += sanitizedUserContent;
            }

            // Add reference context (with newline formatting)
            combinedText += '\n\n' + referenceDescriptor.content;

            // Add the combined text as first element
            combinedContent.push({
              type: 'text',
              text: combinedText,
            });

            // Add user's original media content (images/audio from user's message)
            if (Array.isArray(userMessageContent)) {
              const userMediaElements = userMessageContent.filter(
                item => item.type === 'image_url' || item.type === 'audio_url'
              );
              combinedContent.push(...userMediaElements);
            }

            // Add referenced media content if present (just the media URL, not the prompt text)
            if (mediaMessage && Array.isArray(mediaMessage.content)) {
              const mediaElements = mediaMessage.content.filter(
                item => item.type === 'audio_url' || item.type === 'image_url'
              );
              combinedContent.push(...mediaElements);
            }

            // Create single combined message
            const userMessage = { role: 'user', content: combinedContent };
            messages = [userMessage];

            logger.debug(
              `[AIMessageFormatter] Same sender detected - combined into single message`
            );
          } else {
            // Different senders: combine everything into single message for better AI processing
            const combinedContent = [];

            // Combine all text content into a single text element
            let combinedText = '';

            if (Array.isArray(userMessageContent)) {
              // Extract text from multimodal user content
              const userTextParts = userMessageContent
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join(' ');
              combinedText += userTextParts;
            } else {
              const sanitizedUserContent =
                typeof userMessageContent === 'string'
                  ? sanitizeApiText(userMessageContent)
                  : 'Message content missing';
              combinedText += sanitizedUserContent;
            }

            // Add reference context (with newline formatting)
            combinedText += '\n\n' + referenceDescriptor.content;

            // Add the combined text as first element
            combinedContent.push({
              type: 'text',
              text: combinedText,
            });

            // Add user's original media content (images/audio from user's message)
            if (Array.isArray(userMessageContent)) {
              const userMediaElements = userMessageContent.filter(
                item => item.type === 'image_url' || item.type === 'audio_url'
              );
              combinedContent.push(...userMediaElements);
            }

            // Add referenced media content if present (just the media URL, not the prompt text)
            if (mediaMessage && Array.isArray(mediaMessage.content)) {
              const mediaElements = mediaMessage.content.filter(
                item => item.type === 'audio_url' || item.type === 'image_url'
              );
              combinedContent.push(...mediaElements);
            }

            // Create single combined message
            const userMessage = { role: 'user', content: combinedContent };
            messages = [userMessage];

            logger.debug(
              `[AIMessageFormatter] Different senders detected - combined everything into single message for better AI processing`
            );
          }

          logger.info(`[DEBUG] Final messages being sent to AI API (count: ${messages.length}):`);
          messages.forEach((msg, index) => {
            logger.info(`[DEBUG] Message ${index + 1}: ${JSON.stringify(msg, null, 2)}`);
          });

          return messages;
        } catch (refError) {
          // If there's an error processing the reference, log it but continue
          logger.error(
            `[AIMessageFormatter] Error processing referenced message: ${refError.message}`
          );
          logger.error(`[AIMessageFormatter] Reference processing error stack: ${refError.stack}`);

          // Fall back to just sending the user's message
          const sanitizedContent =
            typeof content.messageContent === 'string'
              ? sanitizeApiText(content.messageContent)
              : Array.isArray(content.messageContent)
                ? content.messageContent
                : 'There was an error processing a referenced message.';

          return [{ role: 'user', content: sanitizedContent }];
        }
      }

      // If no reference but still using the special format, process user message normally
      if (Array.isArray(content.messageContent)) {
        return [{ role: 'user', content: content.messageContent }];
      } else {
        const sanitizedContent =
          typeof content.messageContent === 'string'
            ? sanitizeApiText(content.messageContent)
            : content.messageContent;

        return [{ role: 'user', content: sanitizedContent }];
      }
    }

    // Standard handling for non-reference formats
    if (Array.isArray(content)) {
      // Handle standard multimodal content array
      // For proxy messages only: prepend speaker identification if we have a userName and the first element is text
      if (
        isProxyMessage &&
        userName !== 'a user' &&
        content.length > 0 &&
        content[0].type === 'text'
      ) {
        const modifiedContent = [...content];
        modifiedContent[0] = {
          ...modifiedContent[0],
          text: `[${userName}]: ${modifiedContent[0].text}`,
        };
        return [{ role: 'user', content: modifiedContent }];
      }
      return [{ role: 'user', content }];
    }

    // Simple text message - sanitize if it's a string
    if (typeof content === 'string') {
      const sanitizedContent = sanitizeApiText(content);
      // For proxy messages only: prepend speaker identification if we have a userName
      const finalContent =
        isProxyMessage && userName !== 'a user'
          ? `[${userName}]: ${sanitizedContent}`
          : sanitizedContent;
      return [{ role: 'user', content: finalContent }];
    }

    // For non-string content, return as is
    return [{ role: 'user', content }];
  } catch (formatError) {
    // Log the error for debugging
    logger.error(`[AIMessageFormatter] Error in formatApiMessages: ${formatError.message}`);
    logger.error(`[AIMessageFormatter] Format error stack: ${formatError.stack}`);

    // Fall back to a simple message
    if (typeof content === 'string') {
      return [{ role: 'user', content: sanitizeApiText(content) }];
    } else if (Array.isArray(content)) {
      return [{ role: 'user', content }];
    } else if (content && typeof content === 'object' && content.messageContent) {
      // Try to extract just the message content without references
      return [
        {
          role: 'user',
          content:
            typeof content.messageContent === 'string'
              ? sanitizeApiText(content.messageContent)
              : Array.isArray(content.messageContent)
                ? content.messageContent
                : 'There was an error formatting my message.',
        },
      ];
    }

    // Ultimate fallback for completely broken content
    return [
      { role: 'user', content: 'I wanted to reference another message but there was an error.' },
    ];
  }
}

module.exports = {
  formatApiMessages,
};
