/**
 * Message Handler
 *
 * Clean, simple message routing for Discord messages.
 * Routes to either command processing or AI personality responses.
 */

import type { Message } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import { GatewayClient } from '../gateway/GatewayClient.js';
import { WebhookManager } from '../webhooks/WebhookManager.js';
import {
  ConversationHistoryService,
  PersonalityService,
  UserService,
  preserveCodeBlocks,
  createLogger,
  getConfig,
  INTERVALS,
} from '@tzurot/common-types';
import type {
  LoadedPersonality,
  ReferencedMessage,
  ConversationMessage,
} from '@tzurot/common-types';
import type { MessageContext } from '../types.js';
import { storeWebhookMessage, getWebhookPersonality, storeVoiceTranscript } from '../redis.js';
import { extractDiscordEnvironment } from '../utils/discordContext.js';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';
import { MessageReferenceExtractor } from '../context/MessageReferenceExtractor.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { formatReferencesForDatabase } from '../utils/referenceFormatter.js';

const logger = createLogger('MessageHandler');

/**
 * Message Handler - routes Discord messages to appropriate handlers
 */
export class MessageHandler {
  private gatewayClient: GatewayClient;
  private webhookManager: WebhookManager;
  private conversationHistory: ConversationHistoryService;
  private personalityService: PersonalityService;
  private userService: UserService;

  constructor(gatewayClient: GatewayClient, webhookManager: WebhookManager) {
    this.gatewayClient = gatewayClient;
    this.webhookManager = webhookManager;
    this.conversationHistory = new ConversationHistoryService();
    this.personalityService = new PersonalityService();
    this.userService = new UserService();
  }

  /**
   * Handle incoming Discord message
   */
  async handleMessage(message: Message): Promise<void> {
    try {
      // Ignore bot messages
      if (message.author.bot) {
        return;
      }

      // Ignore empty messages (but allow attachments without text)
      if (message.content.length === 0 && message.attachments.size === 0) {
        return;
      }

      logger.debug(`[MessageHandler] Processing message from ${message.author.tag}`);

      // Check for voice message auto-transcription (if enabled)
      const config = getConfig();
      const hasVoiceAttachment = message.attachments.some(
        a => a.contentType?.startsWith('audio/') || a.duration !== null
      );

      // Store voice transcript for voice+personality messages
      let voiceTranscript: string | undefined;

      if (hasVoiceAttachment && config.AUTO_TRANSCRIBE_VOICE === 'true') {
        // ALWAYS transcribe and send transcript as bot first
        logger.debug('[MessageHandler] Auto-transcribing voice message');
        voiceTranscript = await this.handleVoiceTranscription(message);

        // Check if this message ALSO targets a personality
        const isReply = message.reference !== null;
        const mentionCheck = await findPersonalityMention(
          message.content,
          getConfig().BOT_MENTION_CHAR,
          this.personalityService
        );
        const hasMention = mentionCheck !== null || message.mentions.has(message.client.user!);

        if (!isReply && !hasMention) {
          // Voice-only: Transcription already sent, we're done
          return;
        }

        // Voice + personality mention: Continue to personality handler
        // Pass transcript as message content so it's stored in conversation history
        logger.debug(
          '[MessageHandler] Voice message with personality mention - continuing to personality handler with transcript'
        );
      }

      // Check for replies to personality messages (best UX - no @mention needed)
      if (message.reference !== null) {
        const replyResult = await this.handleReply(message, voiceTranscript);
        if (replyResult) {
          return; // Reply was handled
        }
      }

      // Check for personality mentions (e.g., "@personality hello")
      const mentionMatch = await findPersonalityMention(
        message.content,
        getConfig().BOT_MENTION_CHAR,
        this.personalityService
      );

      if (mentionMatch !== null) {
        // Load personality from database (with PersonalityService's cache)
        const personality = await this.personalityService.loadPersonality(
          mentionMatch.personalityName
        );

        if (personality !== null) {
          // For voice messages, use transcript instead of empty cleanContent
          const content = voiceTranscript || mentionMatch.cleanContent;
          await this.handlePersonalityMessage(message, personality, content);
        } else {
          // Silently ignore unknown personality mentions (likely typos or non-bot mentions)
          logger.debug(
            `[MessageHandler] Unknown personality mentioned: ${mentionMatch.personalityName}`
          );
        }
        return;
      }

      // Check for bot mention - use default personality if configured
      if (message.mentions.has(message.client.user!)) {
        const defaultPersonality = await this.personalityService.loadPersonality('default');
        if (defaultPersonality !== null) {
          const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
          // For voice messages, use transcript instead of empty cleanContent
          const content = voiceTranscript || cleanContent;
          await this.handlePersonalityMessage(message, defaultPersonality, content);
        }
        return;
      }

      // Commands handled here in the future
      // For now, only respond to explicit mentions
    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error processing message');

      // Try to send error message to user
      await message.reply('Sorry, I encountered an error processing your message.').catch(() => {
        // Ignore errors when sending error message
      });
    }
  }

