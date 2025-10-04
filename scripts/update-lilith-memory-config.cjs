#!/usr/bin/env node
/**
 * Update Lilith's LlmConfig with memory retrieval settings
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔧 Updating Lilith\'s memory configuration...\n');

  // Find Lilith's personality
  const lilith = await prisma.personality.findFirst({
    where: {
      name: 'Lilith'
    },
    include: {
      llmConfig: true
    }
  });

  if (!lilith) {
    console.error('❌ Lilith personality not found!');
    process.exit(1);
  }

  if (!lilith.llmConfig) {
    console.error('❌ Lilith has no LlmConfig!');
    process.exit(1);
  }

  console.log(`Found Lilith (${lilith.id})`);
  console.log(`Current LlmConfig: ${lilith.llmConfig.name}`);
  console.log(`  - memoryScoreThreshold: ${lilith.llmConfig.memoryScoreThreshold || 'not set'}`);
  console.log(`  - memoryLimit: ${lilith.llmConfig.memoryLimit || 'not set'}\n`);

  // Update the LlmConfig with memory settings
  const updated = await prisma.llmConfig.update({
    where: {
      id: lilith.llmConfig.id
    },
    data: {
      memoryScoreThreshold: 0.25, // Raised from 0.10 to filter out noise
      memoryLimit: 10 // Reduced from 15 to prevent prompt bloat
    }
  });

  console.log('✅ Updated memory configuration:');
  console.log(`  - memoryScoreThreshold: ${updated.memoryScoreThreshold}`);
  console.log(`  - memoryLimit: ${updated.memoryLimit}\n`);
  console.log('🎉 Done!\n');
}

main()
  .catch(error => {
    console.error('❌ Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
