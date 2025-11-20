#!/usr/bin/env node

/**
 * Script to check thread activation state
 * Usage: node scripts/check-thread-activation.js <thread-id>
 */

const { getActivatedPersonality, getAllActivatedChannels } = require('../src/conversationManager');
const logger = require('../src/logger');

async function checkThreadActivation() {
  const threadId = process.argv[2];
  
  if (!threadId) {
    console.log('Usage: node scripts/check-thread-activation.js <thread-id>');
    console.log('\nAll activated channels:');
    const allActivated = getAllActivatedChannels();
    console.log(JSON.stringify(allActivated, null, 2));
    return;
  }
  
  console.log(`Checking activation state for thread: ${threadId}`);
  
  const activatedPersonality = getActivatedPersonality(threadId);
  
  if (activatedPersonality) {
    console.log(`✓ Thread ${threadId} has activated personality: ${activatedPersonality}`);
  } else {
    console.log(`✗ Thread ${threadId} has NO activated personality`);
  }
  
  console.log('\nAll activated channels:');
  const allActivated = getAllActivatedChannels();
  console.log(JSON.stringify(allActivated, null, 2));
}

checkThreadActivation().catch(console.error);