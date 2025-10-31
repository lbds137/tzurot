#!/usr/bin/env tsx
/**
 * Migrate data from old DB to new pgvector DB
 */

import { PrismaClient } from '@prisma/client';

const OLD_DATABASE_URL = "postgresql://postgres:WuKBVblJOTDcuPULuPAeuDXstDMaFxid@nozomi.proxy.rlwy.net:48102/railway";
const NEW_DATABASE_URL = process.env.DATABASE_URL; // From .env

const oldDb = new PrismaClient({ datasources: { db: { url: OLD_DATABASE_URL } } });
const newDb = new PrismaClient({ datasources: { db: { url: NEW_DATABASE_URL } } });

async function main() {
  console.log('🚀 Migrating data from old DB to new pgvector DB...\n');

  try {
    // 1. Users
    console.log('📋 Migrating users...');
    const users = await oldDb.user.findMany();
    for (const user of users) {
      await newDb.user.create({ data: user });
    }
    console.log(`✅ Migrated ${users.length} users\n`);

    // 2. Personas
    console.log('📋 Migrating personas...');
    const personas = await oldDb.persona.findMany();
    for (const persona of personas) {
      await newDb.persona.create({ data: persona });
    }
    console.log(`✅ Migrated ${personas.length} personas\n`);

    // 3. User Default Personas
    console.log('📋 Migrating user default personas...');
    const userDefaultPersonas = await oldDb.userDefaultPersona.findMany();
    for (const udp of userDefaultPersonas) {
      await newDb.userDefaultPersona.create({ data: udp });
    }
    console.log(`✅ Migrated ${userDefaultPersonas.length} user default personas\n`);

    // 4. System Prompts
    console.log('📋 Migrating system prompts...');
    const systemPrompts = await oldDb.systemPrompt.findMany();
    for (const sp of systemPrompts) {
      await newDb.systemPrompt.create({ data: sp });
    }
    console.log(`✅ Migrated ${systemPrompts.length} system prompts\n`);

    // 5. LLM Configs
    console.log('📋 Migrating LLM configs...');
    const llmConfigs = await oldDb.llmConfig.findMany();
    for (const config of llmConfigs) {
      await newDb.llmConfig.create({ data: config });
    }
    console.log(`✅ Migrated ${llmConfigs.length} LLM configs\n`);

    // 6. Personalities
    console.log('📋 Migrating personalities...');
    const personalities = await oldDb.personality.findMany();
    for (const personality of personalities) {
      await newDb.personality.create({ data: personality });
    }
    console.log(`✅ Migrated ${personalities.length} personalities\n`);

    // 7. Personality Default Configs
    console.log('📋 Migrating personality default configs...');
    const personalityDefaultConfigs = await oldDb.personalityDefaultConfig.findMany();
    for (const pdc of personalityDefaultConfigs) {
      await newDb.personalityDefaultConfig.create({ data: pdc });
    }
    console.log(`✅ Migrated ${personalityDefaultConfigs.length} personality default configs\n`);

    // 8. Personality Owners
    console.log('📋 Migrating personality owners...');
    const personalityOwners = await oldDb.personalityOwner.findMany();
    for (const po of personalityOwners) {
      await newDb.personalityOwner.create({ data: po });
    }
    console.log(`✅ Migrated ${personalityOwners.length} personality owners\n`);

    // 9. User Personality Configs
    console.log('📋 Migrating user personality configs...');
    const userPersonalityConfigs = await oldDb.userPersonalityConfig.findMany();
    for (const upc of userPersonalityConfigs) {
      await newDb.userPersonalityConfig.create({ data: upc });
    }
    console.log(`✅ Migrated ${userPersonalityConfigs.length} user personality configs\n`);

    // 10. Activated Channels
    console.log('📋 Migrating activated channels...');
    const activatedChannels = await oldDb.activatedChannel.findMany();
    for (const ac of activatedChannels) {
      await newDb.activatedChannel.create({ data: ac });
    }
    console.log(`✅ Migrated ${activatedChannels.length} activated channels\n`);

    // 11. Conversation History
    console.log('📋 Migrating conversation history...');
    const conversationHistory = await oldDb.conversationHistory.findMany();
    console.log(`Found ${conversationHistory.length} messages, migrating in batches...`);

    const BATCH_SIZE = 1000;
    for (let i = 0; i < conversationHistory.length; i += BATCH_SIZE) {
      const batch = conversationHistory.slice(i, i + BATCH_SIZE);
      await newDb.conversationHistory.createMany({ data: batch });
      console.log(`  Migrated ${Math.min(i + BATCH_SIZE, conversationHistory.length)}/${conversationHistory.length} messages...`);
    }
    console.log(`✅ Migrated ${conversationHistory.length} conversation history messages\n`);

    // 12. Pending Memories
    console.log('📋 Migrating pending memories...');
    const pendingMemories = await oldDb.pendingMemory.findMany();
    for (const pm of pendingMemories) {
      await newDb.pendingMemory.create({ data: pm });
    }
    console.log(`✅ Migrated ${pendingMemories.length} pending memories\n`);

    console.log('\n🎉 Migration complete! All data successfully copied to new pgvector database.');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

main();