  /**
   * Handle replies to webhook messages
   * Returns true if reply was handled, false otherwise
   */
  private async handleReply(
    message: Message,
    voiceTranscript?: string
  ): Promise<boolean> {
    try {
      // Fetch the message being replied to
      const referencedMessage = await message.channel.messages.fetch(message.reference!.messageId!);

      // Check if it's from a webhook (personality message)
      if (!referencedMessage.webhookId) {
        logger.debug('[MessageHandler] Reply is to a non-webhook message, skipping');
        return false;
      }

      // Check if this webhook belongs to the current bot instance
      // This prevents both dev and prod bots from responding to the same personality webhook
      if (
        referencedMessage.applicationId &&
        referencedMessage.applicationId !== message.client.user!.id
      ) {
        logger.debug(
          `[MessageHandler] Ignoring reply to webhook from different bot instance. Webhook applicationId: ${referencedMessage.applicationId}, Current bot ID: ${message.client.user!.id}`
        );
        return false;
      }

      // Try Redis lookup first
      let personalityName = await getWebhookPersonality(referencedMessage.id);

      // Fallback: Parse webhook username if Redis lookup fails
      if (!personalityName && referencedMessage.author) {
        const webhookUsername = referencedMessage.author.username;
        logger.debug(
          `[MessageHandler] Redis lookup failed, parsing webhook username: ${webhookUsername}`
        );

        // Extract personality name by removing bot suffix
        // Format: "Personality | suffix" -> "Personality"
        if (webhookUsername.includes(' | ')) {
          personalityName = webhookUsername.split(' | ')[0].trim();
          logger.debug(
            `[MessageHandler] Extracted personality name from webhook username: ${personalityName}`
          );
        }
      }

      if (!personalityName) {
        logger.debug('[MessageHandler] No personality found for webhook message, skipping');
        return false;
      }

      // Load the personality
      const personality = await this.personalityService.loadPersonality(personalityName);

      if (!personality) {
        logger.warn(`[MessageHandler] Personality ${personalityName} not found for reply`);
        return false;
      }

      logger.info(`[MessageHandler] Routing reply to ${personality.displayName}`);

      // Handle the message with the personality
      // For voice messages, use the transcript instead of empty message.content
      const content = voiceTranscript || message.content;
      await this.handlePersonalityMessage(message, personality, content);
      return true;
    } catch (error) {
      // If we can't fetch the referenced message, it might be deleted or inaccessible
      logger.debug({ err: error }, '[MessageHandler] Could not fetch referenced message');
      return false;
    }
  }

