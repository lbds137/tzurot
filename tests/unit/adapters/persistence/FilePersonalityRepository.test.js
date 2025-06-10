/**
 * @jest-environment node
 * @testType adapter
 * 
 * FilePersonalityRepository Adapter Test
 * - Tests file system persistence adapter for personalities
 * - Mocks external dependencies (fs, logger)
 * - Domain models are NOT mocked (real integration)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Mock external dependencies first
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn()
  }
}));

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const fs = require('fs').promises;
const path = require('path');

// Adapter under test - NOT mocked!
const { FilePersonalityRepository } = require('../../../../src/adapters/persistence/FilePersonalityRepository');

// Domain models - NOT mocked! We want real domain logic
const { 
  Personality, 
  PersonalityId, 
  PersonalityProfile, 
  Alias, 
  UserId 
} = require('../../../../src/domain/personality');
const { AIModel } = require('../../../../src/domain/ai');

describe('FilePersonalityRepository', () => {
  let repository;
  let mockFileData;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    
    // Default mock file data
    mockFileData = {
      personalities: {
        'test-personality': {
          id: 'test-personality',
          ownerId: '123456789012345678',
          profile: {
            displayName: 'Test Personality',
            avatarUrl: 'https://example.com/avatar.png',
            bio: 'Test bio',
            systemPrompt: 'Test prompt',
            temperature: 0.7,
            maxTokens: 1000
          },
          aliases: ['test', 'testy'],
          savedAt: '2024-01-01T00:00:00.000Z'
        }
      },
      aliases: {
        'test': 'test-personality',
        'testy': 'test-personality'
      }
    };
    
    // Mock fs methods with test data
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));
    fs.writeFile.mockResolvedValue();
    fs.rename.mockResolvedValue();
    
    // Create repository with injectable dependencies
    repository = new FilePersonalityRepository({
      dataPath: './test-data',
      filename: 'test-personalities.json',
    });
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });
  
  describe('initialize', () => {
    it('should create data directory if it does not exist', async () => {
      await repository.initialize();
      
      expect(fs.mkdir).toHaveBeenCalledWith('./test-data', { recursive: true });
    });
    
    it('should load existing data file', async () => {
      await repository.initialize();
      
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join('./test-data', 'test-personalities.json'),
        'utf8'
      );
      // Verify behavior - findById should work after initialization
      const personality = await repository.findById(new PersonalityId('test-personality'));
      expect(personality).not.toBeNull();
      expect(personality.personalityId.value).toBe('test-personality');
    });
    
    it('should create new file if it does not exist', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });
      
      await repository.initialize();
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('./test-data', 'test-personalities.json.tmp'),
        JSON.stringify({ personalities: {}, aliases: {} }, null, 2),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalled();
      // Verify behavior - should return empty results
      const personalities = await repository.findAll();
      expect(personalities).toEqual([]);
    });
    
    it('should throw error for other file read errors', async () => {
      fs.readFile.mockRejectedValue(new Error('Permission denied'));
      
      await expect(repository.initialize()).rejects.toThrow(
        'Failed to initialize repository: Permission denied'
      );
    });
    
    it('should not reinitialize if already initialized', async () => {
      await repository.initialize();
      fs.readFile.mockClear();
      
      await repository.initialize();
      
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });
  
  describe('save', () => {
    it('should save a personality', async () => {
      await repository.initialize();
      
      // Create real domain objects
      const profile = new PersonalityProfile(
        'New Personality',
        'You are a helpful assistant named New Personality',
        '/default',
        1500
      );
      const model = AIModel.createDefault();
      const personality = Personality.create(
        new PersonalityId('new-personality'),
        new UserId('456789012345678901'),
        profile,
        model
      );
      
      // Add alias using the domain method
      personality.addAlias(new Alias('newbie'));
      
      await repository.save(personality);
      
      // Verify behavior - personality can be retrieved
      const saved = await repository.findById(new PersonalityId('new-personality'));
      expect(saved).not.toBeNull();
      expect(saved.profile.displayName).toBe('New Personality');
      const byAlias = await repository.findByAlias('newbie');
      expect(byAlias).not.toBeNull();
      expect(byAlias.personalityId.value).toBe('new-personality');
      
      // Verify file written
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.stringContaining('new-personality'),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalled();
    });
    
    it('should update existing personality', async () => {
      await repository.initialize();
      
      // Fetch and update real domain object
      const existingPersonality = await repository.findById(new PersonalityId('test-personality'));
      existingPersonality.updateProfile({
        prompt: 'Updated prompt for test personality'
      });
      
      await repository.save(existingPersonality);
      
      // Verify behavior - updated personality can be retrieved
      const updated = await repository.findById(new PersonalityId('test-personality'));
      expect(updated.profile.prompt).toContain('Updated prompt');
    });
    
    it('should handle save errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Disk full'));
      
      const profile = new PersonalityProfile(
        'new-personality',
        'You are a helpful assistant',
        '/default',
        1000
      );
      const model = AIModel.createDefault();
      const personality = Personality.create(
        new PersonalityId('new-personality'),
        new UserId('456789012345678901'),
        profile,
        model
      );
      
      await expect(repository.save(personality)).rejects.toThrow(
        'Failed to save personality: Failed to persist data: Disk full'
      );
    });
    
    it('should initialize if not already initialized', async () => {
      const profile = new PersonalityProfile(
        'new-personality',
        'You are a helpful assistant',
        '/default',
        1000
      );
      const model = AIModel.createDefault();
      const personality = Personality.create(
        new PersonalityId('new-personality'),
        new UserId('456789012345678901'),
        profile,
        model
      );
      
      await repository.save(personality);
      
      expect(fs.mkdir).toHaveBeenCalled();
      // Verify behavior - personality was saved
      const saved = await repository.findById(new PersonalityId('new-personality'));
      expect(saved).not.toBeNull();
    });
  });
  
  describe('findById', () => {
    it('should find personality by ID', async () => {
      await repository.initialize();
      
      const result = await repository.findById(new PersonalityId('test-personality'));
      
      // Verify returns real domain object
      expect(result).toBeInstanceOf(Personality);
      expect(result.personalityId.value).toBe('test-personality');
      expect(result.ownerId.value).toBe('123456789012345678');
      expect(result.profile.displayName).toBe('Test Personality');
      expect(result.aliases).toHaveLength(2);
    });
    
    it('should return null if personality not found', async () => {
      await repository.initialize();
      
      const result = await repository.findById(new PersonalityId('non-existent'));
      
      expect(result).toBeNull();
    });
    
    it('should handle errors during hydration', async () => {
      // Mock corrupt file data
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        personalities: {
          'test-personality': mockFileData.personalities['test-personality'],
          'bad-data': { invalid: 'data' }
        },
        aliases: mockFileData.aliases
      }));
      // Reinitialize to load corrupt data
      repository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'test-personalities.json',
      });
      await repository.initialize();
      
      await expect(repository.findById(new PersonalityId('bad-data'))).rejects.toThrow(
        'Failed to find personality'
      );
    });
  });
  
  describe('findByOwner', () => {
    it('should find all personalities by owner', async () => {
      await repository.initialize();
      
      // Add another personality for the same owner using proper save method
      const profile2 = new PersonalityProfile('Test 2', 'You are Test 2', '/default', 1000);
      const model2 = AIModel.createDefault();
      const personality2 = Personality.create(
        new PersonalityId('test-personality-2'),
        new UserId('123456789012345678'),
        profile2,
        model2
      );
      await repository.save(personality2);
      
      const results = await repository.findByOwner(new UserId('123456789012345678'));
      
      // Verify returns real domain objects
      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(Personality);
      expect(results[1]).toBeInstanceOf(Personality);
      expect(results.map(p => p.personalityId.value)).toEqual(['test-personality', 'test-personality-2']);
    });
    
    it('should return empty array if no personalities found', async () => {
      await repository.initialize();
      
      const results = await repository.findByOwner(new UserId('999999999999999999'));
      
      expect(results).toEqual([]);
    });
    
    it('should handle errors during hydration', async () => {
      // Mock corrupt file data
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        personalities: {
          'test-personality': mockFileData.personalities['test-personality'],
          'bad-data': { ownerId: '123456789012345678', invalid: 'data' }
        },
        aliases: mockFileData.aliases
      }));
      // Reinitialize to load corrupt data
      repository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'test-personalities.json',
      });
      await repository.initialize();
      
      await expect(repository.findByOwner(new UserId('123456789012345678'))).rejects.toThrow(
        'Failed to find personalities by owner'
      );
    });
  });
  
  describe('findByAlias', () => {
    it('should find personality by alias', async () => {
      await repository.initialize();
      
      const result = await repository.findByAlias('test');
      
      expect(result).toBeInstanceOf(Personality);
      expect(result.personalityId.value).toBe('test-personality');
    });
    
    it('should find personality by alias case-insensitive', async () => {
      await repository.initialize();
      
      const result = await repository.findByAlias('TEST');
      
      expect(result).toBeInstanceOf(Personality);
      expect(result.personalityId.value).toBe('test-personality');
    });
    
    it('should return null if alias not found', async () => {
      await repository.initialize();
      
      const result = await repository.findByAlias('non-existent');
      
      expect(result).toBeNull();
    });
    
    it('should clean up orphaned alias and return null', async () => {
      // Mock file with orphaned alias
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        personalities: mockFileData.personalities,
        aliases: {
          ...mockFileData.aliases,
          'orphan': 'non-existent-personality'
        }
      }));
      // Reinitialize to load data with orphan
      repository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'test-personalities.json',
      });
      await repository.initialize();
      
      const result = await repository.findByAlias('orphan');
      
      expect(result).toBeNull();
      // Verify behavior - orphan cleaned up in subsequent finds
      const againResult = await repository.findByAlias('orphan');
      expect(againResult).toBeNull();
      expect(fs.writeFile).toHaveBeenCalled();
    });
    
    it('should handle errors during hydration', async () => {
      // Mock corrupt file data with bad alias
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        personalities: {
          'bad-data': { invalid: 'data' }
        },
        aliases: {
          'bad': 'bad-data'
        }
      }));
      // Reinitialize to load corrupt data
      repository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'test-personalities.json',
      });
      await repository.initialize();
      
      await expect(repository.findByAlias('bad')).rejects.toThrow(
        'Failed to find personality by alias'
      );
    });
  });
  
  describe('findAll', () => {
    it('should return all personalities', async () => {
      await repository.initialize();
      
      // Add more personalities using proper save method
      const profile2 = new PersonalityProfile('Test 2', 'You are Test 2', '/default', 1000);
      const personality2 = Personality.create(
        new PersonalityId('test-2'),
        new UserId('456789012345678901'),
        profile2,
        AIModel.createDefault()
      );
      await repository.save(personality2);
      
      const profile3 = new PersonalityProfile('Test 3', 'You are Test 3', '/default', 1000);
      const personality3 = Personality.create(
        new PersonalityId('test-3'),
        new UserId('789012345678901234'),
        profile3,
        AIModel.createDefault()
      );
      await repository.save(personality3);
      
      const results = await repository.findAll();
      
      expect(results).toHaveLength(3);
      expect(results.every(p => p instanceof Personality)).toBe(true);
      expect(results.map(p => p.personalityId.value)).toEqual(['test-personality', 'test-2', 'test-3']);
    });
    
    it('should return empty array if no personalities', async () => {
      // Create a new repository instance with empty data
      const emptyRepository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'empty-personalities.json',
      });
      
      // Mock empty file content for this specific test
      fs.readFile.mockResolvedValueOnce(JSON.stringify({ personalities: {}, aliases: {} }));
      
      await emptyRepository.initialize();
      
      const results = await emptyRepository.findAll();
      
      expect(results).toEqual([]);
    });
    
    it('should handle errors during hydration', async () => {
      // Mock corrupt file data
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        personalities: {
          'test-personality': mockFileData.personalities['test-personality'],
          'bad-data': { invalid: 'data' }
        },
        aliases: mockFileData.aliases
      }));
      // Reinitialize to load corrupt data
      repository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'test-personalities.json',
      });
      await repository.initialize();
      
      await expect(repository.findAll()).rejects.toThrow(
        'Failed to find all personalities'
      );
    });
  });
  
  describe('delete', () => {
    it('should delete a personality and its aliases', async () => {
      await repository.initialize();
      
      await repository.delete(new PersonalityId('test-personality'));
      
      // Verify behavior - personality and aliases no longer found
      const personality = await repository.findById(new PersonalityId('test-personality'));
      expect(personality).toBeNull();
      const byAlias1 = await repository.findByAlias('test');
      expect(byAlias1).toBeNull();
      const byAlias2 = await repository.findByAlias('testy');
      expect(byAlias2).toBeNull();
      expect(fs.writeFile).toHaveBeenCalled();
    });
    
    it('should handle deleting non-existent personality', async () => {
      await repository.initialize();
      
      await repository.delete(new PersonalityId('non-existent'));
      
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
    
    it('should handle delete errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Permission denied'));
      
      await expect(repository.delete(new PersonalityId('test-personality'))).rejects.toThrow(
        'Failed to delete personality'
      );
    });
  });
  
  describe('exists', () => {
    it('should return true if personality exists', async () => {
      await repository.initialize();
      
      const result = await repository.exists(new PersonalityId('test-personality'));
      
      expect(result).toBe(true);
    });
    
    it('should return false if personality does not exist', async () => {
      await repository.initialize();
      
      const result = await repository.exists(new PersonalityId('non-existent'));
      
      expect(result).toBe(false);
    });
  });
  
  describe('createBackup', () => {
    it('should create backup file with timestamp', async () => {
      await repository.initialize();
      const mockDate = new Date('2024-01-15T10:30:45.123Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);
      
      const backupPath = await repository.createBackup();
      
      expect(backupPath).toBe(path.join('./test-data', 'personalities-backup-2024-01-15T10-30-45-123Z.json'));
      expect(fs.writeFile).toHaveBeenCalledWith(
        backupPath,
        JSON.stringify(mockFileData, null, 2),
        'utf8'
      );
    });
    
    it('should handle backup errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('No space left'));
      
      await expect(repository.createBackup()).rejects.toThrow(
        'Failed to create backup: No space left'
      );
    });
  });
  
  describe('getStats', () => {
    it('should return repository statistics', async () => {
      await repository.initialize();
      
      // Add more data using proper save method
      const profile2 = new PersonalityProfile('Test 2', 'You are Test 2', '/default', 1000);
      const personality2 = Personality.create(
        new PersonalityId('test-2'),
        new UserId('123456789012345678'),
        profile2,
        AIModel.createDefault()
      );
      personality2.addAlias(new Alias('test2'));
      await repository.save(personality2);
      
      const profile3 = new PersonalityProfile('Test 3', 'You are Test 3', '/default', 1000);
      const personality3 = Personality.create(
        new PersonalityId('test-3'),
        new UserId('456789012345678901'),
        profile3,
        AIModel.createDefault()
      );
      await repository.save(personality3);
      
      const stats = await repository.getStats();
      
      expect(stats).toEqual({
        totalPersonalities: 3,
        totalAliases: 3,
        owners: 2,
      });
    });
    
    it('should return zero stats for empty repository', async () => {
      // Mock empty file content
      fs.readFile.mockResolvedValue(JSON.stringify({ personalities: {}, aliases: {} }));
      
      await repository.initialize();
      
      const stats = await repository.getStats();
      
      expect(stats).toEqual({
        totalPersonalities: 0,
        totalAliases: 0,
        owners: 0,
      });
    });
  });
  
  describe('hydration behavior', () => {
    it('should handle aliases as strings', async () => {
      // Test by saving and retrieving
      const profile = new PersonalityProfile('test-id', 'You are test-id', '/default', 1000);
      const personality = Personality.create(
        new PersonalityId('test-id'),
        new UserId('123456789012345678'),
        profile,
        AIModel.createDefault()
      );
      personality.addAlias(new Alias('alias1'));
      personality.addAlias(new Alias('alias2'));
      await repository.save(personality);
      
      const retrieved = await repository.findById(new PersonalityId('test-id'));
      
      expect(retrieved.aliases).toHaveLength(2);
      expect(retrieved.aliases[0].value).toBe('alias1');
      expect(retrieved.aliases[1].value).toBe('alias2');
    });
    
    it('should handle aliases as objects', async () => {
      // Test by mocking file data with object aliases
      const data = {
        id: 'test-id',
        ownerId: '123456789012345678',
        aliases: [{ value: 'alias1' }, { value: 'alias2' }],
      };
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        personalities: {
          'test-id': data
        },
        aliases: {}
      }));
      // Reinitialize to load data
      repository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'test-personalities.json',
      });
      await repository.initialize();
      const personality = await repository.findById(new PersonalityId('test-id'));
      
      expect(personality.aliases).toHaveLength(2);
      expect(personality.aliases[0].value).toBe('alias1');
      expect(personality.aliases[1].value).toBe('alias2');
    });
    
    it('should handle missing profile', async () => {
      // Test by mocking minimal file data
      const data = {
        id: 'test-id',
        ownerId: '123456789012345678',
        aliases: [],
      };
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        personalities: {
          'test-id': data
        },
        aliases: {}
      }));
      // Reinitialize to load data
      repository = new FilePersonalityRepository({
        dataPath: './test-data',
        filename: 'test-personalities.json',
      });
      await repository.initialize();
      const personality = await repository.findById(new PersonalityId('test-id'));
      
      // When created, personality gets a default profile
      expect(personality.profile).not.toBeNull();
      // Check that the profile has default values
      expect(personality.profile.name).toBe('test-id');
      expect(personality.profile.prompt).toBe('You are test-id');
      expect(personality.profile.modelPath).toBe('/default');
      expect(personality.profile.maxWordCount).toBe(1000);
    });
    
    it('should mark events as committed', async () => {
      // Test by saving minimal personality
      const profile = new PersonalityProfile('test-id', 'You are test-id', '/default', 1000);
      const personality = Personality.create(
        new PersonalityId('test-id'),
        new UserId('123456789012345678'),
        profile,
        AIModel.createDefault()
      );
      await repository.save(personality);
      
      const retrieved = await repository.findById(new PersonalityId('test-id'));
      
      expect(retrieved.getUncommittedEvents()).toHaveLength(0);
    });
  });
  
  describe('persistence behavior', () => {
    it('should write to temp file then rename', async () => {
      await repository.initialize();
      // Add personality to trigger persist
      const profile = new PersonalityProfile('New', 'You are New', '/default', 1000);
      const personality = Personality.create(
        new PersonalityId('new'),
        new UserId('123456789012345678'),
        profile,
        AIModel.createDefault()
      );
      await repository.save(personality);
      
      const expectedPath = path.join('./test-data', 'test-personalities.json');
      const tempPath = expectedPath + '.tmp';
      
      // Save operation should trigger persist
      const persistedPersonality = await repository.findById(new PersonalityId('new'));
      expect(persistedPersonality).not.toBeNull();
      expect(fs.writeFile).toHaveBeenCalledWith(
        tempPath,
        expect.any(String),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalledWith(tempPath, expectedPath);
    });
    
    it('should format JSON with indentation', async () => {
      await repository.initialize();
      
      // Any save triggers persist
      const profile = new PersonalityProfile('New', 'You are New', '/default', 1000);
      const personality = Personality.create(
        new PersonalityId('new-2'),
        new UserId('123456789012345678'),
        profile,
        AIModel.createDefault()
      );
      await repository.save(personality);
      
      const writtenData = fs.writeFile.mock.calls[0][1];
      expect(writtenData).toContain('  '); // Check for indentation
      expect(() => JSON.parse(writtenData)).not.toThrow();
    });
    
    it('should throw specific error on failure', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('EACCES'));
      
      // Try to save to trigger persist
      const profile = new PersonalityProfile('New', 'You are New', '/default', 1000);
      const personality = Personality.create(
        new PersonalityId('new'),
        new UserId('123456789012345678'),
        profile,
        AIModel.createDefault()
      );
      await expect(repository.save(personality)).rejects.toThrow('Failed to save personality');
    });
  });
});