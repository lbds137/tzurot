/**
 * @jest-environment node
 */

// Unmock PersonalityApplicationService since it's globally mocked in setup.js
jest.unmock('../../../../src/application/services/PersonalityApplicationService');

// Mock dependencies before imports
jest.mock('../../../../src/logger');
jest.mock('../../../../src/profileInfoFetcher');
jest.mock('../../../../src/utils/avatarManager', () => ({
  preloadPersonalityAvatar: jest.fn().mockResolvedValue(undefined),
}));

const {
  PersonalityApplicationService,
} = require('../../../../src/application/services/PersonalityApplicationService');
const {
  Personality,
  PersonalityId,
  PersonalityProfile,
  UserId,
  Alias,
  PersonalityCreated,
} = require('../../../../src/domain/personality');
const { AIModel } = require('../../../../src/domain/ai');
const { DomainEventBus } = require('../../../../src/domain/shared/DomainEventBus');
const logger = require('../../../../src/logger');

// Mock logger
logger.info = jest.fn();
logger.error = jest.fn();
logger.warn = jest.fn();
logger.debug = jest.fn();

describe('PersonalityApplicationService', () => {
  let service;
  let mockPersonalityRepository;
  let mockAiService;
  let mockAuthenticationRepository;
  let mockEventBus;
  let mockProfileFetcher;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Create mocks
    mockPersonalityRepository = {
      findByName: jest.fn(),
      findByAlias: jest.fn(),
      findByNameOrAlias: jest.fn(),
      findByOwner: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
      exists: jest.fn(),
    };

    mockAiService = {
      getModelInfo: jest.fn().mockResolvedValue({
        name: 'gpt-4',
        capabilities: {
          maxTokens: 8192,
          supportsImages: true,
          supportsAudio: true,
        },
      }),
    };

    mockAuthenticationRepository = {
      findByUserId: jest.fn(),
    };

    mockEventBus = new DomainEventBus();
    jest.spyOn(mockEventBus, 'publish').mockResolvedValue(undefined);

    mockProfileFetcher = {
      fetchProfileInfo: jest.fn().mockImplementation((name) => 
        Promise.resolve({
          name: name || 'TestBot',
          avatar: 'https://api.example.com/avatar.png',
          error_message: 'Test error message',
        })
      ),
    };

    service = new PersonalityApplicationService({
      personalityRepository: mockPersonalityRepository,
      aiService: mockAiService,
      authenticationRepository: mockAuthenticationRepository,
      eventBus: mockEventBus,
      profileFetcher: mockProfileFetcher,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should require personalityRepository', () => {
      expect(
        () =>
          new PersonalityApplicationService({
            aiService: mockAiService,
            authenticationRepository: mockAuthenticationRepository,
          })
      ).toThrow('PersonalityRepository is required');
    });

    it('should require aiService', () => {
      expect(
        () =>
          new PersonalityApplicationService({
            personalityRepository: mockPersonalityRepository,
            authenticationRepository: mockAuthenticationRepository,
          })
      ).toThrow('AIService is required');
    });

    it('should require authenticationRepository', () => {
      expect(
        () =>
          new PersonalityApplicationService({
            personalityRepository: mockPersonalityRepository,
            aiService: mockAiService,
          })
      ).toThrow('AuthenticationRepository is required');
    });

    it('should use default event bus if not provided', () => {
      const serviceWithDefaultBus = new PersonalityApplicationService({
        personalityRepository: mockPersonalityRepository,
        aiService: mockAiService,
        authenticationRepository: mockAuthenticationRepository,
      });

      expect(serviceWithDefaultBus.eventBus).toBeDefined();
      expect(serviceWithDefaultBus.eventBus.publish).toBeDefined();
      expect(typeof serviceWithDefaultBus.eventBus.publish).toBe('function');
    });
  });

  describe('registerPersonality', () => {
    describe('local mode', () => {
      const validLocalCommand = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'local',
        prompt: 'You are a helpful test bot',
        modelPath: '/models/gpt-4',
        maxWordCount: 1000,
        aliases: ['TB', 'TestB'],
      };

      it('should successfully register a new local personality', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(null);
        mockPersonalityRepository.findByAlias.mockResolvedValue(null);

        const result = await service.registerPersonality(validLocalCommand);

        // Verify the result has the expected structure and values
        expect(result).toBeDefined();
        expect(result.personalityId).toBeDefined();
        expect(result.profile).toBeDefined();
        expect(result.profile.name).toBe('TestBot');
        expect(result.profile.mode).toBe('local');
        expect(result.profile.prompt).toBe('You are a helpful test bot');
        expect(result.ownerId.toString()).toBe('123456789012345678');
        expect(mockPersonalityRepository.save).toHaveBeenCalledWith(result);
        expect(mockEventBus.publish).toHaveBeenCalled();
      });

      it('should reject local personality without prompt', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(null);

        const invalidCommand = { ...validLocalCommand };
        delete invalidCommand.prompt;

        await expect(service.registerPersonality(invalidCommand)).rejects.toThrow(
          'Local personalities require prompt and modelPath'
        );
      });
    });

    describe('external mode', () => {
      const validExternalCommand = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'external',
        aliases: ['TB', 'TestB'],
      };

      it('should successfully register a new external personality', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(null);
        mockPersonalityRepository.findByAlias.mockResolvedValue(null);

        const result = await service.registerPersonality(validExternalCommand);

        // Verify the result has the expected structure
        expect(result).toBeDefined();
        expect(result.personalityId).toBeDefined();
        expect(result.profile.name).toBe('TestBot');
        expect(result.profile.mode).toBe('external');
        expect(result.profile.prompt).toBeNull();
        expect(result.ownerId.toString()).toBe('123456789012345678');
        expect(mockPersonalityRepository.save).toHaveBeenCalledWith(result);
        expect(mockEventBus.publish).toHaveBeenCalled();
      });

      it('should default to external mode when not specified', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(null);
        mockPersonalityRepository.findByAlias.mockResolvedValue(null);

        const commandWithoutMode = {
          name: 'TestBot',
          ownerId: '123456789012345678',
        };

        const result = await service.registerPersonality(commandWithoutMode);

        expect(result.profile.mode).toBe('external');
      });

      it('should reject external personality that does not exist in API', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(null);
        mockProfileFetcher.fetchProfileInfo.mockResolvedValue(null); // API returns no data

        const command = {
          name: 'NonExistentBot',
          ownerId: '123456789012345678',
          mode: 'external',
        };

        await expect(service.registerPersonality(command)).rejects.toThrow(
          'Personality "NonExistentBot" does not exist. Please check the spelling and try again.'
        );

        expect(mockPersonalityRepository.save).not.toHaveBeenCalled();
      });

      it('should generate unique alias when display name conflicts during seeding', async () => {
        // Simulate personality seeding scenario
        const existingPersonality = Personality.create(
          PersonalityId.generate(),
          new UserId('123456789012345678'),
          new PersonalityProfile({
            mode: 'external',
            name: 'claude-3-opus',
            displayName: 'Claude',
          }),
          AIModel.createDefault()
        );
        existingPersonality.addAlias(new Alias('claude'));

        // Mock repository responses
        mockPersonalityRepository.findByName.mockResolvedValue(null);
        mockPersonalityRepository.findByAlias
          .mockResolvedValueOnce(null) // No alias for TB
          .mockResolvedValueOnce(null) // No alias for TestB  
          .mockResolvedValueOnce(existingPersonality) // 'claude' is taken
          .mockResolvedValueOnce(null); // 'claude-3' is available

        // Mock profile fetcher to return API data with display name "Claude"
        mockProfileFetcher.fetchProfileInfo.mockResolvedValue({
          name: 'Claude',
          displayName: 'Claude',
          username: 'claude-3-sonnet',
          avatar: 'https://example.com/avatar.png',
          error_message: 'Test error message',
        });

        const result = await service.registerPersonality({
          name: 'claude-3-sonnet',
          ownerId: '123456789012345678',
          mode: 'external',
          aliases: ['TB', 'TestB'],
        });

        // Verify the personality was created
        expect(result).toBeDefined();
        expect(result.profile.name).toBe('claude-3-sonnet');
        expect(result.profile.displayName).toBe('Claude');

        // Verify that it tried to add display name as alias but found conflict
        expect(mockPersonalityRepository.findByAlias).toHaveBeenCalledWith('claude');
        
        // Verify the save was called twice - once after initial save, once after adding generated alias
        expect(mockPersonalityRepository.save).toHaveBeenCalledTimes(2);
        
        // Check that personality has the expected aliases
        expect(result.aliases).toHaveLength(3); // TB, TestB, claude-3
        expect(result.aliases.map(a => a.value)).toContain('tb');
        expect(result.aliases.map(a => a.value)).toContain('testb');
        expect(result.aliases.map(a => a.value)).toContain('claude-3');
      });

      it('should not add any alias if display name matches full name', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(null);
        mockPersonalityRepository.findByAlias.mockResolvedValue(null);

        mockProfileFetcher.fetchProfileInfo.mockResolvedValue({
          name: 'TestBot',
          displayName: 'TestBot', // Same as full name
          username: 'testbot',
          avatar: 'https://example.com/avatar.png',
        });

        const result = await service.registerPersonality({
          name: 'testbot',
          ownerId: '123456789012345678',
          mode: 'external',
        });

        // Should only save once (no additional alias to add)
        expect(mockPersonalityRepository.save).toHaveBeenCalledTimes(1);
        expect(result.aliases).toHaveLength(0);
      });
    });

    it('should reject if personality name already exists', async () => {
      const existingPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('999999999999999999'),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Existing',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );

      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      const command = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'local',
        prompt: 'Test prompt',
        modelPath: '/model',
      };

      await expect(service.registerPersonality(command)).rejects.toThrow(
        'Personality "TestBot" already exists'
      );

      expect(mockPersonalityRepository.save).not.toHaveBeenCalled();
    });

    it('should handle alias conflicts by creating alternate aliases', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      const conflictingPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('999999999999999999'),
        new PersonalityProfile({
          mode: 'local',
          name: 'OtherBot',
          user_prompt: 'Other',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );

      // Clear all previous mocks
      mockPersonalityRepository.findByAlias.mockReset();
      
      mockPersonalityRepository.findByAlias
        .mockResolvedValueOnce(null) // 'tb' is available
        .mockResolvedValueOnce(conflictingPersonality) // 'testb' conflicts
        .mockResolvedValueOnce(null); // 'testb-testbot' is available

      const command = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'local',
        prompt: 'Test prompt',
        modelPath: '/model',
        aliases: ['TB', 'TestB'],
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeDefined();
      expect(result.aliases).toHaveLength(2);
      expect(result.aliases[0].value).toBe('tb');
      expect(result.aliases[1].value).toBe('testb-testbot');
      expect(result.alternateAliases).toEqual(['testb-testbot']);
    });

    it('should handle AI service errors gracefully', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      mockAiService.getModelInfo.mockRejectedValue(new Error('AI service unavailable'));

      const command = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'local',
        prompt: 'Test prompt',
        modelPath: '/model',
      };

      const result = await service.registerPersonality(command);

      // Should still create personality with default model capabilities
      expect(result).toBeInstanceOf(Personality);
      expect(result.model.capabilities.maxTokens).toBe(4096);
      expect(mockPersonalityRepository.save).toHaveBeenCalled();
    });

    it('should work without aliases', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      const command = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'external',
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeInstanceOf(Personality);
      expect(result.aliases).toHaveLength(0);
    });

    it('should register aliases successfully when no conflicts exist', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);

      const command = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'external',
        aliases: ['tb', 'test'],
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeDefined();
      expect(result.aliases).toHaveLength(2);
      expect(result.aliases[0].value).toBe('tb');
      expect(result.aliases[1].value).toBe('test');
      expect(result.alternateAliases).toBeUndefined();
    });

    it('should use random suffix when smart alias is also taken', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      const existingPersonality1 = Personality.create(
        PersonalityId.generate(),
        new UserId('999999999999999999'),
        new PersonalityProfile({ mode: 'external', name: 'Bot1' }),
        AIModel.createDefault()
      );

      const existingPersonality2 = Personality.create(
        PersonalityId.generate(),
        new UserId('999999999999999999'),
        new PersonalityProfile({ mode: 'external', name: 'Bot2' }),
        AIModel.createDefault()
      );

      mockPersonalityRepository.findByAlias
        .mockResolvedValueOnce(existingPersonality1) // 'bot' is taken
        .mockResolvedValueOnce(existingPersonality2) // 'bot-testbot' is also taken
        .mockResolvedValueOnce(null); // random suffix will be available

      const command = {
        name: 'TestBot',
        ownerId: '123456789012345678',
        mode: 'external',
        aliases: ['bot'],
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeDefined();
      expect(result.aliases).toHaveLength(1);
      expect(result.aliases[0].value).toMatch(/^bot-[a-z]{6}$/);
      expect(result.alternateAliases).toHaveLength(1);
      expect(result.alternateAliases[0]).toMatch(/^bot-[a-z]{6}$/);
    });
  });

  describe('updatePersonalityProfile', () => {
    let existingPersonality;
    let localService;

    beforeEach(() => {
      // Ensure we have a service instance for these tests
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
      existingPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Original prompt',
          engine_model: '/models/gpt-3.5',
          maxWordCount: 500,
        }),
        new AIModel('gpt-3.5', '/models/gpt-3.5', { maxTokens: 4096 })
      );
      existingPersonality.markEventsAsCommitted(); // Clear creation event
    });

    it('should update prompt successfully', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      const result = await localService.updatePersonalityProfile({
        personalityName: 'TestBot',
        requesterId: '123456789012345678',
        prompt: 'Updated prompt',
      });

      expect(result.profile.prompt).toBe('Updated prompt');
      expect(mockPersonalityRepository.save).toHaveBeenCalledWith(result);
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should update model path and resolve new model', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      const result = await localService.updatePersonalityProfile({
        personalityName: 'TestBot',
        requesterId: '123456789012345678',
        modelPath: '/models/gpt-4',
      });

      expect(result.profile.modelPath).toBe('/models/gpt-4');
      expect(result.model.name).toBe('gpt-4');
      expect(mockAiService.getModelInfo).toHaveBeenCalledWith('/models/gpt-4');
    });

    it('should update multiple fields at once', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      const result = await localService.updatePersonalityProfile({
        personalityName: 'TestBot',
        requesterId: '123456789012345678',
        prompt: 'New prompt',
        modelPath: '/models/gpt-4',
        maxWordCount: 2000,
      });

      expect(result.profile.prompt).toBe('New prompt');
      expect(result.profile.modelPath).toBe('/models/gpt-4');
      expect(result.profile.maxWordCount).toBe(2000);
    });

    it('should reject if personality not found', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      await expect(
        localService.updatePersonalityProfile({
          personalityName: 'NonExistent',
          requesterId: '123456789012345678',
          prompt: 'New prompt',
        })
      ).rejects.toThrow('Personality "NonExistent" not found');
    });

    it('should reject if requester is not the owner', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      await expect(
        localService.updatePersonalityProfile({
          personalityName: 'TestBot',
          requesterId: '999999999999999999', // Different user
          prompt: 'New prompt',
        })
      ).rejects.toThrow('Only the owner can update a personality');
    });
  });

  describe('addAlias', () => {
    let existingPersonality;

    beforeEach(() => {
      existingPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Test prompt',
          engine_model: '/model',
        }),
        new AIModel('gpt-4', '/model', {})
      );
      existingPersonality.markEventsAsCommitted();
    });

    it('should add alias successfully', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);

      const result = await service.addAlias({
        personalityName: 'TestBot',
        alias: 'NewAlias',
        requesterId: '123456789012345678',
      });

      expect(result.aliases).toContainEqual(expect.objectContaining({ name: 'NewAlias' }));
      expect(mockPersonalityRepository.save).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should reject if personality not found', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      await expect(
        service.addAlias({
          personalityName: 'NonExistent',
          alias: 'NewAlias',
          requesterId: '123456789012345678',
        })
      ).rejects.toThrow('Personality "NonExistent" not found');
    });

    it('should reject if requester is not the owner', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      await expect(
        service.addAlias({
          personalityName: 'TestBot',
          alias: 'NewAlias',
          requesterId: '999999999999999999',
        })
      ).rejects.toThrow('Only the owner can add aliases');
    });

    it('should reassign alias if already in use by another personality', async () => {
      const otherPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('999999999999999999'),
        new PersonalityProfile({
          mode: 'local',
          name: 'OtherBot',
          user_prompt: 'Other',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );
      otherPersonality.addAlias(new Alias('TakenAlias'));
      otherPersonality.markEventsAsCommitted();

      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);
      mockPersonalityRepository.findByAlias.mockResolvedValue(otherPersonality);

      const result = await service.addAlias({
        personalityName: 'TestBot',
        alias: 'TakenAlias',
        requesterId: '123456789012345678',
      });

      // Verify alias was added to new personality
      expect(result.aliases).toContainEqual(expect.objectContaining({ value: 'takenalias' }));

      // Verify both personalities were saved
      expect(mockPersonalityRepository.save).toHaveBeenCalledTimes(2);
      expect(mockPersonalityRepository.save).toHaveBeenCalledWith(otherPersonality);
      expect(mockPersonalityRepository.save).toHaveBeenCalledWith(existingPersonality);

      // Verify alias was removed from other personality
      expect(otherPersonality.aliases).not.toContainEqual(
        expect.objectContaining({ value: 'takenalias' })
      );
    });

    it('should no-op if alias already points to same personality', async () => {
      existingPersonality.addAlias(new Alias('ExistingAlias'));

      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);
      mockPersonalityRepository.findByAlias.mockResolvedValue(existingPersonality);

      const result = await service.addAlias({
        personalityName: 'TestBot',
        alias: 'ExistingAlias',
        requesterId: '123456789012345678',
      });

      expect(result).toBe(existingPersonality);
      // Should not save when alias already exists for same personality
      expect(mockPersonalityRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('removeAlias', () => {
    let existingPersonality;
    let localService;

    beforeEach(() => {
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
      existingPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Test prompt',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );
      existingPersonality.addAlias(new Alias('TB'));
      existingPersonality.addAlias(new Alias('TestB'));
      existingPersonality.markEventsAsCommitted();
    });

    it('should remove alias successfully', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      const result = await localService.removeAlias({
        personalityName: 'TestBot',
        alias: 'TB',
        requesterId: '123456789012345678',
      });

      expect(result.aliases).not.toContainEqual(expect.objectContaining({ name: 'TB' }));
      expect(result.aliases).toContainEqual(expect.objectContaining({ name: 'TestB' }));
      expect(mockPersonalityRepository.save).toHaveBeenCalled();
    });

    it('should reject if requester is not the owner', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      await expect(
        localService.removeAlias({
          personalityName: 'TestBot',
          alias: 'TB',
          requesterId: '999999999999999999',
        })
      ).rejects.toThrow('Only the owner can remove aliases');
    });
  });

  describe('removePersonality', () => {
    let existingPersonality;

    beforeEach(() => {
      existingPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Test prompt',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );
      existingPersonality.markEventsAsCommitted();
    });

    it('should remove personality successfully', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      await service.removePersonality({
        personalityName: 'TestBot',
        requesterId: '123456789012345678',
      });

      expect(existingPersonality.isRemoved).toBe(true);
      expect(mockPersonalityRepository.save).toHaveBeenCalled();
      expect(mockPersonalityRepository.delete).toHaveBeenCalledWith(
        existingPersonality.id.toString()
      );
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should reject if personality not found', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      await expect(
        service.removePersonality({
          personalityName: 'NonExistent',
          requesterId: '123456789012345678',
        })
      ).rejects.toThrow('Personality "NonExistent" not found');
    });

    it('should reject if requester is not the owner', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      await expect(
        service.removePersonality({
          personalityName: 'TestBot',
          requesterId: '999999999999999999',
        })
      ).rejects.toThrow('Only the owner can remove a personality');
    });

    it('should allow bot owner to remove any personality', async () => {
      // Mock constants to set bot owner ID
      jest.doMock('../../../../src/constants', () => ({
        USER_CONFIG: {
          OWNER_ID: '888888888888888888',
        },
      }));

      // Create service with mocked constants
      const localService = new PersonalityApplicationService({
        personalityRepository: mockPersonalityRepository,
        aiService: mockAiService,
        authenticationRepository: mockAuthenticationRepository,
        eventBus: mockEventBus,
        profileFetcher: mockProfileFetcher,
      });

      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      await localService.removePersonality({
        personalityName: 'TestBot',
        requesterId: '888888888888888888', // Bot owner ID
      });

      expect(existingPersonality.isRemoved).toBe(true);
      expect(mockPersonalityRepository.save).toHaveBeenCalled();
      expect(mockPersonalityRepository.delete).toHaveBeenCalled();

      // Clean up mock
      jest.dontMock('../../../../src/constants');
    });
  });

  describe('getPersonality', () => {
    let personality;

    beforeEach(() => {
      personality = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Test prompt',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );
      personality.addAlias(new Alias('TB'));
    });

    it('should find personality using findByNameOrAlias', async () => {
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(personality);

      const result = await service.getPersonality('TestBot');

      expect(result).toBe(personality);
      expect(mockPersonalityRepository.findByNameOrAlias).toHaveBeenCalledWith('TestBot');
      // Should not use old methods
      expect(mockPersonalityRepository.findByName).not.toHaveBeenCalled();
      expect(mockPersonalityRepository.findByAlias).not.toHaveBeenCalled();
    });

    it('should find personality by alias using findByNameOrAlias', async () => {
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(personality);

      const result = await service.getPersonality('TB');

      expect(result).toBe(personality);
      expect(mockPersonalityRepository.findByNameOrAlias).toHaveBeenCalledWith('TB');
    });

    it('should return null if not found', async () => {
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(null);

      const result = await service.getPersonality('Unknown');

      expect(result).toBeNull();
      expect(mockPersonalityRepository.findByNameOrAlias).toHaveBeenCalledWith('Unknown');
    });

    it('should handle errors and re-throw them', async () => {
      mockPersonalityRepository.findByNameOrAlias.mockRejectedValue(new Error('Database error'));

      await expect(service.getPersonality('TestBot')).rejects.toThrow('Database error');
      
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityApplicationService] Failed to get personality: Database error'
      );
    });
  });

  describe('listPersonalities', () => {
    let localService;

    beforeEach(() => {
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
    });
    it('should return all personalities', async () => {
      const personalities = [
        Personality.create(
          PersonalityId.generate(),
          new UserId('123456789012345678'),
          new PersonalityProfile({
            mode: 'local',
            name: 'Bot1',
            user_prompt: 'Prompt1',
            engine_model: '/model',
            maxWordCount: 1000,
          }),
          new AIModel('gpt-4', '/model', {})
        ),
        Personality.create(
          PersonalityId.generate(),
          new UserId('999999999999999999'),
          new PersonalityProfile({
            mode: 'local',
            name: 'Bot2',
            user_prompt: 'Prompt2',
            engine_model: '/model',
            maxWordCount: 1000,
          }),
          new AIModel('gpt-4', '/model', {})
        ),
      ];

      mockPersonalityRepository.findAll.mockResolvedValue(personalities);

      const result = await localService.listPersonalities();

      expect(result).toEqual(personalities);
      expect(mockPersonalityRepository.findAll).toHaveBeenCalled();
    });
  });

  describe('listPersonalitiesByOwner', () => {
    let localService;

    beforeEach(() => {
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
    });

    it('should return personalities for specific owner', async () => {
      const ownerId = '123456789012345678';
      const personalities = [
        Personality.create(
          PersonalityId.generate(),
          new UserId(ownerId),
          new PersonalityProfile({
            mode: 'local',
            name: 'Bot1',
            user_prompt: 'Prompt1',
            engine_model: '/model',
            maxWordCount: 1000,
          }),
          new AIModel('gpt-4', '/model', {})
        ),
        Personality.create(
          PersonalityId.generate(),
          new UserId(ownerId),
          new PersonalityProfile({
            mode: 'local',
            name: 'Bot2',
            user_prompt: 'Prompt2',
            engine_model: '/model',
            maxWordCount: 1000,
          }),
          new AIModel('gpt-4', '/model', {})
        ),
      ];

      mockPersonalityRepository.findByOwner.mockResolvedValue(personalities);

      const result = await localService.listPersonalitiesByOwner(ownerId);

      expect(result).toEqual(personalities);
      expect(mockPersonalityRepository.findByOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          value: ownerId,
        })
      );
    });
  });

  describe('checkPermission', () => {
    let localService;

    beforeEach(() => {
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
    });
    let personality;
    const ownerId = '123456789012345678';

    beforeEach(() => {
      personality = Personality.create(
        PersonalityId.generate(),
        new UserId(ownerId),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Test prompt',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );
    });

    it('should grant permission to owner', async () => {
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(personality);

      const hasPermission = await localService.checkPermission({
        userId: ownerId,
        personalityName: 'TestBot',
      });

      expect(hasPermission).toBe(true);
      expect(mockAuthenticationRepository.findByUserId).not.toHaveBeenCalled();
    });

    it('should grant permission to authenticated user', async () => {
      const otherUserId = '999999999999999999';
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(personality);

      const mockUserAuth = {
        isAuthenticated: jest.fn().mockReturnValue(true),
      };
      mockAuthenticationRepository.findByUserId.mockResolvedValue(mockUserAuth);

      const hasPermission = await localService.checkPermission({
        userId: otherUserId,
        personalityName: 'TestBot',
      });

      expect(hasPermission).toBe(true);
      expect(mockAuthenticationRepository.findByUserId).toHaveBeenCalledWith(otherUserId);
    });

    it('should deny permission to unauthenticated user', async () => {
      const otherUserId = '999999999999999999';
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(personality);

      const mockUserAuth = {
        isAuthenticated: jest.fn().mockReturnValue(false),
      };
      mockAuthenticationRepository.findByUserId.mockResolvedValue(mockUserAuth);

      const hasPermission = await localService.checkPermission({
        userId: otherUserId,
        personalityName: 'TestBot',
      });

      expect(hasPermission).toBe(false);
    });

    it('should deny permission if personality not found', async () => {
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(null);

      const hasPermission = await localService.checkPermission({
        userId: ownerId,
        personalityName: 'NonExistent',
      });

      expect(hasPermission).toBe(false);
    });

    it('should deny permission if no user auth found', async () => {
      const otherUserId = '999999999999999999';
      mockPersonalityRepository.findByNameOrAlias.mockResolvedValue(personality);
      mockAuthenticationRepository.findByUserId.mockResolvedValue(null);

      const hasPermission = await localService.checkPermission({
        userId: otherUserId,
        personalityName: 'TestBot',
      });

      expect(hasPermission).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockPersonalityRepository.findByNameOrAlias.mockRejectedValue(new Error('DB error'));

      const hasPermission = await localService.checkPermission({
        userId: ownerId,
        personalityName: 'TestBot',
      });

      expect(hasPermission).toBe(false);
    });
  });

  describe('_resolveAIModel', () => {
    let localService;

    beforeEach(() => {
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
    });
    it('should create model with AI service info', async () => {
      const modelPath = '/models/gpt-4';

      const model = await localService._resolveAIModel(modelPath);

      expect(model).toBeDefined();
      expect(model.name).toBeDefined();
      expect(model.path).toBeDefined();
      expect(model.name).toBe('gpt-4');
      expect(model.path).toBe(modelPath);
      expect(model.capabilities.maxTokens).toBe(8192);
    });

    it('should create default model if AI service fails', async () => {
      const modelPath = '/models/unknown';
      mockAiService.getModelInfo.mockRejectedValue(new Error('Model not found'));

      const model = await localService._resolveAIModel(modelPath);

      expect(model).toBeDefined();
      expect(model.name).toBeDefined();
      expect(model.path).toBeDefined();
      expect(model.name).toBe(modelPath);
      expect(model.capabilities.maxTokens).toBe(4096);
    });
  });

  describe('getPersonalityWithProfile', () => {
    let localService;

    beforeEach(() => {
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
    });
    describe('external mode personalities', () => {
      let externalPersonality;

      beforeEach(() => {
        externalPersonality = Personality.create(
          PersonalityId.fromString('test-bot'),
          new UserId('123456789012345678'),
          new PersonalityProfile({
            mode: 'external',
            name: 'test-bot',
            displayName: 'Test Bot',
            avatarUrl: 'https://old.example.com/avatar.png',
            errorMessage: 'Old error',
            lastFetched: new Date(Date.now() - 7200000), // 2 hours ago
          }),
          AIModel.createDefault()
        );
      });

      it('should return personality without refresh if still fresh', async () => {
        // Set lastFetched to 30 minutes ago
        externalPersonality.profile.lastFetched = new Date(Date.now() - 1800000);
        mockPersonalityRepository.findByName.mockResolvedValue(externalPersonality);

        const result = await localService.getPersonalityWithProfile('test-bot');

        expect(result).toBe(externalPersonality);
        expect(mockProfileFetcher.fetchProfileInfo).not.toHaveBeenCalled();
      });

      it('should refresh profile from API if stale', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(externalPersonality);
        mockProfileFetcher.fetchProfileInfo.mockResolvedValue({
          name: 'Test Bot Updated',
          avatar: 'https://new.example.com/avatar.png',
          error_message: 'New error message',
        });

        const result = await localService.getPersonalityWithProfile(
          'test-bot',
          '123456789012345678'
        );

        // Verify the result has the expected structure
        expect(result).toBeDefined();
        expect(result.personalityId).toBeDefined();
        expect(result.profile.displayName).toBe('Test Bot Updated');
        expect(result.profile.avatarUrl).toBe('https://new.example.com/avatar.png');
        expect(result.profile.errorMessage).toBe('New error message');
        expect(mockProfileFetcher.fetchProfileInfo).toHaveBeenCalledWith(
          'test-bot',
          '123456789012345678'
        );
        expect(mockPersonalityRepository.save).toHaveBeenCalledWith(result);
      });

      it('should handle API fetch failure gracefully', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(externalPersonality);
        mockProfileFetcher.fetchProfileInfo.mockResolvedValue(null);

        const result = await localService.getPersonalityWithProfile('test-bot');

        expect(result).toBe(externalPersonality);
        expect(result.profile.displayName).toBe('Test Bot'); // Original values unchanged
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to fetch profile')
        );
      });
    });

    describe('local mode personalities', () => {
      let localPersonality;

      beforeEach(() => {
        localPersonality = Personality.create(
          PersonalityId.fromString('local-bot'),
          new UserId('123456789012345678'),
          new PersonalityProfile({
            mode: 'local',
            username: 'local-bot',
            name: 'Local Bot',
            user_prompt: 'I am a local bot',
            engine_model: 'gpt-4',
            avatar: 'https://local.example.com/avatar.png',
          }),
          new AIModel('gpt-4', 'gpt-4', {})
        );
      });

      it('should return local personality without API refresh', async () => {
        mockPersonalityRepository.findByName.mockResolvedValue(localPersonality);

        const result = await localService.getPersonalityWithProfile('local-bot');

        expect(result).toBe(localPersonality);
        expect(mockProfileFetcher.fetchProfileInfo).not.toHaveBeenCalled();
        expect(mockPersonalityRepository.save).not.toHaveBeenCalled();
      });
    });

    it('should return null if personality not found', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      const result = await localService.getPersonalityWithProfile('non-existent');

      expect(result).toBeNull();
      expect(mockProfileFetcher.fetchProfileInfo).not.toHaveBeenCalled();
    });

    it('should handle errors and re-throw them', async () => {
      mockPersonalityRepository.findByName.mockRejectedValue(new Error('Database error'));

      await expect(localService.getPersonalityWithProfile('test-bot')).rejects.toThrow(
        'Database error'
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error getting personality')
      );
    });
  });

  describe('_publishEvents', () => {
    let localService;

    beforeEach(() => {
      localService =
        service ||
        new PersonalityApplicationService({
          personalityRepository: mockPersonalityRepository,
          aiService: mockAiService,
          authenticationRepository: mockAuthenticationRepository,
          eventBus: mockEventBus,
          profileFetcher: mockProfileFetcher,
        });
    });
    it('should publish all uncommitted events', async () => {
      const personality = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'local',
          name: 'TestBot',
          user_prompt: 'Test',
          engine_model: '/model',
          maxWordCount: 1000,
        }),
        new AIModel('gpt-4', '/model', {})
      );

      // Personality should have a creation event
      expect(personality.getUncommittedEvents()).toHaveLength(1);

      await localService._publishEvents(personality);

      expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PersonalityCreated' })
      );
      expect(personality.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('preloadAvatar', () => {
    let existingPersonality;
    let mockPreloadPersonalityAvatar;

    beforeEach(() => {
      // Get the mocked avatarManager
      const avatarManager = require('../../../../src/utils/avatarManager');
      mockPreloadPersonalityAvatar = avatarManager.preloadPersonalityAvatar;
      mockPreloadPersonalityAvatar.mockClear();

      existingPersonality = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'external',
          name: 'TestBot',
          displayName: 'Test Bot',
          avatarUrl: 'https://example.com/avatar.png',
        }),
        AIModel.createDefault()
      );
      existingPersonality.markEventsAsCommitted();
    });

    it('should preload avatar for existing personality', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);

      await service.preloadAvatar('TestBot', '123456789012345678');

      expect(mockPreloadPersonalityAvatar).toHaveBeenCalledWith(
        {
          fullName: 'TestBot',
          avatarUrl: 'https://example.com/avatar.png',
        },
        '123456789012345678'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityApplicationService] Preloading avatar for: TestBot'
      );
    });

    it('should handle personality not found', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);

      await service.preloadAvatar('NonExistent', '123456789012345678');

      expect(mockPreloadPersonalityAvatar).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[PersonalityApplicationService] Personality not found for avatar preload: NonExistent'
      );
    });

    it('should update avatar URL if changed during preload', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);
      
      // Mock the preloadPersonalityAvatar to update the avatar URL
      mockPreloadPersonalityAvatar.mockImplementation(async (personalityData) => {
        personalityData.avatarUrl = 'https://example.com/new-avatar.png';
      });

      await service.preloadAvatar('TestBot', '123456789012345678');

      expect(existingPersonality.profile.avatarUrl).toBe('https://example.com/new-avatar.png');
      expect(mockPersonalityRepository.save).toHaveBeenCalledWith(existingPersonality);
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityApplicationService] Updated avatar URL for: TestBot'
      );
    });

    it('should handle preload errors gracefully', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(existingPersonality);
      mockPreloadPersonalityAvatar.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(service.preloadAvatar('TestBot', '123456789012345678')).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityApplicationService] Failed to preload avatar: Network error'
      );
    });

    it('should work with personality without avatar URL', async () => {
      const personalityNoAvatar = Personality.create(
        PersonalityId.generate(),
        new UserId('123456789012345678'),
        new PersonalityProfile({
          mode: 'external',
          name: 'TestBot',
          displayName: 'Test Bot',
          // No avatarUrl
        }),
        AIModel.createDefault()
      );
      mockPersonalityRepository.findByName.mockResolvedValue(personalityNoAvatar);

      await service.preloadAvatar('TestBot', '123456789012345678');

      expect(mockPreloadPersonalityAvatar).toHaveBeenCalledWith(
        {
          fullName: 'TestBot',
          avatarUrl: null,
        },
        '123456789012345678'
      );
    });
  });

  describe('registerPersonality with avatar preloading', () => {
    it('should trigger avatar preloading after registering external personality', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      
      // Mock the preloadAvatar method
      const preloadAvatarSpy = jest.spyOn(service, 'preloadAvatar').mockResolvedValue(undefined);

      const result = await service.registerPersonality({
        name: 'NewBot',
        ownerId: '123456789012345678',
        mode: 'external',
      });

      // Wait for async operations
      await Promise.resolve();
      jest.runAllTimers();

      expect(preloadAvatarSpy).toHaveBeenCalledWith('NewBot', '123456789012345678');
      expect(result).toBeDefined();
      expect(result.profile.name).toBe('NewBot');
    });

    it('should continue registration even if avatar preloading fails', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      
      // Mock the preloadAvatar method to reject
      const preloadAvatarSpy = jest.spyOn(service, 'preloadAvatar').mockRejectedValue(
        new Error('Avatar preload error')
      );

      const result = await service.registerPersonality({
        name: 'NewBot',
        ownerId: '123456789012345678',
        mode: 'external',
      });

      // Wait for async operations
      await Promise.resolve();
      jest.runAllTimers();

      expect(preloadAvatarSpy).toHaveBeenCalledWith('NewBot', '123456789012345678');
      expect(result).toBeDefined();
      expect(result.profile.name).toBe('NewBot');
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityApplicationService] Error preloading avatar: Avatar preload error'
      );
    });
  });

  describe('Display Name Aliasing', () => {
    it('should automatically create display name alias for external personalities', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      mockPersonalityRepository.save.mockImplementation(p => Promise.resolve(p));
      
      // Mock profile fetcher to return a different display name
      // Note: API returns 'name' which becomes displayName in the profile
      mockProfileFetcher.fetchProfileInfo.mockResolvedValue({
        name: 'Lily',  // This becomes displayName in PersonalityProfile.fromApiResponse
        username: 'lilith-tzel-shani',  // This becomes name
        avatar_url: 'https://example.com/lily.png',
      });
      
      const command = {
        name: 'lilith-tzel-shani',
        ownerId: '123456789012345678',
        mode: 'external',
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeDefined();
      expect(result.profile.displayName).toBe('Lily');
      expect(result.displayNameAlias).toBe('lily');
      
      // Verify the display name alias was saved
      const savedCalls = mockPersonalityRepository.save.mock.calls;
      const lastSave = savedCalls[savedCalls.length - 1][0];
      expect(lastSave.aliases.some(a => a.value === 'lily')).toBe(true);
    });

    it('should automatically create display name alias for local personalities with different display names', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      mockPersonalityRepository.save.mockImplementation(p => Promise.resolve(p));
      
      const command = {
        name: 'test-bot-full-name',
        ownerId: '123456789012345678',
        mode: 'local',
        prompt: 'You are TestBot',
        modelPath: '/default',
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeDefined();
      // For local personalities, display name equals the name
      expect(result.profile.displayName).toBe('test-bot-full-name');
      expect(result.profile.name).toBe('test-bot-full-name');
      // Display name is same as name, so no alias should be created
      expect(result.displayNameAlias).toBeUndefined();
    });

    it('should handle display name alias collisions with smart alternates', async () => {
      mockPersonalityRepository.save.mockImplementation(p => Promise.resolve(p));
      
      // First personality with display name 'Lily'
      mockProfileFetcher.fetchProfileInfo.mockResolvedValueOnce({
        name: 'Lily',  // This becomes displayName
        username: 'lilith-tzel-shani',  // This becomes name
      });
      
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      
      const command1 = {
        name: 'lilith-tzel-shani',
        ownerId: '123456789012345678',
        mode: 'external',
      };
      
      await service.registerPersonality(command1);
      
      // Mock repository to return existing personality when checking alias
      mockPersonalityRepository.findByAlias.mockImplementation(alias => {
        if (alias === 'lily') {
          return Promise.resolve({ personalityId: { value: 'lilith-tzel-shani' } });
        }
        return Promise.resolve(null);
      });
      
      // Second personality with same display name
      mockProfileFetcher.fetchProfileInfo.mockResolvedValueOnce({
        name: 'Lily',  // This becomes displayName
        username: 'lilith-sheda-khazra',  // This becomes name
      });
      
      const command2 = {
        name: 'lilith-sheda-khazra',
        ownerId: '123456789012345678',
        mode: 'external',
      };
      
      const result2 = await service.registerPersonality(command2);
      
      expect(result2).toBeDefined();
      expect(result2.displayNameAlias).toBe('lily-sheda'); // Smart alternate
    });

    it('should not create display name alias if already provided as explicit alias', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      mockPersonalityRepository.save.mockImplementation(p => Promise.resolve(p));
      
      mockProfileFetcher.fetchProfileInfo.mockResolvedValue({
        name: 'Lily',  // This becomes displayName
        username: 'lilith-tzel-shani',  // This becomes name
      });
      
      const command = {
        name: 'lilith-tzel-shani',
        ownerId: '123456789012345678',
        mode: 'external',
        aliases: ['lily'], // Explicitly providing display name as alias
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeDefined();
      expect(result.displayNameAlias).toBeUndefined(); // Should not duplicate
    });

    it('should create display name alias for external personality fetched from API', async () => {
      mockPersonalityRepository.findByName.mockResolvedValue(null);
      mockPersonalityRepository.findByAlias.mockResolvedValue(null);
      mockPersonalityRepository.save.mockImplementation(p => Promise.resolve(p));
      
      // Mock API response with display name different from full name
      mockProfileFetcher.fetchProfileInfo.mockResolvedValue({
        name: 'TestDisplay',  // This becomes displayName
        username: 'test-full-name',  // This becomes name
        avatar_url: 'https://example.com/test.png',
      });
      
      const command = {
        name: 'test-full-name',
        ownerId: '123456789012345678',
        mode: 'external',
      };

      const result = await service.registerPersonality(command);

      expect(result).toBeDefined();
      expect(result.profile.displayName).toBe('TestDisplay');
      expect(result.displayNameAlias).toBe('testdisplay');
    });
  });
});
