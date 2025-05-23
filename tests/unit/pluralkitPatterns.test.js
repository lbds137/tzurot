/**
 * Tests for PluralKit Pattern Detection
 * 
 * Tests the PluralKit proxy pattern detection system including
 * bracket patterns, prefix patterns, and command detection.
 */

const {
  isPotentialProxyMessage,
  getProxyDelayTime
} = require('../../src/utils/pluralkitPatterns');
const logger = require('../../src/logger');

// Mock dependencies
jest.mock('../../src/logger');

describe('PluralKit Patterns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isPotentialProxyMessage', () => {
    describe('bracket patterns', () => {
      it('should detect square brackets', () => {
        expect(isPotentialProxyMessage('[Hello world]')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern [...] in message'
        );
      });

      it('should detect curly braces', () => {
        expect(isPotentialProxyMessage('{Hello world}')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern {...} in message'
        );
      });

      it('should detect angle brackets', () => {
        expect(isPotentialProxyMessage('<Hello world>')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern <...> in message'
        );
      });

      it('should detect parentheses', () => {
        expect(isPotentialProxyMessage('(Hello world)')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern (...) in message'
        );
      });

      it('should detect Japanese quotation marks', () => {
        expect(isPotentialProxyMessage('「Hello world」')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern 「...」 in message'
        );
        
        logger.debug.mockClear();
        expect(isPotentialProxyMessage('『Hello world』')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern 『...』 in message'
        );
      });

      it('should detect quotation marks', () => {
        expect(isPotentialProxyMessage('"Hello world"')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern "..." in message'
        );
      });

      it('should detect apostrophes', () => {
        expect(isPotentialProxyMessage("'Hello world'")).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          "[PluralKitPatterns] Detected bracket pattern '...' in message"
        );
      });

      it('should handle whitespace around brackets', () => {
        expect(isPotentialProxyMessage('  [Hello world]  ')).toBe(true);
        expect(isPotentialProxyMessage('\t{Hello world}\n')).toBe(true);
      });

      it('should not detect mismatched brackets', () => {
        expect(isPotentialProxyMessage('[Hello world}')).toBe(false);
        expect(isPotentialProxyMessage('{Hello world]')).toBe(false);
        expect(isPotentialProxyMessage('<Hello world]')).toBe(false);
      });

      it('should not detect incomplete brackets', () => {
        expect(isPotentialProxyMessage('[Hello world')).toBe(false);
        expect(isPotentialProxyMessage('Hello world]')).toBe(false);
        expect(isPotentialProxyMessage('{Hello world')).toBe(false);
      });
    });

    describe('prefix patterns', () => {
      it('should detect colon prefix', () => {
        expect(isPotentialProxyMessage('Alice: Hello world')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern Alice: in message'
        );
      });

      it('should detect dash prefix', () => {
        expect(isPotentialProxyMessage('Bob- Hello world')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern Bob- in message'
        );
      });

      it('should detect slash prefix', () => {
        expect(isPotentialProxyMessage('Charlie/ Hello world')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern Charlie/ in message'
        );
      });

      it('should detect backslash prefix', () => {
        expect(isPotentialProxyMessage('David\\ Hello world')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern David\\ in message'
        );
      });

      it('should detect various other prefix characters', () => {
        const prefixChars = ['~', '=', '*', '$', '#', '|', '>'];
        
        prefixChars.forEach(char => {
          logger.debug.mockClear();
          expect(isPotentialProxyMessage(`Name${char} Hello world`)).toBe(true);
          expect(logger.debug).toHaveBeenCalledWith(
            `[PluralKitPatterns] Detected potential prefix pattern Name${char} in message`
          );
        });
      });

      it('should only detect prefixes before first space', () => {
        // These actually ARE valid prefix patterns according to the implementation
        expect(isPotentialProxyMessage('Hello: world is nice')).toBe(true);
        expect(isPotentialProxyMessage('Name- This is a message')).toBe(true);
        
        // These should not be detected as they don't have prefix chars before first space
        expect(isPotentialProxyMessage('This is a test without prefix')).toBe(false);
        expect(isPotentialProxyMessage('No prefix here at all')).toBe(false);
      });

      it('should not detect overly long prefixes', () => {
        expect(isPotentialProxyMessage('VeryLongPrefixNameThatIsOverTwentyCharacters: Hello')).toBe(false);
      });

      it('should detect pk; command prefix', () => {
        expect(isPotentialProxyMessage('pk;switch Alice')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected pk; command in message'
        );
        
        logger.debug.mockClear();
        expect(isPotentialProxyMessage('PK;switch Alice')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected pk; command in message'
        );
      });
    });

    describe('command patterns', () => {
      it('should detect pk: pattern', () => {
        expect(isPotentialProxyMessage('pk:info')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected PluralKit command pattern in message'
        );
      });

      it('should detect pk! pattern', () => {
        expect(isPotentialProxyMessage('pk!help')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected PluralKit command pattern in message'
        );
      });

      it('should detect pk; pattern anywhere in message', () => {
        expect(isPotentialProxyMessage('Check out pk;system')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected PluralKit command pattern in message'
        );
      });

      it('should detect system: pattern', () => {
        // Note: These are actually detected as prefix patterns first
        expect(isPotentialProxyMessage('system: Collective thoughts')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern system: in message'
        );
        
        logger.debug.mockClear();
        expect(isPotentialProxyMessage('SYSTEM: Important message')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern SYSTEM: in message'
        );
        
        // Test system: pattern in middle of message (detected as command pattern)
        logger.debug.mockClear();
        expect(isPotentialProxyMessage('Check the system: status')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected PluralKit command pattern in message'
        );
      });

      it('should detect member: pattern', () => {
        // Note: These are actually detected as prefix patterns first
        expect(isPotentialProxyMessage('member: Alice fronting')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern member: in message'
        );
        
        logger.debug.mockClear();
        expect(isPotentialProxyMessage('MEMBER: Bob co-fronting')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected potential prefix pattern MEMBER: in message'
        );
        
        // Test member: pattern in middle of message (detected as command pattern)
        logger.debug.mockClear();
        expect(isPotentialProxyMessage('Current member: status check')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected PluralKit command pattern in message'
        );
      });
    });

    describe('edge cases', () => {
      it('should handle null input', () => {
        expect(isPotentialProxyMessage(null)).toBe(false);
        expect(logger.debug).not.toHaveBeenCalled();
      });

      it('should handle undefined input', () => {
        expect(isPotentialProxyMessage(undefined)).toBe(false);
        expect(logger.debug).not.toHaveBeenCalled();
      });

      it('should handle non-string input', () => {
        expect(isPotentialProxyMessage(123)).toBe(false);
        expect(isPotentialProxyMessage({})).toBe(false);
        expect(isPotentialProxyMessage([])).toBe(false);
        expect(isPotentialProxyMessage(true)).toBe(false);
        expect(logger.debug).not.toHaveBeenCalled();
      });

      it('should handle empty string', () => {
        expect(isPotentialProxyMessage('')).toBe(false);
        expect(isPotentialProxyMessage('   ')).toBe(false);
        expect(isPotentialProxyMessage('\t\n')).toBe(false);
        expect(logger.debug).not.toHaveBeenCalled();
      });

      it('should handle single character messages', () => {
        expect(isPotentialProxyMessage('a')).toBe(false);
        expect(isPotentialProxyMessage('!')).toBe(false);
      });

      it('should handle messages with no pattern', () => {
        expect(isPotentialProxyMessage('Just a normal message')).toBe(false);
        expect(isPotentialProxyMessage('Hello world!')).toBe(false);
        expect(isPotentialProxyMessage('No patterns here.')).toBe(false);
        expect(logger.debug).not.toHaveBeenCalled();
      });
    });

    describe('complex messages', () => {
      it('should detect patterns in longer messages', () => {
        expect(isPotentialProxyMessage('[This is a longer message with multiple words]')).toBe(true);
        expect(isPotentialProxyMessage('Alice: Hey everyone, how are you doing today?')).toBe(true);
      });

      it('should handle messages with multiple potential patterns', () => {
        // Should detect the bracket pattern first
        expect(isPotentialProxyMessage('[Alice: Hello]')).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(
          '[PluralKitPatterns] Detected bracket pattern [...] in message'
        );
      });

      it('should handle messages with special characters', () => {
        expect(isPotentialProxyMessage('[Hello! How are you?]')).toBe(true);
        expect(isPotentialProxyMessage('Alice: Hello @ everyone!')).toBe(true);
        expect(isPotentialProxyMessage('{Message with émojis 🎉}')).toBe(true);
      });

      it('should handle multiline messages', () => {
        expect(isPotentialProxyMessage('[Hello\nWorld]')).toBe(true);
        expect(isPotentialProxyMessage('Alice: Line 1\nLine 2')).toBe(true);
      });
    });
  });

  describe('getProxyDelayTime', () => {
    it('should return a consistent delay time', () => {
      const delay = getProxyDelayTime();
      
      expect(typeof delay).toBe('number');
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBe(2000); // Should be 2 seconds as per implementation
    });

    it('should return the same value on multiple calls', () => {
      const delay1 = getProxyDelayTime();
      const delay2 = getProxyDelayTime();
      const delay3 = getProxyDelayTime();
      
      expect(delay1).toBe(delay2);
      expect(delay2).toBe(delay3);
    });
  });
});