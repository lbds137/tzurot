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
      expect(repository._cache).toEqual(mockFileData);
      expect(repository._initialized).toBe(true);
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
      expect(repository._cache).toEqual({ personalities: {}, aliases: {} });
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
      const personality = Personality.create(
        new PersonalityId('new-personality'),
        new UserId('456789012345678901')
      );
      
      const profile = new PersonalityProfile({
        displayName: 'New Personality',
        avatarUrl: 'https://example.com/new.png',
        bio: 'New bio',
        systemPrompt: 'New prompt',
        temperature: 0.8,
        maxTokens: 1500,
      });
      personality.updateProfile(profile);
      
      // For now, we'll set aliases directly since the domain model doesn't have addAlias yet
      personality.aliases = [new Alias('newbie')];
      
      await repository.save(personality);
      
      // Verify cache updated
      expect(repository._cache.personalities['new-personality']).toBeDefined();
      expect(repository._cache.personalities['new-personality'].profile.displayName).toBe('New Personality');
      expect(repository._cache.aliases['newbie']).toBe('new-personality');
      
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
      existingPersonality.updateProfile(new PersonalityProfile({
        displayName: 'Updated Name',
        avatarUrl: 'https://example.com/updated.png',
      }));
      
      await repository.save(existingPersonality);
      
      expect(repository._cache.personalities['test-personality'].profile.displayName).toBe('Updated Name');
    });
    
    it('should handle save errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Disk full'));
      
      const personality = Personality.create(
        new PersonalityId('new-personality'),
        new UserId('456789012345678901')
      );
      
      await expect(repository.save(personality)).rejects.toThrow(
        'Failed to save personality: Failed to persist data: Disk full'
      );
    });
    
    it('should initialize if not already initialized', async () => {
      const personality = Personality.create(
        new PersonalityId('new-personality'),
        new UserId('456789012345678901')
      );
      
      await repository.save(personality);
      
      expect(fs.mkdir).toHaveBeenCalled();
      expect(repository._initialized).toBe(true);
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
      await repository.initialize();
      repository._cache.personalities['bad-data'] = { invalid: 'data' };
      
      await expect(repository.findById(new PersonalityId('bad-data'))).rejects.toThrow(
        'Failed to find personality'
      );
    });
  });
  
  describe('findByOwner', () => {
    it('should find all personalities by owner', async () => {
      await repository.initialize();
      
      // Add another personality for the same owner
      repository._cache.personalities['test-personality-2'] = {
        id: 'test-personality-2',
        ownerId: '123456789012345678',
        profile: {
          displayName: 'Test 2',
          avatarUrl: 'https://example.com/test2.png',
        },
        aliases: [],
      };
      
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
      await repository.initialize();
      repository._cache.personalities['bad-data'] = {
        ownerId: '123456789012345678',
        invalid: 'data',
      };
      
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
      await repository.initialize();
      repository._cache.aliases['orphan'] = 'non-existent-personality';
      
      const result = await repository.findByAlias('orphan');
      
      expect(result).toBeNull();
      expect(repository._cache.aliases['orphan']).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });
    
    it('should handle errors during hydration', async () => {
      await repository.initialize();
      repository._cache.aliases['bad'] = 'bad-data';
      repository._cache.personalities['bad-data'] = { invalid: 'data' };
      
      await expect(repository.findByAlias('bad')).rejects.toThrow(
        'Failed to find personality by alias'
      );
    });
  });
  
  describe('findAll', () => {
    it('should return all personalities', async () => {
      await repository.initialize();
      
      // Add more personalities
      repository._cache.personalities['test-2'] = {
        id: 'test-2',
        ownerId: '456789012345678901',
        profile: { displayName: 'Test 2' },
        aliases: [],
      };
      repository._cache.personalities['test-3'] = {
        id: 'test-3',
        ownerId: '789012345678901234',
        profile: { displayName: 'Test 3' },
        aliases: [],
      };
      
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
      await repository.initialize();
      repository._cache.personalities['bad-data'] = { invalid: 'data' };
      
      await expect(repository.findAll()).rejects.toThrow(
        'Failed to find all personalities'
      );
    });
  });
  
  describe('delete', () => {
    it('should delete a personality and its aliases', async () => {
      await repository.initialize();
      
      await repository.delete(new PersonalityId('test-personality'));
      
      expect(repository._cache.personalities['test-personality']).toBeUndefined();
      expect(repository._cache.aliases['test']).toBeUndefined();
      expect(repository._cache.aliases['testy']).toBeUndefined();
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
      
      // Add more data
      repository._cache.personalities['test-2'] = {
        id: 'test-2',
        ownerId: '123456789012345678',
        profile: { displayName: 'Test 2' },
        aliases: [],
      };
      repository._cache.personalities['test-3'] = {
        id: 'test-3',
        ownerId: '456789012345678901',
        profile: { displayName: 'Test 3' },
        aliases: [],
      };
      repository._cache.aliases['test2'] = 'test-2';
      
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
  
  describe('_hydrate', () => {
    it('should handle aliases as strings', async () => {
      await repository.initialize();
      
      const data = {
        id: 'test-id',
        ownerId: '123456789012345678',
        aliases: ['alias1', 'alias2'],
      };
      
      const personality = repository._hydrate(data);
      
      expect(personality.aliases).toHaveLength(2);
      expect(personality.aliases[0].value).toBe('alias1');
      expect(personality.aliases[1].value).toBe('alias2');
    });
    
    it('should handle aliases as objects', async () => {
      await repository.initialize();
      
      const data = {
        id: 'test-id',
        ownerId: '123456789012345678',
        aliases: [{ value: 'alias1' }, { value: 'alias2' }],
      };
      
      const personality = repository._hydrate(data);
      
      expect(personality.aliases).toHaveLength(2);
      expect(personality.aliases[0].value).toBe('alias1');
      expect(personality.aliases[1].value).toBe('alias2');
    });
    
    it('should handle missing profile', async () => {
      await repository.initialize();
      
      const data = {
        id: 'test-id',
        ownerId: '123456789012345678',
        aliases: [],
      };
      
      const personality = repository._hydrate(data);
      
      // When created, personality gets an empty profile by default
      expect(personality.profile).not.toBeNull();
      // Check if displayName is null or empty string (depends on createEmpty implementation)
      expect([null, ''].includes(personality.profile.displayName)).toBe(true);
    });
    
    it('should mark events as committed', async () => {
      await repository.initialize();
      
      const data = {
        id: 'test-id',
        ownerId: '123456789012345678',
        aliases: [],
      };
      
      const personality = repository._hydrate(data);
      
      expect(personality.getUncommittedEvents()).toHaveLength(0);
    });
  });
  
  describe('_persist', () => {
    it('should write to temp file then rename', async () => {
      await repository.initialize();
      repository._cache.personalities['new'] = { id: 'new' };
      
      await repository._persist();
      
      const expectedPath = path.join('./test-data', 'test-personalities.json');
      const tempPath = expectedPath + '.tmp';
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        tempPath,
        expect.any(String),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalledWith(tempPath, expectedPath);
    });
    
    it('should format JSON with indentation', async () => {
      await repository.initialize();
      
      await repository._persist();
      
      const writtenData = fs.writeFile.mock.calls[0][1];
      expect(writtenData).toContain('  '); // Check for indentation
      expect(() => JSON.parse(writtenData)).not.toThrow();
    });
    
    it('should throw specific error on failure', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('EACCES'));
      
      await expect(repository._persist()).rejects.toThrow(
        'Failed to persist data: EACCES'
      );
    });
  });
});