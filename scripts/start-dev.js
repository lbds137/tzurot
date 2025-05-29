#!/usr/bin/env node

/**
 * Development startup script
 * 
 * This script starts the bot in development mode with clear logging 
 * about which environment is being used.
 */

// Set development environment
process.env.NODE_ENV = 'development';

const { botConfig } = require('../config');

console.log('🔧 DEVELOPMENT MODE STARTUP');
console.log('==============================');
console.log(`🤖 Bot Name: ${botConfig.name}`);
console.log(`📝 Prefix: ${botConfig.prefix}`);
console.log(`🌍 Environment: ${botConfig.environment}`);
console.log(`🔗 Token: ${botConfig.token ? 'LOADED' : 'MISSING'}`);
console.log('==============================\n');

// Start the bot
require('../index.js');