#!/usr/bin/env tsx
/**
 * Set the default global LLM config
 * Usage: tsx scripts/set-default-llm-config.ts <name-or-id>
 */

import { createPrismaClient, DB_POOL_DEFAULTS } from '@tzurot/common-types';
import { Redis } from 'ioredis';

const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

async function setDefaultConfig(nameOrId: string) {
  console.log(`🔍 Looking for LLM config: ${nameOrId}\n`);

  // Check if input looks like a UUID
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

  // Try to find by name or ID
  let config = await prisma.llmConfig.findFirst({
    where: isUUID
      ? {
          id: nameOrId,
          isGlobal: true,
        }
      : {
          name: { contains: nameOrId, mode: 'insensitive' },
          isGlobal: true,
        },
  });

  if (!config) {
    console.log(`❌ No global LLM config found matching: ${nameOrId}\n`);
    console.log('Available global configs:');

    const allConfigs = await prisma.llmConfig.findMany({
      where: { isGlobal: true },
      select: { id: true, name: true, isDefault: true },
    });

    for (const c of allConfigs) {
      console.log(`  - ${c.name} (${c.id})${c.isDefault ? ' [DEFAULT]' : ''}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(`Found: ${config.name} (${config.id})`);

  if (config.isDefault) {
    console.log(`✅ This config is already the default!\n`);
    return;
  }

  console.log(`\n📝 Setting as default...`);

  try {
    // First, unset any existing default
    const currentDefault = await prisma.llmConfig.findFirst({
      where: { isDefault: true },
    });

    if (currentDefault) {
      await prisma.llmConfig.update({
        where: { id: currentDefault.id },
        data: { isDefault: false },
      });
      console.log(`  Unset previous default: ${currentDefault.name}`);
    }

    // Set new default
    await prisma.llmConfig.update({
      where: { id: config.id },
      data: { isDefault: true },
    });

    console.log(`  ✅ Set ${config.name} as default\n`);

    // Invalidate personality caches across all services
    console.log('🔄 Broadcasting cache invalidation to all services...');
    const invalidationEvent = JSON.stringify({ type: 'all' });
    await redis.publish('cache:invalidation', invalidationEvent);
    console.log('  ✅ Cache invalidation event published\n');

    console.log('🎉 Default LLM config updated successfully!');
    console.log(`\nAll services will now use: ${config.name}`);
  } catch (error) {
    console.error('❌ Failed to set default config:', error);
    process.exitCode = 1;
  }
}

async function main() {
  try {
    const nameOrId = process.argv[2];

    if (!nameOrId) {
      console.log('Usage: tsx scripts/set-default-llm-config.ts <name-or-id>\n');
      console.log('Examples:');
      console.log('  tsx scripts/set-default-llm-config.ts "Sonnet 4.5"');
      console.log('  tsx scripts/set-default-llm-config.ts haiku');
      console.log('  tsx scripts/set-default-llm-config.ts 45b59b67-9c7f-52a8-bd72-b629d6e67a71\n');

      console.log('Available global configs:');
      const configs = await prisma.llmConfig.findMany({
        where: { isGlobal: true },
        select: { id: true, name: true, isDefault: true },
      });

      for (const c of configs) {
        console.log(`  - ${c.name}${c.isDefault ? ' [DEFAULT]' : ''}`);
      }

      process.exitCode = 1;
      return;
    }

    await setDefaultConfig(nameOrId);
  } catch (error) {
    console.error('Error:', error);
    process.exitCode = 1;
  } finally {
    await dispose();
    await redis.disconnect();
  }
}

main();
