#!/usr/bin/env node

/**
 * Script to sync personalities from legacy system to DDD system
 * This ensures both systems have the same data
 */

const path = require('path');
const fs = require('fs').promises;
const logger = require('../src/logger');

// Import the legacy personality manager
const PersonalityManager = require('../src/core/personality/PersonalityManager');
const personalityManager = PersonalityManager.getInstance();

// Import DDD components
const { FilePersonalityRepository } = require('../src/adapters/persistence/FilePersonalityRepository');
const { PersonalityApplicationService } = require('../src/application/services/PersonalityApplicationService');
const { DomainEventBus } = require('../src/domain/shared');

async function syncPersonalities() {
  try {
    console.log('Starting personality sync from legacy to DDD system...');
    
    // Initialize legacy system
    await personalityManager.initialize(false);
    console.log(`Found ${personalityManager.size} personalities in legacy system`);
    
    // Create DDD repository
    const dddRepository = new FilePersonalityRepository({
      dataPath: path.join(__dirname, '../data'),
      fileName: 'ddd-personalities.json'
    });
    
    // Load existing DDD data
    await dddRepository.initialize();
    
    // Get all personalities from legacy system
    const legacyPersonalities = personalityManager.getAllPersonalities();
    
    // Convert and save each personality to DDD system
    let synced = 0;
    let skipped = 0;
    
    for (const legacyData of legacyPersonalities) {
      try {
        const fullName = legacyData.fullName;
        
        // Check if already exists in DDD
        const existing = await dddRepository.findByName(fullName);
        if (existing) {
          console.log(`Skipping ${fullName} - already exists in DDD system`);
          skipped++;
          continue;
        }
        
        // Create personality in DDD format
        const personality = {
          id: fullName,
          personalityId: fullName,
          ownerId: legacyData.addedBy || '278863839632818186', // Use your ID as default
          profile: {
            name: fullName,
            displayName: legacyData.displayName || fullName,
            prompt: `You are ${legacyData.displayName || fullName}`,
            modelPath: `/profiles/${fullName}`,
            maxWordCount: 1000
          },
          model: {
            name: fullName,
            endpoint: `/profiles/${fullName}`,
            capabilities: {
              maxTokens: 4096,
              supportsImages: true,
              supportsAudio: false
            }
          },
          aliases: [],
          savedAt: legacyData.addedAt || new Date().toISOString()
        };
        
        // Get aliases from legacy system
        const aliases = [];
        for (const [alias, personalityName] of personalityManager.personalityAliases.entries()) {
          if (personalityName === fullName) {
            aliases.push(alias);
          }
        }
        personality.aliases = aliases;
        
        // Create a domain entity and save through repository
        const { Personality, PersonalityId, PersonalityProfile, UserId } = require('../src/domain/personality');
        const { AIModel } = require('../src/domain/ai');
        
        const personalityId = new PersonalityId(fullName);
        const userId = new UserId(personality.ownerId);
        const profile = new PersonalityProfile(
          personality.profile.name,
          personality.profile.prompt,
          personality.profile.modelPath,
          personality.profile.maxWordCount
        );
        const model = new AIModel(
          personality.model.name,
          personality.model.endpoint,
          personality.model.capabilities
        );
        
        const domainPersonality = new Personality(personalityId, userId, profile, model);
        domainPersonality._aliases = aliases.map(a => ({ name: a }));
        
        await dddRepository.save(domainPersonality);
        
        console.log(`✓ Synced ${fullName} with ${aliases.length} aliases`);
        synced++;
        
      } catch (error) {
        console.error(`Error syncing ${legacyData.fullName}: ${error.message}`);
      }
    }
    
    // Also update the legacy format file to ensure consistency
    const legacyData = {};
    const aliasData = {};
    
    for (const p of legacyPersonalities) {
      legacyData[p.fullName] = {
        fullName: p.fullName,
        displayName: p.displayName || p.fullName,
        addedBy: p.addedBy || '278863839632818186',
        addedAt: p.addedAt || new Date().toISOString(),
        lastUpdated: p.lastUpdated || new Date().toISOString()
      };
    }
    
    // Get all aliases
    for (const [alias, personalityName] of personalityManager.personalityAliases.entries()) {
      aliasData[alias] = personalityName;
    }
    
    // Save legacy format
    await fs.writeFile(
      path.join(__dirname, '../data/personalities.json'),
      JSON.stringify(legacyData, null, 2)
    );
    
    await fs.writeFile(
      path.join(__dirname, '../data/aliases.json'),
      JSON.stringify(aliasData, null, 2)
    );
    
    console.log(`\nSync complete! Synced ${synced} personalities, skipped ${skipped}`);
    console.log('\nThe DDD system now has all personalities from the legacy system.');
    
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

// Run the sync
syncPersonalities().then(() => {
  console.log('\nDone!');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});