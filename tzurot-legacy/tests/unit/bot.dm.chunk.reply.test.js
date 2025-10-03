/**
 * Tests for handling replies to any chunk of a multi-part DM message
 */

const logger = require('../../src/logger');
const webhookManager = require('../../src/webhookManager');
const { getAiResponse } = require('../../src/aiService');

// Mock the required modules
jest.mock('../../src/logger');
jest.mock('../../src/webhookManager');
jest.mock('../../src/aiService');

describe('Bot - DM Chunk Reply Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should properly detect personality name in previous messages', () => {
    // This is a simplified test for the core regex functionality
    // that handles finding personality names in message chunks

    // Test the direct match pattern for first chunk
    const firstChunkContent = '**Test Personality:** This is the first chunk';
    const directMatch = firstChunkContent.match(/^\*\*([^:]+):\*\* /);

    expect(directMatch).not.toBeNull();
    expect(directMatch[1]).toBe('Test Personality');

    // Test handling personality name with suffix
    const suffixedContent = '**Test Personality | Bot:** This is a message with suffix';
    const suffixMatch = suffixedContent.match(/^\*\*([^:]+):\*\* /);

    expect(suffixMatch).not.toBeNull();
    expect(suffixMatch[1]).toBe('Test Personality | Bot');

    // Verify we can extract base name from suffixed name
    const displayName = suffixMatch[1];
    const baseName = displayName.includes(' | ') ? displayName.split(' | ')[0] : displayName;
    expect(baseName).toBe('Test Personality');

    // Test that non-first chunks don't match the pattern
    const continuationChunk = 'This is a continuation chunk without prefix';
    const noMatch = continuationChunk.match(/^\*\*([^:]+):\*\* /);

    expect(noMatch).toBeNull();
  });

  it('should properly extract personality name from matched prefix', () => {
    // Simple regex test for various personality name formats

    const testCases = [
      {
        content: '**Simple Name:** Message content',
        expectedName: 'Simple Name',
      },
      {
        content: '**Name With | Suffix:** Message content',
        expectedName: 'Name With',
        expectedFull: 'Name With | Suffix',
      },
      {
        content: '**Complex-Name.With_Special~Chars:** Message',
        expectedName: 'Complex-Name.With_Special~Chars',
      },
      {
        content: '**Name | Multi | Part | Suffix:** Message',
        expectedName: 'Name',
        expectedFull: 'Name | Multi | Part | Suffix',
      },
    ];

    testCases.forEach(testCase => {
      const match = testCase.content.match(/^\*\*([^:]+):\*\* /);
      expect(match).not.toBeNull();
      expect(match[1]).toBe(testCase.expectedFull || testCase.expectedName);

      if (testCase.expectedFull) {
        const baseName = match[1].split(' | ')[0];
        expect(baseName).toBe(testCase.expectedName);
      }
    });
  });
});
