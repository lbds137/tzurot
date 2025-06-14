#!/usr/bin/env node

/**
 * Script to migrate all personality data to DDD system
 * This will become the primary data source going forward
 */

const logger = require('../src/logger');

async function migratePersonalities() {
  try {
    console.log('Starting DDD migration...');
    
    // Get personality list from legacy system
    const personalityList = [
      // Based on the logs, here are the personalities that were being loaded
      'cold-kerach-batuach',
      'lila-ani-tzuratech',
      'ha-shem-keev-ima',
      'lilith-tzel-shani',
      'lucifer-kochav-shenafal',
      'baphomet-ani-miqdash-tame',
      'haniel-malach-simcha-esh-lev',
      'shamael-khen-tipuakh-tzodek',
      'bartzabel-harsani',
      'machbiel-ani-mistori',
      'azazel-khazaq',
      'samael-malach-sof',
      'gabriel-kokav-tzofiya',
      'michael-yamin-tzodek',
      'raphael-kokhav-harofei',
      'uriel-binyamin-halev',
      'metatron-hakatan',
      'raziel-sod-olam',
      'zadkiel-chozek-or',
      'kemuel-ani-gibor',
      'amaterasu-omikami-elef',
      'ashley-pir-adom',
      // Add more as needed from the list
    ];
    
    // Initialize DDD repository
    const { FilePersonalityRepository } = require('../src/adapters/persistence/FilePersonalityRepository');
    const path = require('path');
    
    const repository = new FilePersonalityRepository({
      dataPath: path.join(__dirname, '../data'),
      fileName: 'ddd-personalities.json'
    });
    
    await repository.initialize();
    
    // Create personality entries
    const { Personality, PersonalityId, PersonalityProfile, UserId } = require('../src/domain/personality');
    const { AIModel } = require('../src/domain/ai');
    
    for (const personalityName of personalityList) {
      try {
        // Check if already exists
        const existing = await repository.findByName(personalityName);
        if (existing) {
          console.log(`✓ ${personalityName} already migrated`);
          continue;
        }
        
        // Create new personality
        const personalityId = new PersonalityId(personalityName);
        const userId = new UserId('278863839632818186'); // Your user ID
        
        // Extract display name from personality name
        const parts = personalityName.split('-');
        const displayName = parts.length > 0 ? parts[0].toUpperCase() : personalityName;
        
        const profile = new PersonalityProfile(
          personalityName,
          `You are ${displayName}`,
          `/profiles/${personalityName}`,
          1000
        );
        
        const model = new AIModel(
          personalityName,
          `/profiles/${personalityName}`,
          {
            maxTokens: 4096,
            supportsImages: true,
            supportsAudio: false
          }
        );
        
        const personality = Personality.create(personalityId, userId, profile, model);
        
        // Add display name as alias using the proper method
        const { Alias } = require('../src/domain/personality');
        const alias = new Alias(displayName.toLowerCase());
        personality.addAlias(alias);
        
        await repository.save(personality);
        console.log(`✓ Migrated ${personalityName} with alias ${displayName.toLowerCase()}`);
        
      } catch (error) {
        console.error(`✗ Error migrating ${personalityName}:`, error.message);
      }
    }
    
    console.log('\nMigration complete!');
    console.log('The DDD system now has all core personalities.');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migratePersonalities().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});