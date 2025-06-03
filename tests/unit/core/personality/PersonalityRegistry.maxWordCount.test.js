/**
 * Unit tests for PersonalityRegistry max word count tracking
 */

const PersonalityRegistry = require('../../../../src/core/personality/PersonalityRegistry');
const logger = require('../../../../src/logger');

jest.mock('../../../../src/logger');

describe('PersonalityRegistry - Max Word Count Tracking', () => {
  let registry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new PersonalityRegistry();
  });

  describe('maxAliasWordCount getter', () => {
    it('should return 1 by default when no aliases exist', () => {
      expect(registry.maxAliasWordCount).toBe(1);
    });

    it('should calculate max word count on first access if not set', () => {
      // Add some test data
      registry.personalities.set('test-1', { fullName: 'test-1' });
      registry.aliases.set('single', 'test-1');
      registry.aliases.set('two words', 'test-1');
      
      // Clear the internal value to trigger lazy calculation
      registry._maxAliasWordCount = null;

      const result = registry.maxAliasWordCount;

      expect(result).toBe(2);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Max alias word count not initialized, calculating...')
      );
    });

    it('should not recalculate if value already exists', () => {
      registry._maxAliasWordCount = 3;

      const result = registry.maxAliasWordCount;

      expect(result).toBe(3);
      // Should not log about recalculation
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Max alias word count not initialized')
      );
    });
  });

  describe('setAlias with word count tracking', () => {
    beforeEach(() => {
      registry.personalities.set('test-personality', { fullName: 'test-personality' });
    });

    it('should update max word count when adding longer alias', () => {
      registry.setAlias('single', 'test-personality');
      expect(registry.maxAliasWordCount).toBe(1);

      registry.setAlias('two words', 'test-personality');
      expect(registry.maxAliasWordCount).toBe(2);

      registry.setAlias('three word alias', 'test-personality');
      expect(registry.maxAliasWordCount).toBe(3);
    });

    it('should not update max when adding shorter alias', () => {
      registry.setAlias('three word alias', 'test-personality');
      expect(registry.maxAliasWordCount).toBe(3);

      registry.setAlias('short', 'test-personality');
      expect(registry.maxAliasWordCount).toBe(3); // Should remain 3
    });

    it('should handle aliases with extra spaces correctly', () => {
      registry.setAlias('  spaced   out   alias  ', 'test-personality');
      expect(registry.maxAliasWordCount).toBe(3); // Should count as 3 words
    });

    it('should log when new max is set', () => {
      registry.setAlias('five word alias is long', 'test-personality');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('New max alias word count: 5')
      );
    });
  });

  describe('removeAlias with word count tracking', () => {
    beforeEach(() => {
      registry.personalities.set('test-1', { fullName: 'test-1' });
      registry.personalities.set('test-2', { fullName: 'test-2' });
    });

    it('should recalculate max when removing alias with max word count', () => {
      registry.setAlias('single', 'test-1');
      registry.setAlias('two words', 'test-1');
      registry.setAlias('three word alias', 'test-2');
      expect(registry.maxAliasWordCount).toBe(3);

      // Remove the 3-word alias
      registry.removeAlias('three word alias');

      expect(registry.maxAliasWordCount).toBe(2); // Should recalculate to 2
    });

    it('should not recalculate when removing shorter alias', () => {
      registry.setAlias('single', 'test-1');
      registry.setAlias('four word alias here', 'test-2');
      expect(registry.maxAliasWordCount).toBe(4);

      // Remove the single word alias
      registry.removeAlias('single');

      expect(registry.maxAliasWordCount).toBe(4); // Should remain 4
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Updated max alias word count')
      );
    });

    it('should handle removing non-existent alias gracefully', () => {
      registry.setAlias('test', 'test-1');
      const maxBefore = registry.maxAliasWordCount;

      const result = registry.removeAlias('non-existent');

      expect(result).toBe(false);
      expect(registry.maxAliasWordCount).toBe(maxBefore);
    });
  });

  describe('remove personality with word count tracking', () => {
    it('should recalculate max when removing personality with longest alias', () => {
      registry.personalities.set('test-1', { fullName: 'test-1' });
      registry.personalities.set('test-2', { fullName: 'test-2' });
      
      registry.setAlias('short', 'test-1');
      registry.setAlias('medium alias', 'test-1');
      registry.setAlias('very long alias name', 'test-2');
      expect(registry.maxAliasWordCount).toBe(4);

      // Remove personality with the longest alias
      registry.remove('test-2');

      expect(registry.maxAliasWordCount).toBe(2); // Should recalculate to 2
    });

    it('should not recalculate when removing personality with shorter aliases', () => {
      registry.personalities.set('test-1', { fullName: 'test-1' });
      registry.personalities.set('test-2', { fullName: 'test-2' });
      
      registry.setAlias('short', 'test-1');
      registry.setAlias('very long alias name', 'test-2');
      expect(registry.maxAliasWordCount).toBe(4);

      // Remove personality with shorter alias
      registry.remove('test-1');

      expect(registry.maxAliasWordCount).toBe(4); // Should remain 4
    });
  });

  describe('loadFromObjects with word count tracking', () => {
    it('should calculate max word count when loading data', () => {
      const personalities = {
        'test-1': { fullName: 'test-1', addedBy: 'user1' },
        'test-2': { fullName: 'test-2', addedBy: 'user2' }
      };
      
      const aliases = {
        'single': 'test-1',
        'two words': 'test-1',
        'three word alias': 'test-2',
        'another single': 'test-2'
      };

      registry.loadFromObjects(personalities, aliases);

      expect(registry.maxAliasWordCount).toBe(3);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('(max 3 words)')
      );
    });

    it('should handle empty aliases gracefully', () => {
      const personalities = {
        'test-1': { fullName: 'test-1', addedBy: 'user1' }
      };

      registry.loadFromObjects(personalities, {});

      expect(registry.maxAliasWordCount).toBe(1); // Default
    });

    it('should skip invalid aliases during load', () => {
      const personalities = {
        'test-1': { fullName: 'test-1', addedBy: 'user1' }
      };
      
      const aliases = {
        'valid alias': 'test-1',
        'invalid alias': 'non-existent-personality',
        'another valid': 'test-1'
      };

      registry.loadFromObjects(personalities, aliases);

      expect(registry.aliases.size).toBe(2); // Only valid aliases loaded
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping alias invalid alias')
      );
    });
  });

  describe('clear with word count reset', () => {
    it('should reset max word count when clearing registry', () => {
      registry.personalities.set('test', { fullName: 'test' });
      registry.setAlias('multi word alias', 'test');
      expect(registry.maxAliasWordCount).toBe(3);

      registry.clear();

      // Should trigger lazy recalculation on next access
      // Note: We test the public API behavior, not the internal state
      expect(registry.maxAliasWordCount).toBe(1); // Default after clear
    });
  });

  describe('updateMaxWordCount', () => {
    beforeEach(() => {
      registry.personalities.set('test-1', { fullName: 'test-1' });
      registry.personalities.set('test-2', { fullName: 'test-2' });
    });

    it('should correctly identify all multi-word aliases', () => {
      registry.aliases.set('single', 'test-1');
      registry.aliases.set('two words', 'test-1');
      registry.aliases.set('another two', 'test-2');
      registry.aliases.set('three word alias', 'test-2');

      registry.updateMaxWordCount();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Multi-word aliases found: "two words" (2 words), "another two" (2 words), "three word alias" (3 words)')
      );
    });

    it('should log when no multi-word aliases exist', () => {
      registry.aliases.set('single', 'test-1');
      registry.aliases.set('another', 'test-2');

      registry.updateMaxWordCount();

      expect(logger.debug).toHaveBeenCalledWith(
        '[PersonalityRegistry] No multi-word aliases found in the system'
      );
    });
  });

  describe('getWordCount', () => {
    it('should count words correctly', () => {
      expect(registry.getWordCount('single')).toBe(1);
      expect(registry.getWordCount('two words')).toBe(2);
      expect(registry.getWordCount('three word alias')).toBe(3);
    });

    it('should handle extra spaces', () => {
      expect(registry.getWordCount('  extra   spaces  ')).toBe(2);
      expect(registry.getWordCount('   ')).toBe(0);
    });

    it('should handle empty strings', () => {
      expect(registry.getWordCount('')).toBe(0);
    });
  });
});