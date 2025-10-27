#!/usr/bin/env tsx
/**
 * Verify the partial unique constraint on LlmConfig.isDefault
 * This should only allow one row with isDefault = true
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyConstraint() {
  console.log('🔍 Checking LLM configs...\n');

  // List all LLM configs
  const configs = await prisma.llmConfig.findMany({
    select: {
      id: true,
      name: true,
      isGlobal: true,
      isDefault: true
    }
  });

  console.log(`Found ${configs.length} LLM configs:\n`);

  for (const config of configs) {
    const flags = [];
    if (config.isGlobal) flags.push('global');
    if (config.isDefault) flags.push('DEFAULT');

    console.log(`  ${config.name}`);
    console.log(`    ID: ${config.id}`);
    console.log(`    Flags: ${flags.join(', ') || 'none'}`);
    console.log('');
  }

  // Count defaults
  const defaultCount = configs.filter(c => c.isDefault).length;
  console.log(`\n📊 Summary:`);
  console.log(`  Total configs: ${configs.length}`);
  console.log(`  Global configs: ${configs.filter(c => c.isGlobal).length}`);
  console.log(`  Default configs: ${defaultCount}`);

  if (defaultCount === 0) {
    console.log('\n⚠️  No default LLM config found!');
    console.log('You should mark one global config as default.');
  } else if (defaultCount === 1) {
    console.log('\n✅ Exactly one default config - perfect!');
  } else {
    console.log('\n❌ Multiple default configs found - this should be impossible!');
  }

  // Test the constraint by trying to set two configs as default
  if (configs.length >= 2 && defaultCount === 0) {
    console.log('\n🧪 Testing constraint by trying to set two configs as default...');

    try {
      // Set first as default
      await prisma.llmConfig.update({
        where: { id: configs[0].id },
        data: { isDefault: true }
      });
      console.log(`  ✅ Set ${configs[0].name} as default`);

      // Try to set second as default (should fail)
      await prisma.llmConfig.update({
        where: { id: configs[1].id },
        data: { isDefault: true }
      });
      console.log(`  ❌ ERROR: Was able to set ${configs[1].name} as default too!`);
      console.log(`  The constraint is NOT working!`);

    } catch (error) {
      if (error instanceof Error && error.message.includes('unique_default_llm_config')) {
        console.log(`  ✅ Constraint working! Cannot set second default.`);
        console.log(`  Error: ${error.message.split('\n')[0]}`);
      } else {
        console.log(`  ❌ Unexpected error: ${error}`);
      }
    }
  }
}

async function main() {
  try {
    await verifyConstraint();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
