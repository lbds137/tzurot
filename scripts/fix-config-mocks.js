#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Find all test files that need updating
const testFiles = [
  'tests/unit/commands/handlers/activate.test.js',
  'tests/unit/commands/handlers/alias.test.js',
  'tests/unit/commands/handlers/auth.test.js',
  'tests/unit/commands/handlers/deactivate.test.js',
  'tests/unit/commands/handlers/info.test.js',
  'tests/unit/commands/handlers/list.test.js',
  'tests/unit/commands/handlers/reset.test.js',
  'tests/unit/commands/handlers/status.test.js',
  'tests/unit/commands/handlers/verify.test.js',
  'tests/unit/commands/handlers/debug.test.js',
  'tests/unit/commands/handlers/remove.test.js',
  'tests/unit/commands/handlers/purgbot.test.js',
  'tests/unit/commands/middleware/auth.test.js',
  'tests/unit/conversationManager.test.js',
  'tests/unit/dataStorage.test.js',
  'tests/unit/bot.referenced.media.test.js',
  'tests/unit/aiService.test.js',
  'tests/unit/logger.test.js'
];

const oldConfigMock = `jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));`;

const newConfigMock = `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`;

// Also handle variations with different paths
const oldConfigMock2 = `jest.mock('../../../config', () => ({
  botPrefix: '!tz'
}));`;

const newConfigMock2 = `jest.mock('../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`;

const oldConfigMock3 = `jest.mock('../../config', () => ({
  botPrefix: '!tz'
}));`;

const newConfigMock3 = `jest.mock('../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`;

let fixedCount = 0;

testFiles.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} - file not found`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  // Replace all variations
  if (content.includes(oldConfigMock)) {
    content = content.replace(oldConfigMock, newConfigMock);
  }
  if (content.includes(oldConfigMock2)) {
    content = content.replace(oldConfigMock2, newConfigMock2);
  }
  if (content.includes(oldConfigMock3)) {
    content = content.replace(oldConfigMock3, newConfigMock3);
  }
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    console.log(`Fixed config mock in ${file}`);
    fixedCount++;
  }
});

console.log(`\nFixed ${fixedCount} files`);