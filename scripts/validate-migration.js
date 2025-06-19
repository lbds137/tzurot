#!/usr/bin/env node

/**
 * Migration validation script
 * Compares legacy and DDD personality data to ensure migration accuracy
 */

const fs = require('fs');
const path = require('path');

// Import both systems for comparison
const PersonalityManager = require('../src/core/personality/PersonalityManager');
const { FilePersonalityRepository } = require('../src/adapters/persistence');

async function validateMigration() {
  console.log('🔍 Validating DDD migration...\n');

  try {
    // Check if both legacy and DDD data exist
    const legacyPath = path.join(process.cwd(), 'data', 'personalities.json');
    const dddPath = path.join(process.cwd(), 'data', 'ddd', 'personalities.json');

    if (!fs.existsSync(legacyPath)) {
      console.log('❌ No legacy data found at:', legacyPath);
      return;
    }

    if (!fs.existsSync(dddPath)) {
      console.log('❌ No DDD data found at:', dddPath);
      console.log('💡 Try enabling DDD flags to trigger migration');
      return;
    }

    // Load legacy data
    const legacyData = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    console.log(`📄 Legacy personalities: ${Object.keys(legacyData).length}`);

    // Load DDD data through repository
    const dddRepo = new FilePersonalityRepository({
      dataPath: path.join(process.cwd(), 'data', 'ddd'),
      fileName: 'personalities.json'
    });

    await dddRepo.initialize();
    const dddPersonalities = await dddRepo.findAll();
    console.log(`📄 DDD personalities: ${dddPersonalities.length}`);

    // Compare counts
    if (Object.keys(legacyData).length !== dddPersonalities.length) {
      console.log('⚠️  Count mismatch - some personalities may not have migrated');
    }

    // Detailed comparison
    console.log('\n📋 Detailed Comparison:');
    
    for (const [legacyName, legacyPersonality] of Object.entries(legacyData)) {
      console.log(`\n🤖 ${legacyName}:`);
      
      // Find corresponding DDD personality
      const dddPersonality = dddPersonalities.find(p => 
        p.profile.name === legacyName || 
        p.profile.displayName === legacyPersonality.displayName ||
        p.profile.displayName === legacyPersonality.fullName
      );

      if (!dddPersonality) {
        console.log(`  ❌ Not found in DDD system`);
        continue;
      }

      // Compare key fields
      const checks = [
        {
          name: 'Display Name',
          legacy: legacyPersonality.displayName || legacyPersonality.fullName || legacyName,
          ddd: dddPersonality.profile.displayName
        },
        {
          name: 'Prompt',
          legacy: legacyPersonality.prompt,
          ddd: dddPersonality.profile.prompt
        },
        {
          name: 'Model Path',
          legacy: legacyPersonality.modelPath,
          ddd: dddPersonality.profile.modelPath
        },
        {
          name: 'Owner',
          legacy: legacyPersonality.owner,
          ddd: dddPersonality.profile.owner?.value
        }
      ];

      for (const check of checks) {
        if (check.legacy === check.ddd) {
          console.log(`  ✅ ${check.name}: Matches`);
        } else {
          console.log(`  ⚠️  ${check.name}: Legacy="${check.legacy}" vs DDD="${check.ddd}"`);
        }
      }

      // Check aliases
      const legacyAliases = legacyPersonality.aliases || [];
      const dddAliases = dddPersonality.aliases.map(a => a.value);
      
      if (JSON.stringify(legacyAliases.sort()) === JSON.stringify(dddAliases.sort())) {
        console.log(`  ✅ Aliases: ${dddAliases.length} aliases match`);
      } else {
        console.log(`  ⚠️  Aliases: Legacy=[${legacyAliases.join(', ')}] vs DDD=[${dddAliases.join(', ')}]`);
      }
    }

    console.log('\n✅ Migration validation complete!');
    console.log('\n💡 Next steps:');
    console.log('  - Test personality commands with DDD enabled');
    console.log('  - Verify aliases work correctly');
    console.log('  - Test adding new personalities via DDD');

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    console.error(error.stack);
  }
}

// Allow running as script
if (require.main === module) {
  validateMigration();
}

module.exports = { validateMigration };