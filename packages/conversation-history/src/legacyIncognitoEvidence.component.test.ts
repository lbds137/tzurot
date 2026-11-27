/**
 * Component Test: legacyIncognitoEvidence (`triggerMemoryExists`)
 *
 * Verifies the `REPLY_PAIRING_WINDOW_MS` immediately-preceding trigger lookup,
 * personality scoping, and memory visibility filter against real PostgreSQL
 * (PGlite).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { MessageRole, REPLY_PAIRING_WINDOW_MS } from '@tzurot/common-types/constants/message';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { ConversationHistoryService } from './ConversationHistoryService.js';
import { triggerMemoryExists } from './legacyIncognitoEvidence.js';

describe('triggerMemoryExists (component)', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let service: ConversationHistoryService;

  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonaId = '00000000-0000-0000-0000-000000000002';
  const testPersonalityId = '00000000-0000-0000-0000-000000000003';
  const otherPersonalityId = '00000000-0000-0000-0000-000000000005';
  const testChannelId = '123456789012345678';
  const testGuildId = '987654321098765432';

  const replyTime = new Date('2026-05-10T12:00:00.005Z');
  const withinWindow1500ms = new Date(replyTime.getTime() - 1500);
  const withinWindow1s = new Date(replyTime.getTime() - 1000);
  const outsideWindow61s = new Date(replyTime.getTime() - (REPLY_PAIRING_WINDOW_MS + 1000));
  const earlierUser2s = new Date(replyTime.getTime() - 2000);
  const interveningAssistant500ms = new Date(replyTime.getTime() - 500);

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: testUserId,
      personaId: testPersonaId,
      discordId: '111111111111111111',
      username: 'testuser',
      personaName: 'Test Persona',
      personaPreferredName: 'Tester',
      personaContent: 'A test persona',
    });

    const systemPromptId = '00000000-0000-0000-0000-000000000004';
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES ('${systemPromptId}', 'Test Prompt', 'You are a test bot.', NOW())
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES ('${testPersonalityId}', 'TestBot', 'testbot', '${systemPromptId}', 'Test bot', 'Helpful', '${testUserId}', NOW())
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES ('${otherPersonalityId}', 'OtherBot', 'otherbot', '${systemPromptId}', 'Other bot', 'Helpful', '${testUserId}', NOW())
    `);

    service = new ConversationHistoryService(prisma);
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM conversation_history');
    await prisma.$executeRawUnsafe('DELETE FROM memories');
  });

  async function seedMemory(
    id: string,
    messageIds: string[],
    opts: { personalityId?: string; visibility?: string } = {}
  ): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO memories
        (id, personality_id, persona_id, content, message_ids, senders, visibility, updated_at)
      VALUES
        (${id}::uuid, ${opts.personalityId ?? testPersonalityId}::uuid, ${testPersonaId}::uuid,
         'memory content', ${messageIds}::text[], '{}'::text[],
         ${opts.visibility ?? 'normal'}, NOW())
    `;
  }

  it('(a) returns true when a user row exists at reply - 1500ms with a normal-visibility memory carrying its Discord id', async () => {
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.User,
      content: 'Trigger user turn',
      guildId: testGuildId,
      discordMessageId: '111111111111111111',
      timestamp: withinWindow1500ms,
    });
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.Assistant,
      content: 'Assistant reply',
      guildId: testGuildId,
      discordMessageId: '222222222222222222',
      timestamp: replyTime,
    });
    await seedMemory('10000000-0000-0000-0000-000000000001', ['111111111111111111'], {
      visibility: 'normal',
    });

    const result = await triggerMemoryExists(prisma, {
      channelId: testChannelId,
      personalityId: testPersonalityId,
      createdAt: replyTime,
    });

    expect(result).toBe(true);
  });

  it('(b) returns false when the only user row is at reply - 61s with a live memory (outside the pairing window)', async () => {
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.User,
      content: 'Earlier unrelated user turn outside 60s window',
      guildId: testGuildId,
      discordMessageId: '111111111111111112',
      timestamp: outsideWindow61s,
    });
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.Assistant,
      content: 'Weigh-in reply without a trigger row within 60s',
      guildId: testGuildId,
      discordMessageId: '222222222222222223',
      timestamp: replyTime,
    });
    await seedMemory('10000000-0000-0000-0000-000000000002', ['111111111111111112'], {
      visibility: 'normal',
    });

    const result = await triggerMemoryExists(prisma, {
      channelId: testChannelId,
      personalityId: testPersonalityId,
      createdAt: replyTime,
    });

    expect(result).toBe(false);
  });

  it('(c) returns false when a user row exists at reply - 1s under a different personalityId with a live memory', async () => {
    await service.addMessage({
      channelId: testChannelId,
      personalityId: otherPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.User,
      content: 'Trigger for another personality within the window',
      guildId: testGuildId,
      discordMessageId: '111111111111111113',
      timestamp: withinWindow1s,
    });
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.Assistant,
      content: 'Reply for testPersonalityId',
      guildId: testGuildId,
      discordMessageId: '222222222222222224',
      timestamp: replyTime,
    });
    // Seed live memories on both personalities so dropping personalityId from
    // the conversation_history trigger where clause alone fails this case.
    await seedMemory('10000000-0000-0000-0000-000000000003', ['111111111111111113'], {
      personalityId: otherPersonalityId,
      visibility: 'normal',
    });
    await seedMemory('10000000-0000-0000-0000-000000000004', ['111111111111111113'], {
      personalityId: testPersonalityId,
      visibility: 'normal',
    });

    const result = await triggerMemoryExists(prisma, {
      channelId: testChannelId,
      personalityId: testPersonalityId,
      createdAt: replyTime,
    });

    expect(result).toBe(false);
  });

  it('(d) returns false when a user row exists at reply - 1s whose only memory has non-normal visibility', async () => {
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.User,
      content: 'Trigger whose memory was deleted',
      guildId: testGuildId,
      discordMessageId: '111111111111111114',
      timestamp: withinWindow1s,
    });
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.Assistant,
      content: 'Reply after deleted memory',
      guildId: testGuildId,
      discordMessageId: '222222222222222225',
      timestamp: replyTime,
    });
    await seedMemory('10000000-0000-0000-0000-000000000005', ['111111111111111114'], {
      visibility: 'deleted',
    });

    const result = await triggerMemoryExists(prisma, {
      channelId: testChannelId,
      personalityId: testPersonalityId,
      createdAt: replyTime,
    });

    expect(result).toBe(false);
  });

  it('(e) returns false when a user row with a live memory at reply - 2s is followed by an assistant row at reply - 500ms', async () => {
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.User,
      content: 'User row at reply - 2s',
      guildId: testGuildId,
      discordMessageId: '111111111111111115',
      timestamp: earlierUser2s,
    });
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.Assistant,
      content: 'Intervening assistant row at reply - 500ms',
      guildId: testGuildId,
      discordMessageId: '222222222222222226',
      timestamp: interveningAssistant500ms,
    });
    await service.addMessage({
      channelId: testChannelId,
      personalityId: testPersonalityId,
      personaId: testPersonaId,
      role: MessageRole.Assistant,
      content: 'Target reply row',
      guildId: testGuildId,
      discordMessageId: '222222222222222227',
      timestamp: replyTime,
    });
    await seedMemory('10000000-0000-0000-0000-000000000006', ['111111111111111115'], {
      visibility: 'normal',
    });

    const result = await triggerMemoryExists(prisma, {
      channelId: testChannelId,
      personalityId: testPersonalityId,
      createdAt: replyTime,
    });

    expect(result).toBe(false);
  });
});
