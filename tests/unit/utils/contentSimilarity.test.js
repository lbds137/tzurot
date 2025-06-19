const {
  calculateSimilarity,
  areContentsSimilar,
  getProxyDelayTime,
} = require('../../../src/utils/contentSimilarity');
const logger = require('../../../src/logger');

// Mock the logger
jest.mock('../../../src/logger');

describe('contentSimilarity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateSimilarity', () => {
    it('should return 0 for null or undefined inputs', () => {
      expect(calculateSimilarity(null, 'test')).toBe(0);
      expect(calculateSimilarity('test', null)).toBe(0);
      expect(calculateSimilarity(undefined, 'test')).toBe(0);
      expect(calculateSimilarity('test', undefined)).toBe(0);
      expect(calculateSimilarity(null, null)).toBe(0);
    });

    it('should return 0 for non-string inputs', () => {
      expect(calculateSimilarity(123, 'test')).toBe(0);
      expect(calculateSimilarity('test', 123)).toBe(0);
      expect(calculateSimilarity({}, 'test')).toBe(0);
      expect(calculateSimilarity('test', [])).toBe(0);
      expect(calculateSimilarity(true, false)).toBe(0);
    });

    it('should return 1 for identical strings', () => {
      expect(calculateSimilarity('hello', 'hello')).toBe(1);
      expect(calculateSimilarity('Hello World!', 'Hello World!')).toBe(1);
      // Empty strings return 0, not 1
      expect(calculateSimilarity('', '')).toBe(0);
      expect(calculateSimilarity('   ', '   ')).toBe(1); // Identical before normalization
    });

    it('should be case-insensitive for longer strings', () => {
      // Short strings (< 5 chars) use inclusion logic, return 0.9
      expect(calculateSimilarity('TEST', 'test')).toBe(0.9);
      expect(calculateSimilarity('Hi', 'hi')).toBe(0.9);

      // Longer strings use Levenshtein distance
      expect(calculateSimilarity('HELLO', 'hello')).toBe(1);
      expect(calculateSimilarity('Hello World', 'hello world')).toBe(1);
    });

    it('should trim whitespace', () => {
      expect(calculateSimilarity('  hello  ', 'hello')).toBe(1);
      expect(calculateSimilarity('test ', ' test')).toBe(0.9); // Short string, uses inclusion
      expect(calculateSimilarity('\thello\n', 'hello')).toBe(1);
    });

    it('should return 0 for empty strings after normalization', () => {
      expect(calculateSimilarity('', 'test')).toBe(0);
      expect(calculateSimilarity('test', '')).toBe(0);
      expect(calculateSimilarity('   ', 'test')).toBe(0);
      expect(calculateSimilarity('test', '   ')).toBe(0);
    });

    it('should handle very short strings with special logic', () => {
      // Strings under 5 characters use inclusion check
      expect(calculateSimilarity('hi', 'hi!')).toBe(0.9);
      expect(calculateSimilarity('test', 'tes')).toBe(0.9);
      expect(calculateSimilarity('abc', 'abcd')).toBe(0.9);
      expect(calculateSimilarity('xy', 'ab')).toBe(0);
    });

    it('should calculate Levenshtein distance for longer strings', () => {
      // Same length strings with one character difference
      const sim1 = calculateSimilarity('hello world', 'hella world');
      expect(sim1).toBeGreaterThan(0.9);
      expect(sim1).toBeLessThan(1);

      // Different length strings
      const sim2 = calculateSimilarity('hello world', 'hello worlds');
      expect(sim2).toBeGreaterThan(0.9);
      expect(sim2).toBeLessThan(1);

      // Multiple differences
      const sim3 = calculateSimilarity('hello world', 'goodbye world');
      expect(sim3).toBeGreaterThan(0.4);
      expect(sim3).toBeLessThan(0.6);
    });

    it('should handle completely different strings', () => {
      const sim = calculateSimilarity('abcdefghij', 'klmnopqrst');
      expect(sim).toBe(0);
    });

    it('should handle strings with common prefixes', () => {
      const sim = calculateSimilarity('prefix_different', 'prefix_something');
      expect(sim).toBeGreaterThan(0.4);
      expect(sim).toBeLessThan(0.7);
    });

    it('should handle strings with common suffixes', () => {
      const sim = calculateSimilarity('start_suffix', 'other_suffix');
      expect(sim).toBeGreaterThan(0.4);
      expect(sim).toBeLessThan(0.7);
    });

    it('should handle strings with transpositions', () => {
      const sim = calculateSimilarity('hello world', 'hello wrold');
      expect(sim).toBeGreaterThan(0.8);
      expect(sim).toBeLessThan(1);
    });

    it('should handle strings with insertions', () => {
      const sim = calculateSimilarity('hello world', 'hello beautiful world');
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(0.6);
    });

    it('should handle strings with deletions', () => {
      const sim = calculateSimilarity('hello beautiful world', 'hello world');
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(0.6);
    });

    it('should handle repeated characters', () => {
      const sim = calculateSimilarity('aaaaaaa', 'aaaaaa');
      expect(sim).toBeGreaterThan(0.8);
      expect(sim).toBeLessThan(1);
    });

    it('should handle special characters', () => {
      expect(calculateSimilarity('hello!@#$', 'hello!@#$')).toBe(1);
      const sim = calculateSimilarity('hello!@#$', 'hello!@#%');
      expect(sim).toBeGreaterThan(0.8);
      expect(sim).toBeLessThan(1);
    });

    it('should handle unicode characters', () => {
      expect(calculateSimilarity('hello 👋', 'hello 👋')).toBe(1);
      const sim = calculateSimilarity('hello 👋', 'hello 👍');
      expect(sim).toBeGreaterThan(0.8);
      expect(sim).toBeLessThan(1);
    });
  });

  describe('areContentsSimilar', () => {
    it('should use default threshold of 0.8', () => {
      // Very similar strings (>0.8 similarity)
      expect(areContentsSimilar('hello world', 'hello world!')).toBe(true);
      expect(areContentsSimilar('test message', 'test messages')).toBe(true);

      // Less similar strings (<0.8 similarity)
      expect(areContentsSimilar('hello world', 'goodbye world')).toBe(false);
      expect(areContentsSimilar('completely', 'different')).toBe(false);
    });

    it('should respect custom threshold', () => {
      const content1 = 'hello world';
      const content2 = 'hello worlds';

      // With high threshold
      expect(areContentsSimilar(content1, content2, 0.95)).toBe(false);

      // With low threshold
      expect(areContentsSimilar(content1, content2, 0.5)).toBe(true);

      // With threshold of 1 (exact match only)
      expect(areContentsSimilar('exact', 'exact', 1)).toBe(true);
      expect(areContentsSimilar('exact', 'exac', 1)).toBe(false);
    });

    it('should log debug information', () => {
      areContentsSimilar('test', 'test', 0.8);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[ContentSimilarity] Similarity score:')
      );
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('threshold: 0.8'));
    });

    it('should handle edge cases', () => {
      expect(areContentsSimilar(null, 'test')).toBe(false);
      expect(areContentsSimilar('test', null)).toBe(false);
      expect(areContentsSimilar('', '')).toBe(false); // Empty strings have 0 similarity
      expect(areContentsSimilar('   ', '   ')).toBe(true); // Identical strings
    });

    it('should work with typical proxy message variations', () => {
      // Common proxy message patterns
      expect(areContentsSimilar('Hello from the bot!', 'Hello from the bot!')).toBe(true);

      // Slight variations that should still match
      expect(areContentsSimilar('This is a test message', 'This is a test message.')).toBe(true);

      // Case differences
      expect(areContentsSimilar('Important Message', 'important message')).toBe(true);
    });

    it('should differentiate between actually different messages', () => {
      expect(areContentsSimilar('Hello, how are you?', 'Goodbye, see you later!')).toBe(false);

      expect(areContentsSimilar('First message', 'Second message')).toBe(false);
    });
  });

  describe('getProxyDelayTime', () => {
    it('should return a consistent delay time', () => {
      const delay = getProxyDelayTime();
      expect(typeof delay).toBe('number');
      expect(delay).toBe(2500);
    });

    it('should return the same value on multiple calls', () => {
      const delay1 = getProxyDelayTime();
      const delay2 = getProxyDelayTime();
      const delay3 = getProxyDelayTime();

      expect(delay1).toBe(delay2);
      expect(delay2).toBe(delay3);
    });

    it('should return a reasonable delay for proxy systems', () => {
      const delay = getProxyDelayTime();
      // Should be between 1 and 5 seconds
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });
});