  /**
   * Handle message directed at a personality
   */
  private async handlePersonalityMessage(
    message: Message,
    personality: LoadedPersonality,
    content: string
  ): Promise<void> {
    let typingInterval: NodeJS.Timeout | null = null;

    try {
      // Start typing indicator and keep it active until response is ready
      // Discord's typing indicator lasts ~10 seconds, so refresh every 8 seconds
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
        typingInterval = setInterval(async () => {
          try {
            if ('sendTyping' in message.channel) {
              await message.channel.sendTyping();
            }
          } catch (error) {
            // Channel might be deleted or inaccessible - stop trying
            logger.debug(
              { err: error },
              '[MessageHandler] Typing indicator error, clearing interval'
            );
            if (typingInterval) {
              clearInterval(typingInterval);
              typingInterval = null;
            }
          }
        }, INTERVALS.TYPING_INDICATOR_REFRESH);
      }

      // Get or create user record FIRST (needed for conversation history query)
      // Use display name: server nickname > global display name > username
      const displayName =
        message.member?.displayName || message.author.globalName || message.author.username;

      // Note: Discord API doesn't expose user bios to bots (privacy restriction)
      // Bio parameter left undefined, so persona content will be empty
      const userId = await this.userService.getOrCreateUser(
        message.author.id,
        message.author.username,
        displayName
      );

      // Get the persona for this user + personality combination
      const personaId = await this.userService.getPersonaForUser(userId, personality.id);
      const personaName = await this.userService.getPersonaName(personaId);

      logger.debug(
        `[MessageHandler] User persona lookup: personaId=${personaId}, personaName=${personaName}, userId=${userId}, personalityId=${personality.id}`
      );

      // Get conversation history from PostgreSQL (needed for reference deduplication)
      const historyLimit = personality.contextWindow || 20;
      const history = await this.conversationHistory.getRecentHistory(
        message.channel.id,
        personality.id,
        historyLimit
      );

      // Extract Discord message IDs and timestamps for deduplication
      // Note: discordMessageId is now an array (for chunked messages), so we flatten all chunks
      const conversationHistoryMessageIds = history
        .flatMap(msg => msg.discordMessageId || [])
        .filter((id): id is string => id !== undefined && id !== null);

      const conversationHistoryTimestamps = history.map(msg => msg.createdAt);

      // Debug logging for voice message replies (helps diagnose reference duplication)
      if (message.attachments.some(a => a.contentType?.startsWith('audio/') || a.duration !== null)) {
        const mostRecentAssistant = history.filter(m => m.role === 'assistant').slice(-1)[0];
        const mostRecentAssistantIds = mostRecentAssistant?.discordMessageId || [];

        logger.debug(
          {
            isReply: message.reference !== null,
            replyToMessageId: message.reference?.messageId,
            messageContent: content || '(empty - voice only)',
            channelId: message.channel.id,
            isThread: message.channel.isThread(),
            historyCount: history.length,
            historyWithIds: conversationHistoryMessageIds.length,
            conversationHistoryMessageIds,
            mostRecentAssistantIds,
            mostRecentAssistantTimestamp: mostRecentAssistant?.createdAt,
            replyMatchesRecentAssistant: mostRecentAssistantIds.includes(message.reference?.messageId || ''),
          },
          '[MessageHandler] Processing voice message reply - deduplication data'
        );
      }

      // Extract referenced messages (from replies and message links)
      // This waits 2-3 seconds for Discord to process embeds
      // Uses conversation history message IDs for exact deduplication
      // Falls back to timestamp matching for very recent bot/webhook messages (race condition handling)
      // Also replaces Discord message links with [Reference N] placeholders
      logger.debug(
        '[MessageHandler] Extracting referenced messages with deduplication and link replacement'
      );
      const referenceExtractor = new MessageReferenceExtractor({
        maxReferences: 10,
        embedProcessingDelayMs: 2500, // 2.5 seconds to allow Discord to process embeds
        conversationHistoryMessageIds,
        conversationHistoryTimestamps,
      });
      const { references: referencedMessages, updatedContent } =
        await referenceExtractor.extractReferencesWithReplacement(message);

      // Enrich referenced messages with persona names instead of Discord display names
      if (referencedMessages.length > 0) {
        await this.enrichReferencesWithPersonaNames(referencedMessages, history, personality.id);

        logger.info(
          {
            count: referencedMessages.length,
            referenceNumbers: referencedMessages.map(r => r.referenceNumber),
            authors: referencedMessages.map(r => r.authorUsername),
            personaNames: referencedMessages.map(r => r.authorDisplayName),
          },
          `[MessageHandler] Extracted ${referencedMessages.length} referenced messages (after deduplication)`
        );
      }

      // Use updatedContent (with Discord links replaced by [Reference N]) for the AI context
      // Use nullish coalescing to preserve empty strings (e.g., message with only a link)
      const messageContentForAI = updatedContent ?? content ?? '[no text content]';

      // Convert to format expected by AI gateway
      // Include persona info so AI knows which persona is speaking in each message
      const conversationHistory = history.map(msg => ({
        id: msg.id, // Include UUID for deduplication in LTM
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt.toISOString(), // Include timestamp for context
        personaId: msg.personaId,
        personaName: msg.personaName, // Persona's name for context
      }));

      // Debug: check how many messages have personaName
      const messagesWithPersonaName = conversationHistory.filter(m => m.personaName).length;
      logger.debug(
        `[MessageHandler] Conversation history: ${conversationHistory.length} messages, ${messagesWithPersonaName} have personaName`
      );

      // Extract attachments if present (images, audio, etc)
      const attachments = extractAttachments(message.attachments);

      // Extract Discord environment context (DM vs guild, channel info, etc)
      const environment = extractDiscordEnvironment(message);

      // Build context with conversation history, attachments, and referenced messages
      const context: MessageContext = {
        userId: userId, // Use database UUID, not Discord ID
        userName: message.author.username,
        channelId: message.channel.id,
        serverId: message.guild?.id,
        messageContent: messageContentForAI, // Use content with links replaced by [Reference N]
        activePersonaId: personaId, // Current speaker's persona
        activePersonaName: personaName || undefined,
        conversationHistory,
        attachments,
        environment,
        referencedMessages: referencedMessages.length > 0 ? referencedMessages : undefined,
      };

      logger.debug(
        {
          activePersonaId: context.activePersonaId,
          activePersonaName: context.activePersonaName,
          historyLength: conversationHistory.length,
          hasReferencedMessages: !!context.referencedMessages,
          referencedMessagesCount: context.referencedMessages?.length || 0,
        },
        `[MessageHandler] Built context for AI request`
      );

      // Save user message to conversation history BEFORE calling AI
      // This ensures proper chronological ordering (user message timestamp < assistant response timestamp)
      // Start with just the message content - we'll add rich attachment/reference descriptions after AI processing
      await this.conversationHistory.addMessage(
        message.channel.id,
        personality.id,
        personaId,
        'user',
        messageContentForAI || '[no text content]',
        message.guild?.id || null,
        message.id // Discord message ID for deduplication
      );

      // Call API Gateway for AI generation (this will process attachments/references and return descriptions)
      const response = await this.gatewayClient.generate(personality, context);

      // Update user message with rich descriptions if available
      // The AI worker processes both attachments and references, returning descriptions with vision/transcription
      if (
        response.attachmentDescriptions ||
        response.referencedMessagesDescriptions ||
        (attachments && attachments.length > 0) ||
        referencedMessages.length > 0
      ) {
        let enrichedContent = messageContentForAI || content; // Start with content that has [Reference N] markers

        // Add attachment descriptions
        if (response.attachmentDescriptions) {
          // Use rich descriptions from vision/transcription models
          enrichedContent = enrichedContent
            ? `${enrichedContent}\n\n${response.attachmentDescriptions}`
            : response.attachmentDescriptions;
        } else if (attachments && attachments.length > 0) {
          // Fallback to simple placeholders if processing failed
          const attachmentDesc = attachments
            .map(a => {
              if (a.isVoiceMessage) {
                return `[voice message: ${a.duration}s]`;
              }
              if (a.contentType.startsWith('image/')) {
                return `[image: ${a.name || 'attachment'}]`;
              }
              if (a.contentType.startsWith('audio/')) {
                return `[audio: ${a.name || 'attachment'}]`;
              }
              return `[file: ${a.name || 'attachment'}]`;
            })
            .join(' ');

          enrichedContent = enrichedContent
            ? `${enrichedContent} ${attachmentDesc}`
            : attachmentDesc;
        }

        // Add reference descriptions (with vision/transcription from AI worker)
        if (response.referencedMessagesDescriptions) {
          // Use rich descriptions from AI worker (includes vision/transcription)
          enrichedContent += `\n\n${response.referencedMessagesDescriptions}`;
        } else if (referencedMessages.length > 0) {
          // Fallback to simple formatting if AI processing failed
          const formattedReferences = formatReferencesForDatabase(referencedMessages);
          enrichedContent += formattedReferences;
        }

        // Update the message we saved earlier with enriched content
        await this.conversationHistory.updateLastUserMessage(
          message.channel.id,
          personality.id,
          personaId,
          enrichedContent
        );
      }

      // Note: Assistant response is saved to conversation_history by ai-worker
      // during the storeInteraction() call, along with pending_memory tracking

      // Add model indicator to the message (for Discord display only, not in history)
      let contentWithIndicator = response.content;
      if (response.metadata?.modelUsed) {
        contentWithIndicator += `\n-# Model used: ${response.metadata.modelUsed}`;
      }

      // Send via webhook if in a guild text channel or thread
      const isWebhookChannel =
        message.guild !== null &&
        (message.channel instanceof TextChannel || message.channel instanceof ThreadChannel);

      const chunkMessageIds: string[] = [];

      if (isWebhookChannel) {
        // For webhooks, split content and send directly (no prefix needed)
        const chunks = preserveCodeBlocks(contentWithIndicator);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const sentMessage = await this.webhookManager.sendAsPersonality(
            message.channel as TextChannel | ThreadChannel,
            personality,
            chunk
          );

          // Store webhook message in Redis for reply routing (7 day TTL)
          if (sentMessage) {
            await storeWebhookMessage(sentMessage.id, personality.name);

            // Track ALL chunk message IDs for conversation history deduplication
            chunkMessageIds.push(sentMessage.id);
          }
        }
      } else {
        // DMs don't support webhooks - add personality name prefix BEFORE splitting
        // This ensures chunks respect 2000 char limit including the prefix
        const dmContent = `**${personality.displayName}:** ${contentWithIndicator}`;
        const chunks = preserveCodeBlocks(dmContent);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const sentMessage = await message.reply(chunk);
          // Store DM message in Redis for reply routing (7 day TTL)
          await storeWebhookMessage(sentMessage.id, personality.name);

          // Track ALL chunk message IDs for conversation history deduplication
          chunkMessageIds.push(sentMessage.id);
        }
      }

      // Update the assistant message in conversation history with ALL Discord chunk IDs
      // This enables deduplication when users reference any chunk of recent assistant messages
      if (chunkMessageIds.length > 0) {
        logger.debug(
          {
            channelId: message.channel.id,
            isThread: message.channel.isThread(),
            personalityId: personality.id,
            personaId: personaId.substring(0, 8),
            chunkCount: chunkMessageIds.length,
            discordMessageIds: chunkMessageIds,
          },
          '[MessageHandler] Updating last assistant message with Discord chunk IDs'
        );

        await this.conversationHistory.updateLastAssistantMessageId(
          message.channel.id,
          personality.id,
          personaId,
          chunkMessageIds
        );
      }

      logger.info(
        `[MessageHandler] Response sent as ${personality.displayName} (with ${conversationHistory.length} history messages)`
      );
    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error handling personality message');

      // Show the actual error to help with debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      await message.reply(`Error: ${errorMessage}`).catch(() => {});
    } finally {
      // Always clear the typing indicator interval
      if (typingInterval) {
        clearInterval(typingInterval);
      }
    }
  }

  /**
   * Handle voice message transcription
   * Sends transcription job to api-gateway and replies with chunked transcript
   * Returns the transcript text for potential caching
   */
  private async handleVoiceTranscription(message: Message): Promise<string | undefined> {
    try {
      // Show typing indicator (if channel supports it)
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      // Extract voice attachment metadata
      const attachments = Array.from(message.attachments.values()).map(attachment => ({
        url: attachment.url,
        contentType: attachment.contentType || 'application/octet-stream',
        name: attachment.name,
        size: attachment.size,
        isVoiceMessage: attachment.duration !== null,
        duration: attachment.duration ?? undefined,
        waveform: attachment.waveform ?? undefined,
      }));

      // Send transcribe job to api-gateway
      const response = await this.gatewayClient.transcribe(attachments);

      if (!response || !response.content) {
        throw new Error('No transcript returned from transcription service');
      }

      // Chunk the transcript (respecting 2000 char Discord limit)
      const chunks = preserveCodeBlocks(response.content);

      logger.info(
        `[MessageHandler] Transcription complete: ${response.content.length} chars, ${chunks.length} chunks`
      );

      // Send each chunk as a reply (these will appear BEFORE personality webhook response)
      for (const chunk of chunks) {
        await message.reply(chunk);
      }

      // Cache transcript in Redis to avoid re-transcribing if this voice message also targets a personality
      // Key by attachment URL with 5 min TTL (long enough for personality processing)
      const voiceAttachment = attachments[0]; // We know there's at least one
      if (voiceAttachment) {
        await storeVoiceTranscript(voiceAttachment.url, response.content);
        logger.debug(
          `[MessageHandler] Cached transcript for attachment: ${voiceAttachment.url.substring(0, 50)}...`
        );
      }

      return response.content;
    } catch (error) {
      logger.error({ err: error }, '[MessageHandler] Error transcribing voice message');
      await message.reply("Sorry, I couldn't transcribe that voice message.").catch(() => {});
      return undefined;
    }
  }

  /**
   * Enrich referenced messages with persona names instead of Discord display names
   *
   * For each referenced message:
   * 1. Look up the user's persona for the current personality
   * 2. Check if that persona appears in conversation history
   * 3. If yes, use persona name from history; if no, fetch from database
   * 4. Update the authorDisplayName field
   *
   * **Conversation History Stability Assumption**:
   * This method receives a snapshot of conversation history at the time of the message
   * processing cycle. We assume that conversation history remains stable during a single
   * message processing cycle (typically <1 second). If conversation history is modified
   * elsewhere during processing, the persona name Map could be stale. However, this is
   * unlikely in practice since:
   * - Message processing is synchronous for a given channel
   * - Conversation history updates happen after AI response generation
   * - Reference extraction and enrichment occur before any history updates
   *
   * In the rare case of stale history, the worst outcome is fetching from the database
   * instead of using the cached name - no data corruption occurs.
   */
  private async enrichReferencesWithPersonaNames(
    referencedMessages: ReferencedMessage[],
    conversationHistory: ConversationMessage[],
    personalityId: string
  ): Promise<void> {
    // Build a map of personaId -> personaName from conversation history for fast lookup
    const personaNameMap = new Map<string, string>();
    for (const msg of conversationHistory) {
      if (msg.personaName) {
        personaNameMap.set(msg.personaId, msg.personaName);
      }
    }

    // Enrich each referenced message
    for (const reference of referencedMessages) {
      let userId: string | undefined;
      let personaId: string | undefined;

      try {
        // Check if this is a webhook message using dual detection:
        // 1. Redis cache: Stores bot's own webhooks with 7-day TTL (fast lookup for recent messages)
        // 2. Discord webhookId: Catches PluralKit, expired cache, cross-channel refs, or other bot instances
        // Skip persona creation for ALL webhooks (AI personalities, PluralKit, etc.)
        // We'll handle PluralKit personas properly when we implement that feature
        let webhookPersonality = null;
        try {
          webhookPersonality = await getWebhookPersonality(reference.discordMessageId);
        } catch (error) {
          logger.warn(
            { err: error, discordMessageId: reference.discordMessageId },
            '[MessageHandler] Redis lookup failed for webhook detection, falling back to webhookId'
          );
        }
        const isWebhook = webhookPersonality || reference.webhookId;

        if (isWebhook) {
          logger.debug(
            {
              referenceNumber: reference.referenceNumber,
              webhookId: reference.webhookId,
              cachedPersonality: webhookPersonality,
              authorDisplayName: reference.authorDisplayName,
            },
            '[MessageHandler] Skipping persona enrichment - message is from webhook'
          );
          continue; // Skip this reference, keep original display name
        }

        // Get or create the user record (creates default persona if needed)
        // Use the actual Discord display name from the reference (includes server nickname/global display name)
        userId = await this.userService.getOrCreateUser(
          reference.discordUserId,
          reference.authorUsername,
          reference.authorDisplayName // Preserve actual Discord display name in user record
        );

        // Get the persona for this user when interacting with this personality
        personaId = await this.userService.getPersonaForUser(userId, personalityId);

        // Check if this persona appears in conversation history
        let personaName = personaNameMap.get(personaId);

        if (!personaName) {
          // Not in history, fetch from database
          // Note: Convert null to undefined for TypeScript type compatibility
          // (Map returns string | undefined, getPersonaName returns string | null)
          personaName = (await this.userService.getPersonaName(personaId)) ?? undefined;
        }

        // Update the authorDisplayName with the persona name
        if (personaName) {
          reference.authorDisplayName = personaName;
          logger.debug(
            `[MessageHandler] Enriched reference ${reference.referenceNumber}: ${reference.authorUsername} -> ${personaName}`
          );
        } else {
          logger.warn(
            `[MessageHandler] Could not find persona name for reference ${reference.referenceNumber} (persona: ${personaId})`
          );
        }
      } catch (error) {
        logger.error(
          {
            err: error,
            referenceNumber: reference.referenceNumber,
            discordUserId: reference.discordUserId,
            authorUsername: reference.authorUsername,
            personalityId,
            userId: userId || 'unknown',
            personaId: personaId || 'unknown',
          },
          '[MessageHandler] Failed to enrich reference with persona name'
        );
        // Keep the original Discord display name on error
      }
    }
  }
}
