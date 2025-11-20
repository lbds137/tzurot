/**
 * Unit tests for mention detection functionality in messageHandler
 * Specifically tests checkForPersonalityMentions function
 */

const { checkForPersonalityMentions } = require('../../../src/handlers/messageHandler');
const { resolvePersonality } = require('../../../src/utils/aliasResolver');

// Mock dependencies
jest.mock('../../../src/utils/aliasResolver');
jest.mock('../../../src/logger');
jest.mock('../../../src/config/MessageHandlerConfig');
jest.mock('../../../config', () => ({
  botConfig: { mentionChar: '@' },
  botPrefix: '!tz',
}));

const messageHandlerConfig = require('../../../src/config/MessageHandlerConfig');

describe('checkForPersonalityMentions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Mock message handler config
    messageHandlerConfig.getMaxAliasWordCount = jest.fn().mockReturnValue(1); // Default to single word
    
    // Legacy getMaxAliasWordCount removed - using DDD system
    resolvePersonality.mockResolvedValue(null); // Default to no personality found
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('single word mentions', () => {
    it('should detect valid single-word personality mention', async () => {
      const message = { content: '@TestPersonality hello', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValueOnce({ fullName: 'test-personality' });

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(resolvePersonality).toHaveBeenCalledWith('TestPersonality');
    });

    it('should handle mention at end of message', async () => {
      const message = { content: 'hello @TestPersonality', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValueOnce({ fullName: 'test-personality' });

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
    });

    it('should handle mention with punctuation', async () => {
      const message = { content: '@TestPersonality! How are you?', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValueOnce({ fullName: 'test-personality' });

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(resolvePersonality).toHaveBeenCalledWith('TestPersonality');
    });

    it('should return false for invalid mention', async () => {
      const message = { content: '@NonExistent hello', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValue(null);

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(false);
    });
  });

  describe('multi-word mentions', () => {
    beforeEach(() => {
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(2); // Allow 2-word aliases
    });

    it('should detect valid two-word personality mention', async () => {
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(2);
      const message = { content: '@angel dust hello', author: { id: 'user123' } };
      resolvePersonality
        .mockResolvedValueOnce(null) // First check for "angel"
        .mockResolvedValueOnce({ fullName: 'angel-dust-hazbin' }); // Second check for "angel dust"

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(resolvePersonality).toHaveBeenCalledWith('angel dust');
    });

    it('should handle multi-word mention at end of message', async () => {
      const message = { content: 'hello @angel dust', author: { id: 'user123' } };
      resolvePersonality
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ fullName: 'angel-dust-hazbin' });

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
    });

    it('should handle multi-word mention with punctuation', async () => {
      const message = { content: '@angel dust, how are you?', author: { id: 'user123' } };
      resolvePersonality
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ fullName: 'angel-dust-hazbin' });

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(resolvePersonality).toHaveBeenCalledWith('angel dust');
    });

    it('should handle three-word aliases when max is 3', async () => {
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(3);
      const message = { content: '@the dark lord speaks', author: { id: 'user123' } };
      resolvePersonality
        .mockResolvedValueOnce(null) // "the"
        .mockResolvedValueOnce(null) // "the dark"
        .mockResolvedValueOnce({ fullName: 'the-dark-lord' }); // "the dark lord"

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(resolvePersonality).toHaveBeenCalledWith('the dark lord');
    });

    it('should not check beyond max word count', async () => {
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(2); // Max 2 words
      const message = { content: '@one two three four', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValue(null);

      await checkForPersonalityMentions(message);

      // Should only check up to 2 words
      expect(resolvePersonality).not.toHaveBeenCalledWith('one two three');
      expect(resolvePersonality).not.toHaveBeenCalledWith('one two three four');
    });
  });

  describe('edge cases', () => {
    it('should handle empty message content', async () => {
      const message = { content: '', author: { id: 'user123' } };

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(false);
      expect(resolvePersonality).not.toHaveBeenCalled();
    });

    it('should handle null message content', async () => {
      const message = { content: null, author: { id: 'user123' } };

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(false);
    });

    it('should handle multiple mentions and return true on first match', async () => {
      const message = { content: '@bot1 @bot2 hello', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValueOnce({ fullName: 'bot-1' }); // First mention matches

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(resolvePersonality).toHaveBeenCalledTimes(1); // Stops after first match
    });

    it('should handle mentions with multiple spaces', async () => {
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(2);
      const message = { content: '@angel   dust hello', author: { id: 'user123' } };
      resolvePersonality
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ fullName: 'angel-dust-hazbin' });

      const result = await checkForPersonalityMentions(message);

      expect(result).toBe(true);
      // Should normalize spaces
      expect(resolvePersonality).toHaveBeenCalledWith('angel dust');
    });

    // Note: Testing different mention characters (@ vs &) requires complex module mocking
    // that doesn't work well with Jest's module system. This functionality is tested
    // manually and in integration tests.
  });

  describe('regex generation based on max word count', () => {
    it('should generate correct regex for 1 word max', async () => {
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(1);
      const message = { content: '@test mention', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValue(null);

      await checkForPersonalityMentions(message);

      // With max 1 word, should only check single words
      expect(resolvePersonality).toHaveBeenCalledWith('test');
      expect(resolvePersonality).not.toHaveBeenCalledWith('test mention');
    });

    it('should generate correct regex for 5 word max', async () => {
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(5);
      const message = { content: '@one two three four five six', author: { id: 'user123' } };
      resolvePersonality.mockResolvedValue(null);

      await checkForPersonalityMentions(message);

      // Should check up to 5 words
      expect(resolvePersonality).toHaveBeenCalledWith('one two three four five');
      // Should not check 6 words
      expect(resolvePersonality).not.toHaveBeenCalledWith('one two three four five six');
    });
  });
});