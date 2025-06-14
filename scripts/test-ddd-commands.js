#!/usr/bin/env node

/**
 * Test script to verify DDD command system is working
 */

// Set required environment variables for testing
process.env.AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8080';
process.env.AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY || 'test-key';

// Load environment variables from .env.ddd-testing
require('dotenv').config({ path: '.env.ddd-testing' });

const { getFeatureFlags } = require('../src/application/services/FeatureFlags');
const { getCommandIntegration } = require('../src/application/commands/CommandIntegration');
const { getApplicationBootstrap } = require('../src/application/bootstrap/ApplicationBootstrap');

async function testDDDCommands() {
  console.log('🧪 Testing DDD Command System...\n');

  try {
    // Check feature flags
    console.log('📋 Feature Flags:');
    const flags = getFeatureFlags();
    console.log(`  - ddd.commands.integration: ${flags.isEnabled('ddd.commands.integration')}`);
    console.log(`  - ddd.commands.enabled: ${flags.isEnabled('ddd.commands.enabled')}`);
    console.log(`  - ddd.commands.personality: ${flags.isEnabled('ddd.commands.personality')}`);
    console.log(`  - ddd.personality.read: ${flags.isEnabled('ddd.personality.read')}`);
    console.log(`  - ddd.personality.write: ${flags.isEnabled('ddd.personality.write')}`);
    console.log('');

    // Initialize application bootstrap
    console.log('🚀 Initializing DDD Application Layer...');
    const appBootstrap = getApplicationBootstrap();
    await appBootstrap.initialize();
    console.log('✅ Application layer initialized\n');

    // Check registered commands
    console.log('📝 Registered Commands:');
    const commandIntegration = getCommandIntegration();
    const commands = commandIntegration.getAllCommands();
    commands.forEach(cmd => {
      console.log(`  - /${cmd.name}: ${cmd.description}`);
    });
    console.log(`\nTotal: ${commands.length} commands registered`);

    // Test command lookup
    console.log('\n🔍 Testing Command Lookup:');
    const testCommands = ['add', 'remove', 'info', 'alias', 'list', 'reset'];
    testCommands.forEach(cmdName => {
      const hasCommand = commandIntegration.hasCommand(cmdName);
      console.log(`  - ${cmdName}: ${hasCommand ? '✅ Found' : '❌ Not found'}`);
    });

    console.log('\n✅ DDD Command System is ready!');
    console.log('\n📌 To enable in production:');
    console.log('  1. Copy .env.ddd-testing to .env');
    console.log('  2. Restart the bot');
    console.log('  3. Commands will automatically use the new DDD system');

  } catch (error) {
    console.error('\n❌ Error testing DDD commands:', error);
    process.exit(1);
  }
}

// Run the test
testDDDCommands().catch(console.error);