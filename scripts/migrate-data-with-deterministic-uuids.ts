#!/usr/bin/env tsx
/**
 * Migrate data from old DB to new pgvector DB with deterministic UUIDs
 */

import { PrismaClient } from '@prisma/client';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';

const OLD_DATABASE_URL = "postgresql://postgres:WuKBVblJOTDcuPULuPAeuDXstDMaFxid@nozomi.proxy.rlwy.net:48102/railway";
const NEW_DATABASE_URL = process.env.DATABASE_URL;

const oldDb = new PrismaClient({ datasources: { db: { url: OLD_DATABASE_URL } } });
const newDb = new PrismaClient({ datasources: { db: { url: NEW_DATABASE_URL } } });

// Namespace UUIDs for each entity type
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Standard DNS namespace
const NAMESPACES = {
  user: uuidv5('tzurot-v3-user', DNS_NAMESPACE),
  persona: uuidv5('tzurot-v3-persona', DNS_NAMESPACE),
  systemPrompt: uuidv5('tzurot-v3-system-prompt', DNS_NAMESPACE),
  llmConfig: uuidv5('tzurot-v3-llm-config', DNS_NAMESPACE),
  personality: uuidv5('tzurot-v3-personality', DNS_NAMESPACE),
  conversation: uuidv5('tzurot-v3-conversation', DNS_NAMESPACE),
  memory: uuidv5('tzurot-v3-memory', DNS_NAMESPACE),
};

// Helper to hash content
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

// Helper to generate deterministic UUID
function deterministicUuid(namespace: string, key: string): string {
  return uuidv5(key, namespace);
}

// Track old ID -> new ID mappings
const idMappings = {
  users: new Map<string, string>(),
  personas: new Map<string, string>(),
  systemPrompts: new Map<string, string>(),
  llmConfigs: new Map<string, string>(),
  personalities: new Map<string, string>(),
  conversations: new Map<string, string>(),
};

