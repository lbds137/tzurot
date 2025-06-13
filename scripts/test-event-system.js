#!/usr/bin/env node

/**
 * Test script to verify the domain event system is working
 * Run with: node scripts/test-event-system.js
 */

const logger = require('../src/logger');
const { getApplicationBootstrap } = require('../src/application/bootstrap/ApplicationBootstrap');
const { getFeatureFlags } = require('../src/application/services/FeatureFlags');

async function testEventSystem() {
  try {
    console.log('🧪 Testing Domain Event System...\n');

    // Set up test environment
    process.env.AI_SERVICE_URL = 'http://localhost:8080';
    process.env.AI_SERVICE_API_KEY = 'test-key';

    // Enable event system
    const featureFlags = getFeatureFlags();
    featureFlags.enable('ddd.events.enabled');
    featureFlags.enable('ddd.personality.write');
    console.log('✅ Enabled event system feature flags\n');

    // Initialize application
    const bootstrap = getApplicationBootstrap();
    await bootstrap.initialize();
    console.log('✅ Application bootstrap initialized\n');

    // Get services
    const services = bootstrap.getApplicationServices();
    const personalityService = services.personalityApplicationService;
    
    // IMPORTANT: The PersonalityRouter also has the correctly configured service
    const { getPersonalityRouter } = require('../src/application/routers/PersonalityRouter');
    const router = getPersonalityRouter();
    const routerPersonalityService = router.personalityService;
    
    // Clean up any existing test personality first
    try {
      await routerPersonalityService.removePersonality({
        personalityName: 'EventTestBot',
        requesterId: '123456789012345678'
      });
    } catch (err) {
      // Ignore if it doesn't exist
    }
    
    // Test personality creation
    console.log('📝 Creating test personality...');
    const testPersonality = await routerPersonalityService.registerPersonality({
      name: 'EventTestBot',
      ownerId: '123456789012345678', // Valid Discord ID format
      prompt: 'I am a test personality for event system testing',
      modelPath: '/test',
      maxWordCount: 100
    });
    
    console.log('✅ Personality created:', testPersonality.profile.name);
    console.log('\n📢 Check the logs above for event handler output!\n');

    // Update the personality to trigger more events
    console.log('📝 Updating test personality...');
    await routerPersonalityService.updatePersonalityProfile({
      personalityName: 'EventTestBot',
      requesterId: '123456789012345678',
      prompt: 'Updated prompt for event testing',
      maxWordCount: 200
    });
    console.log('✅ Personality updated\n');

    // Add an alias
    console.log('📝 Adding alias...');
    await routerPersonalityService.addAlias({
      personalityName: 'EventTestBot',
      alias: 'ETB',
      requesterId: '123456789012345678'
    });
    console.log('✅ Alias added\n');

    // Remove the personality
    console.log('📝 Removing test personality...');
    await routerPersonalityService.removePersonality({
      personalityName: 'EventTestBot',
      requesterId: '123456789012345678'
    });
    console.log('✅ Personality removed\n');

    console.log('🎉 Event system test complete!');
    console.log('Check the logs to see the event handlers in action.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup
    try {
      const bootstrap = getApplicationBootstrap();
      await bootstrap.shutdown();
    } catch (err) {
      // Ignore shutdown errors
    }
    process.exit(0);
  }
}

// Run the test
testEventSystem();