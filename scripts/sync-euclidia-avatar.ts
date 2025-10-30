/**
 * Sync Euclidia's Avatar from Prod to Dev
 *
 * Gets Euclidia's base64 avatar from prod database,
 * converts it to BYTEA, and updates dev database.
 * Also bumps updated_at to ensure dev wins conflicts during db-sync.
 *
 * Usage:
 *   PROD_DB="postgresql://..." DEV_DB="postgresql://..." npx tsx scripts/sync-euclidia-avatar.ts
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const prodDbUrl = process.env.PROD_DB;
  const devDbUrl = process.env.DEV_DB || process.env.DATABASE_URL;

  if (!prodDbUrl) {
    console.error('❌ PROD_DB environment variable required');
    console.error('Usage: PROD_DB="postgresql://..." DEV_DB="postgresql://..." npx tsx scripts/sync-euclidia-avatar.ts');
    process.exit(1);
  }

  if (!devDbUrl) {
    console.error('❌ DEV_DB or DATABASE_URL environment variable required');
    process.exit(1);
  }

  console.log('🔄 Syncing Euclidia avatar from prod to dev\n');

  // Connect to both databases
  const prodPrisma = new PrismaClient({ datasources: { db: { url: prodDbUrl } } });
  const devPrisma = new PrismaClient({ datasources: { db: { url: devDbUrl } } });

  try {
    // Find Euclidia in prod database using raw SQL (prod has TEXT schema)
    console.log('📡 Connecting to prod database...');
    const prodResult: any[] = await prodPrisma.$queryRaw`
      SELECT id, slug, name, avatar_data, updated_at, system_prompt_id,
             personality_appearance, personality_tone, personality_age, custom_fields
      FROM personalities
      WHERE slug = 'euclidia-yakhas-ha-zahav'
    `;

    if (!prodResult || prodResult.length === 0) {
      console.error('❌ Euclidia not found in prod database');
      process.exit(1);
    }

    const prodEuclidia = prodResult[0];
    console.log(`✅ Found Euclidia in prod: ${prodEuclidia.name}`);
    console.log(`   ID: ${prodEuclidia.id}`);
    console.log(`   Last updated: ${prodEuclidia.updated_at}`);

    // Check if avatar data exists
    if (!prodEuclidia.avatar_data) {
      console.error('❌ Euclidia has no avatar data in prod');
      process.exit(1);
    }

    // Convert base64 to Buffer
    console.log('📝 Converting base64 avatar to BYTEA...');
    const avatarBuffer = Buffer.from(prodEuclidia.avatar_data, 'base64');
    console.log(`   Original base64 size: ${prodEuclidia.avatar_data.length} chars`);
    console.log(`   BYTEA size: ${avatarBuffer.length} bytes (${(avatarBuffer.length / 1024).toFixed(2)} KB)`);

    // Check if Euclidia exists in dev database
    console.log('\n📡 Checking dev database...');
    const devEuclidia = await devPrisma.personality.findUnique({
      where: { slug: 'euclidia-yakhas-ha-zahav' },
      select: { id: true, name: true, updatedAt: true },
    });

    if (devEuclidia) {
      console.log(`✅ Found Euclidia in dev: ${devEuclidia.name}`);
      console.log(`   ID: ${devEuclidia.id}`);
      console.log(`   Last updated: ${devEuclidia.updatedAt}`);

      // Update existing record
      console.log('\n💾 Updating dev database...');
      const updated = await devPrisma.personality.update({
        where: { slug: 'euclidia-yakhas-ha-zahav' },
        data: {
          avatarData: avatarBuffer,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          name: true,
          avatarData: true,
          updatedAt: true,
        },
      });

      console.log(`✅ Updated Euclidia in dev`);
      console.log(`   New avatar size: ${updated.avatarData?.length || 0} bytes`);
      console.log(`   New updated_at: ${updated.updatedAt}`);
    } else {
      console.log('ℹ️  Euclidia not found in dev - creating new record...');

      // Get default system prompt and LLM config
      const defaultSystemPrompt = await devPrisma.systemPrompt.findFirst({
        where: { isDefault: true },
      });
      const defaultLlmConfig = await devPrisma.llmConfig.findFirst({
        where: { isDefault: true, isGlobal: true },
      });

      if (!defaultSystemPrompt || !defaultLlmConfig) {
        console.error('❌ Default system prompt or LLM config not found in dev');
        process.exit(1);
      }

      // Create new personality
      console.log('\n💾 Creating Euclidia in dev database...');
      const created = await devPrisma.$transaction(async (tx) => {
        const personality = await tx.personality.create({
          data: {
            id: prodEuclidia.id,
            slug: prodEuclidia.slug,
            name: prodEuclidia.name,
            systemPromptId: defaultSystemPrompt.id,
            avatarData: avatarBuffer,
            personalityAppearance: prodEuclidia.personality_appearance,
            personalityTone: prodEuclidia.personality_tone,
            personalityAge: prodEuclidia.personality_age,
            customFields: prodEuclidia.custom_fields || {},
            updatedAt: new Date(),
          },
        });

        // Create default config link
        await tx.personalityDefaultConfig.create({
          data: {
            personalityId: personality.id,
            llmConfigId: defaultLlmConfig.id,
          },
        });

        return personality;
      });

      console.log(`✅ Created Euclidia in dev`);
      console.log(`   ID: ${created.id}`);
      console.log(`   Avatar size: ${created.avatarData?.length || 0} bytes`);
      console.log(`   Updated at: ${created.updatedAt}`);
    }

    console.log('\n✨ Sync complete!');
    console.log('\n📋 Next steps:');
    console.log('   1. Deploy schema migrations to prod');
    console.log('   2. Run db-sync from dev → prod');
    console.log('   3. Dev will win conflicts due to newer updated_at timestamp');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prodPrisma.$disconnect();
    await devPrisma.$disconnect();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
