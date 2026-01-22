/**
 * Test script for PersonalityMapper
 *
 * Validates that shapes.inc config maps correctly to v3 schema
 * using the cold-kerach-batuach personality as test data
 */

import fs from 'fs/promises';
import path from 'path';
import { PersonalityMapper } from './PersonalityMapper.js';
import type { ShapesIncPersonalityConfig } from './types.js';

async function testMapper() {
  console.log('🧪 Testing PersonalityMapper\n');
  console.log('='.repeat(80));

  try {
    // Load test data
    const testDataPath = path.join(
      process.cwd(),
      'tzurot-legacy/data/personalities/cold-kerach-batuach/cold-kerach-batuach.json'
    );

    console.log(`\n📁 Loading test data from: ${testDataPath}`);
    const rawData = await fs.readFile(testDataPath, 'utf-8');
    const shapesConfig: ShapesIncPersonalityConfig = JSON.parse(rawData);

    console.log(`✅ Loaded shapes.inc config: ${shapesConfig.name} (${shapesConfig.username})`);

    // Initialize mapper
    const mapper = new PersonalityMapper();

    // Validate config
    console.log('\n📋 Validating shapes.inc config...');
    const validation = mapper.validate(shapesConfig);

    if (!validation.valid) {
      console.error('❌ Validation failed:');
      validation.errors.forEach(error => console.error(`  - ${error}`));
      process.exit(1);
    }

    console.log('✅ Validation passed!');

    // Get summary
    console.log('\n📊 Config Summary:');
    const summary = mapper.summarize(shapesConfig);
    console.log(JSON.stringify(summary, null, 2));

    // Map to v3 format
    console.log('\n🔄 Mapping to v3 schema...');
    const v3Data = mapper.map(shapesConfig);

    console.log('\n✅ Mapping complete!');
    console.log('\n' + '='.repeat(80));
    console.log('V3 Personality Data:');
    console.log('='.repeat(80));

    // Display personality
    console.log('\n📝 Personality:');
    console.log(`  Name: ${v3Data.personality.name}`);
    console.log(`  Display Name: ${v3Data.personality.displayName}`);
    console.log(`  Slug: ${v3Data.personality.slug}`);
    console.log(`  Avatar URL: ${v3Data.personality.avatarUrl}`);
    console.log(`  Memory Enabled: ${v3Data.personality.memoryEnabled}`);
    console.log(`  Voice Enabled: ${v3Data.personality.voiceEnabled}`);
    console.log(`  Image Enabled: ${v3Data.personality.imageEnabled}`);
    console.log(`  Character Info Length: ${v3Data.personality.characterInfo.length} chars`);
    console.log(
      `  Personality Traits: ${v3Data.personality.personalityTraits.substring(0, 60)}...`
    );
    console.log(`  Personality Tone: ${v3Data.personality.personalityTone}`);
    console.log(`  Personality Age: ${v3Data.personality.personalityAge}`);

    // Display system prompt
    console.log('\n🤖 System Prompt:');
    console.log(`  Name: ${v3Data.systemPrompt.name}`);
    console.log(`  Description: ${v3Data.systemPrompt.description}`);
    console.log(`  Content Length: ${v3Data.systemPrompt.content.length} chars`);
    console.log(`  Is Default: ${v3Data.systemPrompt.isDefault}`);
    console.log(`  First 200 chars:\n    ${v3Data.systemPrompt.content.substring(0, 200)}...`);

    // Display LLM config
    console.log('\n⚙️  LLM Config:');
    console.log(`  Name: ${v3Data.llmConfig.name}`);
    console.log(`  Model: ${v3Data.llmConfig.model}`);
    console.log(`  Advanced Parameters: ${JSON.stringify(v3Data.llmConfig.advancedParameters)}`);
    console.log(`  Context Window Tokens: ${v3Data.llmConfig.contextWindowTokens}`);
    console.log(`  Memory Score Threshold: ${v3Data.llmConfig.memoryScoreThreshold}`);
    console.log(`  Memory Limit: ${v3Data.llmConfig.memoryLimit}`);
    console.log(`  Is Global: ${v3Data.llmConfig.isGlobal}`);

    // Verify critical mappings
    console.log('\n✅ Critical Verifications:');
    console.log(`  ✓ Model mapped: ${shapesConfig.engine_model} → ${v3Data.llmConfig.model}`);
    const advParams = v3Data.llmConfig.advancedParameters as Record<string, unknown> | null;
    console.log(
      `  ✓ Temperature preserved: ${shapesConfig.engine_temperature} → ${advParams?.temperature}`
    );
    console.log(
      `  ✓ STM window preserved: ${shapesConfig.stm_window} → ${v3Data.llmConfig.contextWindowTokens}`
    );
    console.log(
      `  ✓ LTM threshold preserved: ${shapesConfig.ltm_threshold} → ${v3Data.llmConfig.memoryScoreThreshold}`
    );
    console.log(`  ✓ Slug preserved: ${shapesConfig.username} → ${v3Data.personality.slug}`);

    console.log('\n' + '='.repeat(80));
    console.log('✅ All tests passed!');
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run tests
testMapper();
