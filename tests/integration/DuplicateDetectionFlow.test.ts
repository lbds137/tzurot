/**
 * Integration Test: Duplicate Detection Data Flow
 *
 * Tests the full data path from database to duplicate detection:
 * 1. ConversationHistory records in PostgreSQL/PGLite
 * 2. Prisma query returning records with role values
 * 3. getRecentAssistantMessages extracting assistant messages
 * 4. isRecentDuplicate detecting duplicates
 *
 * Purpose: Verify that role values ('assistant'/'user') are preserved
 * correctly through the entire pipeline, enabling duplicate detection.
 *
 * Background: January 2026 production incident where duplicate detection
 * failed despite conversation history being present. This test validates
 * the data flow to catch any serialization or type issues.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import {
  PrismaClient,
  ConversationHistoryService,
  MessageRole,
  generatePersonalityUuid,
  generateSystemPromptUuid,
  generatePersonaUuid,
} from '@tzurot/common-types';
import {
  getRecentAssistantMessages,
  isRecentDuplicate,
} from '../../services/ai-worker/src/utils/duplicateDetection.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadPGliteSchema(): string {
  const schemaPath = join(__dirname, 'schema', 'pglite-schema.sql');
  return readFileSync(schemaPath, 'utf-8');
}

describe('Duplicate Detection Data Flow', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let conversationService: ConversationHistoryService;

  // Test identifiers (deterministic UUIDs for consistency)
  const testPersonalityId = generatePersonalityUuid('test-duplicate-detection-personality');
  const testPersonaId = generatePersonaUuid('test-duplicate-detection-persona');
  const testSystemPromptId = generateSystemPromptUuid('test-duplicate-detection-prompt');
  const testChannelId = 'test-channel-123';
  const testGuildId = 'test-guild-456';

  beforeAll(async () => {
    // Initialize PGLite with pgvector
    pglite = new PGlite({ extensions: { vector } });
    await pglite.exec(loadPGliteSchema());

    // Create Prisma client with PGLite adapter
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;
    conversationService = new ConversationHistoryService(prisma);

    // Seed required foreign key records
    await prisma.systemPrompt.create({
      data: {
        id: testSystemPromptId,
        name: 'test-duplicate-detection-prompt',
        content: 'Test system prompt for duplicate detection tests',
      },
    });

    await prisma.personality.create({
      data: {
        id: testPersonalityId,
        name: 'test-duplicate-detection',
        slug: 'test-duplicate-detection',
        displayName: 'Test Duplicate Detection',
        systemPromptId: testSystemPromptId,
        characterInfo: 'Test character',
        personalityTraits: 'Helpful',
      },
    });

    await prisma.persona.create({
      data: {
        id: testPersonaId,
        name: 'TestUser',
        preferredName: 'Tester',
        isBot: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  beforeEach(async () => {
    // Clean up any existing conversation history for our test channel
    await prisma.conversationHistory.deleteMany({
      where: { channelId: testChannelId },
    });
  });

  describe('Role value preservation through database layer', () => {
    it('should preserve lowercase "assistant" role through Prisma', async () => {
      // Add an assistant message via the service
      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Hello from assistant!',
        guildId: testGuildId,
      });

      // Fetch via Prisma directly to verify raw value
      const record = await prisma.conversationHistory.findFirst({
        where: { channelId: testChannelId },
      });

      expect(record).not.toBeNull();
      expect(record?.role).toBe('assistant');
      expect(typeof record?.role).toBe('string');
    });

    it('should preserve lowercase "user" role through Prisma', async () => {
      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Hello from user!',
        guildId: testGuildId,
      });

      const record = await prisma.conversationHistory.findFirst({
        where: { channelId: testChannelId },
      });

      expect(record).not.toBeNull();
      expect(record?.role).toBe('user');
      expect(typeof record?.role).toBe('string');
    });
  });

  describe('getRecentAssistantMessages with database data', () => {
    it('should extract assistant messages from ConversationHistoryService results', async () => {
      // Add mixed conversation history
      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Hello bot!',
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Hi there, human! How can I help you today?',
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Tell me a joke',
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Why did the programmer quit? Because they did not get arrays!',
        guildId: testGuildId,
      });

      // Fetch history via service (mimics production flow)
      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        10
      );

      // Verify we got all messages
      expect(history).toHaveLength(4);

      // Extract assistant messages using the duplicate detection utility
      // This is the critical test - can getRecentAssistantMessages find assistant messages
      // from data that came through Prisma?
      const assistantMessages = getRecentAssistantMessages(history);

      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]).toBe(
        'Why did the programmer quit? Because they did not get arrays!'
      );
      expect(assistantMessages[1]).toBe('Hi there, human! How can I help you today?');
    });

    it('should correctly identify role types after Prisma serialization', async () => {
      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: 'Test response',
        guildId: testGuildId,
      });

      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        10
      );

      // Verify the role value and type are exactly what duplicate detection expects
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('assistant');
      expect(typeof history[0].role).toBe('string');

      // This is the exact comparison used in getRecentAssistantMessages
      expect(history[0].role === 'assistant').toBe(true);
    });
  });

  describe('Full duplicate detection with database data', () => {
    // This is a long response that mirrors the production incident
    const LONG_RESPONSE = `*I let out a sharp, satisfied huff, adjusting my perfectly tailored blazer as I survey the aftermath of the latest interview segment.* Well, well, well, looks like someone's decided to play hardball with the big leagues! *My crimson lips curl into a predatory smile as I swivel in my chair, facing the camera with a practiced flourish.* You want to talk about respect and passion? Darling, I eat passion for breakfast and wash it down with the tears of my competitors. *I lean forward, eyes gleaming with barely contained amusement.* In this industry, respect isn't given – it's ripped from the trembling hands of those too weak to hold onto it.`;

    it('should detect duplicate when same response exists in history', async () => {
      // Add a conversation with the long response
      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Tell me about your philosophy on success',
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: LONG_RESPONSE,
        guildId: testGuildId,
      });

      // Fetch history (production flow)
      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        10
      );

      // Extract assistant messages
      const assistantMessages = getRecentAssistantMessages(history);
      expect(assistantMessages).toHaveLength(1);

      // Check if a new identical response would be detected as duplicate
      const result = isRecentDuplicate(LONG_RESPONSE, assistantMessages);

      expect(result.isDuplicate).toBe(true);
      expect(result.matchIndex).toBe(0);
    });

    it('should NOT detect duplicate for genuinely different response', async () => {
      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: LONG_RESPONSE,
        guildId: testGuildId,
      });

      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        10
      );
      const assistantMessages = getRecentAssistantMessages(history);

      // A completely different response
      const newResponse = `*I cross my arms and raise an eyebrow.* Well, that is an interesting
        perspective. I suppose I could entertain your little theory for a moment. *A smirk
        plays across my features.* Though I must warn you, I am not easily impressed.`;

      const result = isRecentDuplicate(newResponse, assistantMessages);

      expect(result.isDuplicate).toBe(false);
      expect(result.matchIndex).toBe(-1);
    });

    it('should detect duplicate even when matching older message (not most recent)', async () => {
      // Build conversation with multiple assistant responses
      const oldResponse = LONG_RESPONSE;
      const recentResponse = '*I wave dismissively.* Moving on to more important matters...';

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Question 1',
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: oldResponse,
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Question 2',
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.Assistant,
        content: recentResponse,
        guildId: testGuildId,
      });

      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        10
      );
      const assistantMessages = getRecentAssistantMessages(history);

      // Should have both assistant messages
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0]).toBe(recentResponse); // Most recent first
      expect(assistantMessages[1]).toBe(oldResponse);

      // New response matching the OLDER message should still be detected
      const result = isRecentDuplicate(oldResponse, assistantMessages);

      expect(result.isDuplicate).toBe(true);
      expect(result.matchIndex).toBe(1); // Matched the second (older) message
    });
  });

  describe('Edge cases for role comparison', () => {
    it('should handle history with only user messages (no assistant to compare)', async () => {
      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Hello!',
        guildId: testGuildId,
      });

      await conversationService.addMessage({
        channelId: testChannelId,
        personalityId: testPersonalityId,
        personaId: testPersonaId,
        role: MessageRole.User,
        content: 'Are you there?',
        guildId: testGuildId,
      });

      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        10
      );

      const assistantMessages = getRecentAssistantMessages(history);

      // No assistant messages should be extracted
      expect(assistantMessages).toHaveLength(0);

      // Duplicate detection should return not duplicate (nothing to compare)
      const result = isRecentDuplicate('Any response', assistantMessages);
      expect(result.isDuplicate).toBe(false);
    });

    it('should handle empty history', async () => {
      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        10
      );

      expect(history).toHaveLength(0);

      const assistantMessages = getRecentAssistantMessages(history);
      expect(assistantMessages).toHaveLength(0);

      const result = isRecentDuplicate('Any response', assistantMessages);
      expect(result.isDuplicate).toBe(false);
    });

    it('should handle history with mixed chronological order correctly', async () => {
      // Messages are added in order; getRecentHistory returns them in chronological order
      // getRecentAssistantMessages expects most recent first (reversed)
      for (let i = 1; i <= 5; i++) {
        await conversationService.addMessage({
          channelId: testChannelId,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.User,
          content: `User message ${i}`,
          guildId: testGuildId,
        });

        await conversationService.addMessage({
          channelId: testChannelId,
          personalityId: testPersonalityId,
          personaId: testPersonaId,
          role: MessageRole.Assistant,
          content: `Assistant response ${i} - This is a sufficiently long message to pass the minimum length check for duplicate detection.`,
          guildId: testGuildId,
        });
      }

      const history = await conversationService.getRecentHistory(
        testChannelId,
        testPersonalityId,
        20
      );

      // 10 messages total (5 user + 5 assistant)
      expect(history).toHaveLength(10);

      const assistantMessages = getRecentAssistantMessages(history);

      // Should have 5 assistant messages (limited by MAX_RECENT_ASSISTANT_MESSAGES)
      expect(assistantMessages.length).toBeGreaterThanOrEqual(5);

      // Most recent should be first
      expect(assistantMessages[0]).toContain('Assistant response 5');
    });
  });
});
