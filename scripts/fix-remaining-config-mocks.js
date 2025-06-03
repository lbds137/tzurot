#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Files that need special handling
const updates = [
  {
    file: 'tests/unit/commands/handlers/list.test.js',
    old: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));`,
    new: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/commands/handlers/reset.test.js',
    old: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));`,
    new: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/commands/handlers/verify.test.js',
    old: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));`,
    new: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/commands/handlers/remove.test.js',
    old: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  isDevelopment: false,
  APP_ID: 'test-app-id',
}));`,
    new: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  isDevelopment: false,
  APP_ID: 'test-app-id',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/commands/handlers/purgbot.test.js',
    old: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
}));`,
    new: `jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/bot.referenced.media.test.js',
    old: `jest.mock('../../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://api.example.com'),
  getModelPath: jest.fn().mockReturnValue('mock-model-path')
}));`,
    new: `jest.mock('../../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://api.example.com'),
  getModelPath: jest.fn().mockReturnValue('mock-model-path'),
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/aiService.test.js',
    old: `jest.mock('../../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://example.com/api'),
  getModelPath: jest.fn().mockReturnValue('mock-model-path'),
  botPrefix: '!tz'
}));`,
    new: `jest.mock('../../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://example.com/api'),
  getModelPath: jest.fn().mockReturnValue('mock-model-path'),
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  }
];

// For tests that don't mock config but import logger
const testsNeedingConfigMock = [
  {
    file: 'tests/unit/conversationManager.test.js',
    afterLine: `jest.mock('../src/logger');`,
    add: `jest.mock('../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/dataStorage.test.js',
    afterLine: `jest.mock('../src/logger');`,
    add: `jest.mock('../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));`
  },
  {
    file: 'tests/unit/logger.test.js',
    afterLine: `jest.mock('winston', () => ({`,
    add: `

jest.mock('../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));

jest.mock('winston', () => (`,
    replace: true
  }
];

let fixedCount = 0;

// Fix existing mocks
updates.forEach(({file, old, new: newContent}) => {
  const filePath = path.join(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} - file not found`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (content.includes(old)) {
    content = content.replace(old, newContent);
    fs.writeFileSync(filePath, content);
    console.log(`Fixed config mock in ${file}`);
    fixedCount++;
  }
});

// Add missing mocks
testsNeedingConfigMock.forEach(({file, afterLine, add, replace}) => {
  const filePath = path.join(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} - file not found`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (replace) {
    content = content.replace(afterLine, add);
  } else {
    content = content.replace(afterLine, afterLine + '\n' + add);
  }
  
  fs.writeFileSync(filePath, content);
  console.log(`Added config mock to ${file}`);
  fixedCount++;
});

console.log(`\nFixed ${fixedCount} files`);