async function main() {
  console.log('🚀 Migrating data with deterministic UUIDs...\n');

  try {
    // 1. Users
    console.log('📋 Migrating users...');
    const users = await oldDb.user.findMany();
    for (const user of users) {
      const newId = deterministicUuid(NAMESPACES.user, user.discordId);
      idMappings.users.set(user.id, newId);

      await newDb.user.create({
        data: {
          ...user,
          id: newId,
        },
      });
    }
    console.log(`✅ Migrated ${users.length} users\n`);

    // 2. Personas
    console.log('📋 Migrating personas...');
    const personas = await oldDb.persona.findMany();
    for (const persona of personas) {
      const key = `${idMappings.users.get(persona.ownerId)}:${persona.name}:${hashContent(persona.content)}`;
      const newId = deterministicUuid(NAMESPACES.persona, key);
      idMappings.personas.set(persona.id, newId);

      await newDb.persona.create({
        data: {
          ...persona,
          id: newId,
          ownerId: idMappings.users.get(persona.ownerId)!,
        },
      });
    }
    console.log(`✅ Migrated ${personas.length} personas\n`);

    // 3. User Default Personas
    console.log('📋 Migrating user default personas...');
    const userDefaultPersonas = await oldDb.userDefaultPersona.findMany();
    for (const udp of userDefaultPersonas) {
      await newDb.userDefaultPersona.create({
        data: {
          userId: idMappings.users.get(udp.userId)!,
          personaId: idMappings.personas.get(udp.personaId)!,
          updatedAt: udp.updatedAt,
        },
      });
    }
    console.log(`✅ Migrated ${userDefaultPersonas.length} user default personas\n`);

    // 4. System Prompts
    console.log('📋 Migrating system prompts...');
    const systemPrompts = await oldDb.systemPrompt.findMany();
    for (const sp of systemPrompts) {
      const key = `${sp.name}:${hashContent(sp.content)}`;
      const newId = deterministicUuid(NAMESPACES.systemPrompt, key);
      idMappings.systemPrompts.set(sp.id, newId);

      await newDb.systemPrompt.create({
        data: {
          ...sp,
          id: newId,
        },
      });
    }
    console.log(`✅ Migrated ${systemPrompts.length} system prompts\n`);

    // 5. LLM Configs
    console.log('📋 Migrating LLM configs...');
    const llmConfigs = await oldDb.llmConfig.findMany();
    for (const config of llmConfigs) {
      const ownerPart = config.ownerId ? idMappings.users.get(config.ownerId) : 'global';
      const key = `${config.name}:${config.model}:${ownerPart}`;
      const newId = deterministicUuid(NAMESPACES.llmConfig, key);
      idMappings.llmConfigs.set(config.id, newId);

      await newDb.llmConfig.create({
        data: {
          ...config,
          id: newId,
          ownerId: config.ownerId ? idMappings.users.get(config.ownerId)! : null,
        },
      });
    }
    console.log(`✅ Migrated ${llmConfigs.length} LLM configs\n`);

    // 6. Personalities
    console.log('📋 Migrating personalities...');
    const personalities = await oldDb.personality.findMany();
    for (const personality of personalities) {
      const newId = deterministicUuid(NAMESPACES.personality, personality.slug);
      idMappings.personalities.set(personality.id, newId);

      await newDb.personality.create({
        data: {
          ...personality,
          id: newId,
          systemPromptId: personality.systemPromptId ? idMappings.systemPrompts.get(personality.systemPromptId)! : null,
        },
      });
    }
    console.log(`✅ Migrated ${personalities.length} personalities\n`);

    // 7. Personality Default Configs
    console.log('📋 Migrating personality default configs...');
    const personalityDefaultConfigs = await oldDb.personalityDefaultConfig.findMany();
    for (const pdc of personalityDefaultConfigs) {
      await newDb.personalityDefaultConfig.create({
        data: {
          personalityId: idMappings.personalities.get(pdc.personalityId)!,
          llmConfigId: idMappings.llmConfigs.get(pdc.llmConfigId)!,
          updatedAt: pdc.updatedAt,
        },
      });
    }
    console.log(`✅ Migrated ${personalityDefaultConfigs.length} personality default configs\n`);

    // 8. Personality Owners
    console.log('📋 Migrating personality owners...');
    const personalityOwners = await oldDb.personalityOwner.findMany();
    for (const po of personalityOwners) {
      await newDb.personalityOwner.create({
        data: {
          personalityId: idMappings.personalities.get(po.personalityId)!,
          userId: idMappings.users.get(po.userId)!,
          role: po.role,
          createdAt: po.createdAt,
          updatedAt: po.updatedAt,
        },
      });
    }
    console.log(`✅ Migrated ${personalityOwners.length} personality owners\n`);

    // 9. User Personality Configs
    console.log('📋 Migrating user personality configs...');
    const userPersonalityConfigs = await oldDb.userPersonalityConfig.findMany();
    for (const upc of userPersonalityConfigs) {
      const key = `${idMappings.users.get(upc.userId)}:${idMappings.personalities.get(upc.personalityId)}`;
      const newId = deterministicUuid(NAMESPACES.persona, key);

      await newDb.userPersonalityConfig.create({
        data: {
          id: newId,
          userId: idMappings.users.get(upc.userId)!,
          personalityId: idMappings.personalities.get(upc.personalityId)!,
          personaId: upc.personaId ? idMappings.personas.get(upc.personaId)! : null,
          llmConfigId: upc.llmConfigId ? idMappings.llmConfigs.get(upc.llmConfigId)! : null,
          createdAt: upc.createdAt,
          updatedAt: upc.updatedAt,
        },
      });
    }
    console.log(`✅ Migrated ${userPersonalityConfigs.length} user personality configs\n`);

    // 10. Activated Channels
    console.log('📋 Migrating activated channels...');
    const activatedChannels = await oldDb.activatedChannel.findMany();
    for (const ac of activatedChannels) {
      const key = `${ac.channelId}:${idMappings.personalities.get(ac.personalityId)}`;
      const newId = deterministicUuid(NAMESPACES.conversation, key);

      await newDb.activatedChannel.create({
        data: {
          id: newId,
          channelId: ac.channelId,
          personalityId: idMappings.personalities.get(ac.personalityId)!,
          autoRespond: ac.autoRespond,
          createdBy: ac.createdBy ? idMappings.users.get(ac.createdBy)! : null,
          createdAt: ac.createdAt,
          updatedAt: ac.updatedAt,
        },
      });
    }
    console.log(`✅ Migrated ${activatedChannels.length} activated channels\n`);

    // 11. Conversation History (with deterministic IDs)
    console.log('📋 Migrating conversation history...');
    const conversationHistory = await oldDb.conversationHistory.findMany({ orderBy: { createdAt: 'asc' } });
    console.log(`Found ${conversationHistory.length} messages, migrating in batches...`);

    const BATCH_SIZE = 1000;
    for (let i = 0; i < conversationHistory.length; i += BATCH_SIZE) {
      const batch = conversationHistory.slice(i, i + BATCH_SIZE);

      for (const msg of batch) {
        const contentHash = hashContent(msg.content);
        const key = `${msg.channelId}:${idMappings.personas.get(msg.personaId)}:${idMappings.personalities.get(msg.personalityId)}:${msg.createdAt.toISOString()}:${msg.role}:${contentHash}`;
        const newId = deterministicUuid(NAMESPACES.conversation, key);
        idMappings.conversations.set(msg.id, newId);

        await newDb.conversationHistory.create({
          data: {
            id: newId,
            channelId: msg.channelId,
            personalityId: idMappings.personalities.get(msg.personalityId)!,
            personaId: idMappings.personas.get(msg.personaId)!,
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt,
          },
        });
      }

      console.log(`  Migrated ${Math.min(i + BATCH_SIZE, conversationHistory.length)}/${conversationHistory.length} messages...`);
    }
    console.log(`✅ Migrated ${conversationHistory.length} conversation history messages\n`);

    // 12. Pending Memories
    console.log('📋 Migrating pending memories...');
    const pendingMemories = await oldDb.pendingMemory.findMany();
    for (const pm of pendingMemories) {
      const key = idMappings.conversations.get(pm.conversationHistoryId)!;
      const newId = deterministicUuid(NAMESPACES.memory, `pending:${key}`);

      await newDb.pendingMemory.create({
        data: {
          id: newId,
          conversationHistoryId: idMappings.conversations.get(pm.conversationHistoryId)!,
          personaId: idMappings.personas.get(pm.personaId)!,
          personalityId: idMappings.personalities.get(pm.personalityId)!,
          personalityName: pm.personalityName,
          text: pm.text,
          metadata: pm.metadata,
          createdAt: pm.createdAt,
          attempts: pm.attempts,
          lastAttemptAt: pm.lastAttemptAt,
          error: pm.error,
        },
      });
    }
    console.log(`✅ Migrated ${pendingMemories.length} pending memories\n`);

    console.log('\n🎉 Migration complete! All data successfully migrated with deterministic UUIDs.');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

main();
