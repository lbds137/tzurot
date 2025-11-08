/**
 * Message Handler
 *
 * Clean, simple message routing for Discord messages.
 * Routes to either command processing or AI personality responses.
 */

import type { Message } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import { GatewayClient } from '../utils/GatewayClient.js';
import { WebhookManager } from '../utils/WebhookManager.js';
import {
  ConversationHistoryService,
  PersonalityService,
  UserService,
  preserveCodeBlocks,
  createLogger,
  getConfig,
  AI_DEFAULTS,
  AI_ENDPOINTS,
  INTERVALS,
  MessageRole,
  CONTENT_TYPES,
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
import { MessageReferenceExtractor } from './MessageReferenceExtractor.js';
import { extractAttachments } from '../utils/attachmentExtractor.js';
import { formatReferencesForDatabase } from '../utils/referenceFormatter.js';
import { generateAttachmentPlaceholders } from '../utils/attachmentPlaceholders.js';

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
        a => a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) || a.duration !== null
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
      const historyLimit = personality.contextWindow || AI_DEFAULTS.CONTEXT_WINDOW;
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
      if (message.attachments.some(a => a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) || a.duration !== null)) {
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

      // ARCHITECTURAL DECISION: Atomic user message storage with placeholders
      //
      // Save user message BEFORE AI processing with placeholder descriptions for attachments/references.
      // This ensures:
      // 1. Proper chronological ordering (user timestamp < assistant timestamp)
      // 2. Atomic storage (message exists complete, not missing data for 5-60s)
      // 3. Database shows placeholder descriptions immediately, not empty data
      //
      // After AI processing completes, we'll update with rich descriptions from vision/transcription.

      // Build content with placeholder attachment descriptions
      let userMessageContent = messageContentForAI || '[no text content]';

      // Add placeholder attachment descriptions (e.g., "[Image: photo.jpg] [Voice message: 5.2s]")
      if (attachments && attachments.length > 0) {
        const attachmentPlaceholders = generateAttachmentPlaceholders(attachments);
        userMessageContent += attachmentPlaceholders;
      }

      // Add placeholder reference descriptions (basic formatting without vision/transcription)
      if (referencedMessages.length > 0) {
        const referencePlaceholders = formatReferencesForDatabase(referencedMessages);
        userMessageContent += referencePlaceholders;
      }

      // Save user message atomically with all placeholder descriptions
      await this.conversationHistory.addMessage(
        message.channel.id,
        personality.id,
        personaId,
        MessageRole.User,
        userMessageContent,
        message.guild?.id || null,
        message.id // Discord message ID for deduplication
      );

      logger.debug(
        {
          hasAttachments: attachments && attachments.length > 0,
          attachmentCount: attachments?.length || 0,
          hasReferences: referencedMessages.length > 0,
          referenceCount: referencedMessages.length,
          contentLength: userMessageContent.length,
        },
        '[MessageHandler] Saved user message with placeholder descriptions'
      );

      // Capture timestamp for chronological ordering
      // User message was just saved, so its timestamp is ~now
      // We'll use this + 1ms for assistant message to ensure correct ordering
      const userMessageTime = new Date();

      // Call API Gateway for AI generation (this will process attachments/references and return descriptions)
      const response = await this.gatewayClient.generate(personality, context);

      // Upgrade user message from placeholders to rich descriptions (if AI processing succeeded)
      // The AI worker processes attachments/references with vision/transcription APIs
      // If processing failed, placeholders remain (acceptable degradation)
      if (response.attachmentDescriptions || response.referencedMessagesDescriptions) {
        let enrichedContent = messageContentForAI || content; // Start with text content

        // Upgrade attachment placeholders to rich descriptions
        if (response.attachmentDescriptions) {
          enrichedContent = enrichedContent
            ? `${enrichedContent}\n\n${response.attachmentDescriptions}`
            : response.attachmentDescriptions;

          logger.debug(
            {
              descriptionLength: response.attachmentDescriptions.length,
            },
            '[MessageHandler] Upgrading attachment placeholders to rich descriptions'
          );
        }

        // Upgrade reference placeholders to rich descriptions
        if (response.referencedMessagesDescriptions) {
          enrichedContent += `\n\n${response.referencedMessagesDescriptions}`;

          logger.debug(
            {
              descriptionLength: response.referencedMessagesDescriptions.length,
            },
            '[MessageHandler] Upgrading reference placeholders to rich descriptions'
          );
        }

        // Update the message we saved earlier with rich descriptions
        await this.conversationHistory.updateLastUserMessage(
          message.channel.id,
          personality.id,
          personaId,
          enrichedContent
        );
      } else {
        // AI processing failed or no attachments/references - placeholders remain
        logger.debug(
          '[MessageHandler] No rich descriptions available, keeping placeholder descriptions'
        );
      }

      // Add model indicator to the message (for Discord display only, not in history)
      let contentWithIndicator = response.content;
      if (response.metadata?.modelUsed) {
        const modelName = response.metadata.modelUsed;
        const modelUrl = `${AI_ENDPOINTS.OPENROUTER_MODEL_CARD_URL}/${modelName}`;
        contentWithIndicator += `\n-# ||Model: [\`${modelName}\`](<${modelUrl}>)||`;
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

      // Now that Discord send succeeded, create the assistant message in conversation_history
      // This ensures:
      // - No orphaned assistant messages if Discord send fails
      // - Assistant message has Discord chunk IDs from the start (no backfilling needed)
      // - Proper chronological ordering (user message timestamp < assistant message timestamp)
      if (chunkMessageIds.length > 0) {
        const assistantMessageTime = new Date(userMessageTime.getTime() + 1); // 1ms after user message

        logger.debug(
          {
            channelId: message.channel.id,
            isThread: message.channel.isThread(),
            personalityId: personality.id,
            personaId: personaId.substring(0, 8),
            chunkCount: chunkMessageIds.length,
            discordMessageIds: chunkMessageIds,
            userMessageTime: userMessageTime.toISOString(),
            assistantMessageTime: assistantMessageTime.toISOString(),
          },
          '[MessageHandler] Creating assistant message in conversation_history with Discord chunk IDs'
        );

        await this.conversationHistory.addMessage(
          message.channel.id,
          personality.id,
          personaId,
          MessageRole.Assistant,
          response.content, // Clean content without model indicator
          message.guild?.id || null,
          chunkMessageIds, // Array of Discord message IDs
          assistantMessageTime // Explicit timestamp for chronological ordering
        );
      }

      // Note: LTM storage happens in ai-worker during generation (before Discord send)
      // When we migrate to OpenMemory, we'll move LTM storage here (after Discord send)

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
        contentType: attachment.contentType || CONTENT_TYPES.BINARY,
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
