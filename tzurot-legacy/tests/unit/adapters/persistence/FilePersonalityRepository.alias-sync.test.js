/**
 * @jest-environment node
 * @testType adapter
 *
 * Tests for alias synchronization in FilePersonalityRepository
 */

// Unmock FilePersonalityRepository since it's mocked globally in setup.js
jest.unmock('../../../../src/adapters/persistence/FilePersonalityRepository');

// Mock fs module before any imports
const mockFsPromises = {
  mkdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
};

jest.mock('fs', () => ({
  promises: mockFsPromises,
}));

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const {
  FilePersonalityRepository,
} = require('../../../../src/adapters/persistence/FilePersonalityRepository');

const {
  Personality,
  PersonalityId,
  PersonalityProfile,
  Alias,
  UserId,
} = require('../../../../src/domain/personality');
const { AIModel } = require('../../../../src/domain/ai');
const logger = require('../../../../src/logger');

describe('FilePersonalityRepository - Alias Synchronization', () => {
  let repository;
  let mockFileData;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default mock file data
    mockFileData = {
      personalities: {
        'test-personality-1': {
          id: 'test-personality-1',
          ownerId: '123456789012345678',
          profile: {
            displayName: 'Test 1',
            name: 'test-1',
          },
          aliases: [
            { value: 'test1', originalCase: 'test1' },
            { value: 'testy1', originalCase: 'testy1' }
          ],
          savedAt: '2024-01-01T00:00:00.000Z',
        },
        'test-personality-2': {
          id: 'test-personality-2',
          ownerId: '123456789012345678',
          profile: {
            displayName: 'Test 2',
            name: 'test-2',
          },
          aliases: [
            { value: 'test2', originalCase: 'test2' }
          ],
          savedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      aliases: {
        test1: 'test-personality-1',
        testy1: 'test-personality-1',
        test2: 'test-personality-2',
      },
    };

    // Set up default return values
    mockFsPromises.mkdir.mockResolvedValue(undefined);
    mockFsPromises.readFile.mockResolvedValue(JSON.stringify(mockFileData));
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockFsPromises.rename.mockResolvedValue(undefined);

    repository = new FilePersonalityRepository('test-data');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('alias synchronization on save', () => {
    it('should remove old aliases when personality aliases are updated', async () => {
      await repository.initialize();

      // Create a personality with initial aliases
      const personality = Personality.create(
        PersonalityId.fromString('test-personality-1'),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'external',
          name: 'test-1',
          displayName: 'Test 1',
        }),
        AIModel.createDefault()
      );
      
      // Add only one alias (removing 'testy1')
      personality.addAlias(new Alias('test1'));
      
      await repository.save(personality);

      // Check that the file was written with updated aliases
      const lastWriteCall = mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
      const writtenData = JSON.parse(lastWriteCall[1]);

      // Global aliases should only have 'test1' for this personality
      expect(writtenData.aliases.test1).toBe('test-personality-1');
      expect(writtenData.aliases.testy1).toBeUndefined(); // Should be removed
      expect(writtenData.aliases.test2).toBe('test-personality-2'); // Other personality's alias unchanged
    });

    it('should add new aliases to global mapping', async () => {
      await repository.initialize();

      const personality = Personality.create(
        PersonalityId.fromString('test-personality-1'),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'external',
          name: 'test-1',
          displayName: 'Test 1',
        }),
        AIModel.createDefault()
      );
      
      // Add existing and new aliases
      personality.addAlias(new Alias('test1'));
      personality.addAlias(new Alias('testy1'));
      personality.addAlias(new Alias('newalias'));
      
      await repository.save(personality);

      const lastWriteCall = mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
      const writtenData = JSON.parse(lastWriteCall[1]);

      expect(writtenData.aliases.test1).toBe('test-personality-1');
      expect(writtenData.aliases.testy1).toBe('test-personality-1');
      expect(writtenData.aliases.newalias).toBe('test-personality-1');
    });

    it('should not overwrite aliases pointing to other personalities', async () => {
      await repository.initialize();

      const personality = Personality.create(
        PersonalityId.fromString('test-personality-1'),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'external',
          name: 'test-1',
          displayName: 'Test 1',
        }),
        AIModel.createDefault()
      );
      
      // Try to add an alias that belongs to another personality
      personality.addAlias(new Alias('test1'));
      personality.addAlias(new Alias('test2')); // This belongs to test-personality-2
      
      await repository.save(personality);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Alias "test2" already points to test-personality-2')
      );

      const lastWriteCall = mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
      const writtenData = JSON.parse(lastWriteCall[1]);

      // test2 should still point to test-personality-2
      expect(writtenData.aliases.test2).toBe('test-personality-2');
    });

    it('should handle personalities with no aliases', async () => {
      await repository.initialize();

      const personality = Personality.create(
        PersonalityId.fromString('test-personality-3'),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'external',
          name: 'test-3',
          displayName: 'Test 3',
        }),
        AIModel.createDefault()
      );
      
      // Don't add any aliases
      
      await repository.save(personality);

      const lastWriteCall = mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
      const writtenData = JSON.parse(lastWriteCall[1]);

      // Should not affect other aliases
      expect(writtenData.aliases.test1).toBe('test-personality-1');
      expect(writtenData.aliases.test2).toBe('test-personality-2');
      expect(Object.keys(writtenData.aliases)).toHaveLength(3); // Original 3 aliases
    });

    it('should clean up all aliases when personality is updated to have none', async () => {
      await repository.initialize();

      const personality = Personality.create(
        PersonalityId.fromString('test-personality-1'),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'external',
          name: 'test-1',
          displayName: 'Test 1',
        }),
        AIModel.createDefault()
      );
      
      // Don't add any aliases (removing all)
      
      await repository.save(personality);

      const lastWriteCall = mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
      const writtenData = JSON.parse(lastWriteCall[1]);

      // All aliases for test-personality-1 should be removed
      expect(writtenData.aliases.test1).toBeUndefined();
      expect(writtenData.aliases.testy1).toBeUndefined();
      // But test-personality-2's alias should remain
      expect(writtenData.aliases.test2).toBe('test-personality-2');
    });
  });

  describe('findByNameOrAlias with synchronized data', () => {
    it('should find personality by global alias', async () => {
      await repository.initialize();

      const result = await repository.findByNameOrAlias('test1');
      
      expect(result).toBeDefined();
      expect(result.personalityId.value).toBe('test-personality-1');
    });

    it('should respect global alias over display name', async () => {
      // Create data where display name could match but global alias should win
      mockFileData = {
        personalities: {
          'personality-a': {
            id: 'personality-a',
            ownerId: '123456789012345678',
            profile: {
              displayName: 'TestAlias', // Display name that matches an alias
              name: 'personality-a',
            },
            aliases: [],
          },
          'personality-b': {
            id: 'personality-b',
            ownerId: '123456789012345678',
            profile: {
              displayName: 'Personality B',
              name: 'personality-b',
            },
            aliases: [{ value: 'testalias' }],
          },
        },
        aliases: {
          testalias: 'personality-b', // Global alias points to personality-b
        },
      };
      
      mockFsPromises.readFile.mockResolvedValue(JSON.stringify(mockFileData));
      const repo = new FilePersonalityRepository();
      await repo.initialize();

      const result = await repo.findByNameOrAlias('testalias');
      
      expect(result).toBeDefined();
      expect(result.personalityId.value).toBe('personality-b'); // Should find by global alias, not display name
    });
  });
});