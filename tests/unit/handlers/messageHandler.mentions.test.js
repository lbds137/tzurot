/**
 * Unit tests for mention detection functionality in messageHandler
 * Specifically tests checkForPersonalityMentions function
 */

const { checkForPersonalityMentions } = require('../../../src/handlers/messageHandler');
const { getPersonality, getPersonalityByAlias, getMaxAliasWordCount } = require('../../../src/core/personality');

// Mock dependencies
jest.mock('../../../src/core/personality');
jest.mock('../../../src/logger');
jest.mock('../../../config', () => ({
  botConfig: { mentionChar: '@' },
  botPrefix: '!tz'
}));

describe('checkForPersonalityMentions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMaxAliasWordCount.mockReturnValue(1); // Default to single word
  });

  describe('single word mentions', () => {
    it('should detect valid single-word personality mention', () => {
      const message = { content: '@TestBot hello', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValue({ fullName: 'test-bot' });

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'TestBot');
    });

    it('should handle mention at end of message', () => {
      const message = { content: 'hello @TestBot', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValue({ fullName: 'test-bot' });

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
    });

    it('should handle mention with punctuation', () => {
      const message = { content: 'hello @TestBot!', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValue({ fullName: 'test-bot' });

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'TestBot');
    });

    it('should return false for invalid mention', () => {
      const message = { content: '@NonExistent hello', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValue(null);

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(false);
    });
  });

  describe('multi-word mentions', () => {
    beforeEach(() => {
      getMaxAliasWordCount.mockReturnValue(2); // Allow 2-word aliases
    });

    it('should detect valid two-word personality mention', () => {
      const message = { content: '@angel dust hello', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValueOnce(null) // First check for "angel"
        .mockReturnValueOnce({ fullName: 'angel-dust-hazbin' }); // Second check for "angel dust"

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'angel dust');
    });

    it('should handle multi-word mention at end of message', () => {
      const message = { content: 'hello @angel dust', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValueOnce(null)
        .mockReturnValueOnce({ fullName: 'angel-dust-hazbin' });

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
    });

    it('should handle multi-word mention with punctuation', () => {
      const message = { content: '@angel dust, how are you?', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValueOnce(null)
        .mockReturnValueOnce({ fullName: 'angel-dust-hazbin' });

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'angel dust');
    });

    it('should handle three-word aliases when max is 3', () => {
      getMaxAliasWordCount.mockReturnValue(3);
      const message = { content: '@the dark lord speaks', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValueOnce(null) // "the"
        .mockReturnValueOnce(null) // "the dark"
        .mockReturnValueOnce({ fullName: 'the-dark-lord' }); // "the dark lord"

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'the dark lord');
    });

    it('should not check beyond max word count', () => {
      getMaxAliasWordCount.mockReturnValue(2); // Max 2 words
      const message = { content: '@one two three four', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValue(null);

      checkForPersonalityMentions(message);

      // Should only check up to 2 words
      expect(getPersonalityByAlias).not.toHaveBeenCalledWith('user123', 'one two three');
      expect(getPersonalityByAlias).not.toHaveBeenCalledWith('user123', 'one two three four');
    });
  });

  describe('edge cases', () => {
    it('should handle empty message content', () => {
      const message = { content: '', author: { id: 'user123' } };

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(false);
      expect(getPersonalityByAlias).not.toHaveBeenCalled();
    });

    it('should handle null message content', () => {
      const message = { content: null, author: { id: 'user123' } };

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(false);
    });

    it('should handle multiple mentions and return true on first match', () => {
      const message = { content: '@bot1 @bot2 hello', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValueOnce({ fullName: 'bot-1' }); // First mention matches

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
      expect(getPersonalityByAlias).toHaveBeenCalledTimes(1); // Stops after first match
    });

    it('should handle mentions with multiple spaces', () => {
      getMaxAliasWordCount.mockReturnValue(2);
      const message = { content: '@angel   dust hello', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValueOnce(null)
        .mockReturnValueOnce({ fullName: 'angel-dust-hazbin' });

      const result = checkForPersonalityMentions(message);

      expect(result).toBe(true);
      // Should normalize spaces
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'angel dust');
    });

    // Note: Testing different mention characters (@ vs &) requires complex module mocking
    // that doesn't work well with Jest's module system. This functionality is tested
    // manually and in integration tests.
  });

  describe('regex generation based on max word count', () => {
    it('should generate correct regex for 1 word max', () => {
      getMaxAliasWordCount.mockReturnValue(1);
      const message = { content: '@test mention', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValue(null);

      checkForPersonalityMentions(message);

      // With max 1 word, should only check single words
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'test');
      expect(getPersonalityByAlias).not.toHaveBeenCalledWith('user123', 'test mention');
    });

    it('should generate correct regex for 5 word max', () => {
      getMaxAliasWordCount.mockReturnValue(5);
      const message = { content: '@one two three four five six', author: { id: 'user123' } };
      getPersonality.mockReturnValue(null);
      getPersonalityByAlias.mockReturnValue(null);

      checkForPersonalityMentions(message);

      // Should check up to 5 words
      expect(getPersonalityByAlias).toHaveBeenCalledWith('user123', 'one two three four five');
      // Should not check 6 words
      expect(getPersonalityByAlias).not.toHaveBeenCalledWith('user123', 'one two three four five six');
    });
  });
});