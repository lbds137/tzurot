/**
 * Reference Enrichment Service
 *
 * Enriches referenced messages with persona names instead of Discord display names.
 * Pure data transformation service with no side effects.
 */

import { UserService, createLogger } from '@tzurot/common-types';
import type { ConversationMessage, ReferencedMessage, PersonaResolver } from '@tzurot/common-types';
import { redisService } from '../redis.js';

const logger = createLogger('ReferenceEnrichmentService');

/**
 * Enriches references with persona information
 */
export class ReferenceEnrichmentService {
  constructor(
    private readonly userService: UserService,
    private readonly personaResolver: PersonaResolver
  ) {}

  /**
   * Enrich referenced messages with persona names
   *
   * For each referenced message:
   * 1. Skip webhook messages (AI personalities, PluralKit, etc.)
   * 2. Look up the user's persona for the current personality
   * 3. Check if that persona appears in conversation history
   * 4. If yes, use persona name from history; if no, fetch from database
   * 5. Update the authorDisplayName field
   *
   * **Conversation History Stability Assumption**:
   * This method receives a snapshot of conversation history at the time of the message
   * processing cycle. We assume that conversation history remains stable during a single
   * message processing cycle (typically <1 second).
   *
   * @param referencedMessages - Messages to enrich (mutated in place)
   * @param conversationHistory - Conversation history for cached persona names
   * @param personalityId - Current personality ID
   */
  async enrichWithPersonaNames(
    referencedMessages: ReferencedMessage[],
    conversationHistory: ConversationMessage[],
    personalityId: string
  ): Promise<void> {
    if (referencedMessages.length === 0) {
      return;
    }

    // Build a map of personaId -> personaName from conversation history for fast lookup
    const personaNameMap = new Map<string, string>();
    for (const msg of conversationHistory) {
      if (msg.personaName !== undefined && msg.personaName !== null && msg.personaName.length > 0) {
        personaNameMap.set(msg.personaId, msg.personaName);
      }
    }

    logger.debug(
      {
        referenceCount: referencedMessages.length,
        historySize: conversationHistory.length,
        cachedPersonaNames: personaNameMap.size,
      },
      '[ReferenceEnrichmentService] Starting persona name enrichment'
    );

    // Enrich each referenced message
    for (const reference of referencedMessages) {
      await this.enrichSingleReference(reference, personaNameMap, personalityId);
    }

    logger.info(
      {
        count: referencedMessages.length,
        referenceNumbers: referencedMessages.map(r => r.referenceNumber),
        personaNames: referencedMessages.map(r => r.authorDisplayName),
      },
      `[ReferenceEnrichmentService] Enriched ${referencedMessages.length} referenced messages with persona names`
    );
  }

  /**
   * Enrich a single reference with persona name
   */
  // eslint-disable-next-line complexity -- Webhook detection requires dual Redis+Discord checks, persona resolution has multiple fallback paths (cache→DB), and each step needs null checks due to Discord API optionality. Logic is cohesive and extraction would scatter related null-safety checks.
  private async enrichSingleReference(
    reference: ReferencedMessage,
    personaNameMap: Map<string, string>,
    personalityId: string
  ): Promise<void> {
    let userId: string | undefined;
    let personaId: string | undefined;

    try {
      // Check if this is a webhook message using dual detection:
      // 1. Redis cache: Stores bot's own webhooks with 7-day TTL (fast lookup for recent messages)
      // 2. Discord webhookId: Catches PluralKit, expired cache, cross-channel refs, or other bot instances
      // Skip persona creation for ALL webhooks (AI personalities, PluralKit, etc.)
      let webhookPersonality = null;
      try {
        webhookPersonality = await redisService.getWebhookPersonality(reference.discordMessageId);
      } catch (error) {
        logger.warn(
          { err: error, discordMessageId: reference.discordMessageId },
          '[ReferenceEnrichmentService] Redis lookup failed for webhook detection, falling back to webhookId'
        );
      }

      const isWebhook =
        (webhookPersonality !== undefined && webhookPersonality !== null) ||
        (reference.webhookId !== undefined &&
          reference.webhookId !== null &&
          reference.webhookId.length > 0);

      if (isWebhook === true) {
        logger.debug(
          {
            referenceNumber: reference.referenceNumber,
            webhookId: reference.webhookId,
            cachedPersonality: webhookPersonality,
            authorDisplayName: reference.authorDisplayName,
          },
          '[ReferenceEnrichmentService] Skipping persona enrichment - message is from webhook'
        );
        return; // Keep original display name
      }

      // Get or create the user record (creates default persona if needed)
      // Use the actual Discord display name from the reference (includes server nickname/global display name)
      const userIdResult = await this.userService.getOrCreateUser(
        reference.discordUserId,
        reference.authorUsername,
        reference.authorDisplayName // Preserve actual Discord display name in user record
      );

      // Skip bots - they don't have personas
      if (userIdResult === null) {
        logger.debug(
          { discordUserId: reference.discordUserId },
          '[ReferenceEnrichmentService] Skipping persona enrichment - user is a bot'
        );
        return;
      }
      userId = userIdResult;

      // Get the persona for this user when interacting with this personality
      // Uses PersonaResolver with proper cache invalidation via Redis pub/sub
      const personaResult = await this.personaResolver.resolve(
        reference.discordUserId,
        personalityId
      );
      personaId = personaResult.config.personaId;

      // Check if this persona appears in conversation history (fast path)
      let personaName = personaNameMap.get(personaId);

      if (personaName === undefined || personaName === null || personaName.length === 0) {
        // Not in history, fetch from database (slow path)
        // Note: Convert null to undefined for TypeScript type compatibility
        personaName = (await this.userService.getPersonaName(personaId)) ?? undefined;
      }

      // Update the authorDisplayName with the persona name
      if (personaName !== undefined && personaName !== null && personaName.length > 0) {
        reference.authorDisplayName = personaName;
        logger.debug(
          `[ReferenceEnrichmentService] Enriched reference ${reference.referenceNumber}: ${reference.authorUsername} -> ${personaName}`
        );
      } else {
        logger.warn(
          {},
          `[ReferenceEnrichmentService] Could not find persona name for reference ${reference.referenceNumber} (persona: ${personaId})`
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
          userId: userId !== undefined && userId !== null && userId.length > 0 ? userId : 'unknown',
          personaId:
            personaId !== undefined && personaId !== null && personaId.length > 0
              ? personaId
              : 'unknown',
        },
        '[ReferenceEnrichmentService] Failed to enrich reference with persona name'
      );
      // Keep the original Discord display name on error
    }
  }
}
