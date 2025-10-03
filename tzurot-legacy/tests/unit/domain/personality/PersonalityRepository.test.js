/**
 * @jest-environment node
 * @testType domain
 *
 * PersonalityRepository Interface Test
 * - Tests repository interface contract
 * - Includes mock implementation example
 * - Pure domain test with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const {
  PersonalityRepository,
} = require('../../../../src/domain/personality/PersonalityRepository');
const { Personality } = require('../../../../src/domain/personality/Personality');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');
const { UserId } = require('../../../../src/domain/personality/UserId');
const { PersonalityProfile } = require('../../../../src/domain/personality/PersonalityProfile');
const { AIModel } = require('../../../../src/domain/ai/AIModel');

describe('PersonalityRepository', () => {
  let repository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new PersonalityRepository();
  });

  describe('interface methods', () => {
    it('should define save method', () => {
      expect(repository.save).toBeDefined();
      expect(typeof repository.save).toBe('function');
    });

    it('should define findById method', () => {
      expect(repository.findById).toBeDefined();
      expect(typeof repository.findById).toBe('function');
    });

    it('should define findByOwner method', () => {
      expect(repository.findByOwner).toBeDefined();
      expect(typeof repository.findByOwner).toBe('function');
    });

    it('should define findAll method', () => {
      expect(repository.findAll).toBeDefined();
      expect(typeof repository.findAll).toBe('function');
    });

    it('should define exists method', () => {
      expect(repository.exists).toBeDefined();
      expect(typeof repository.exists).toBe('function');
    });

    it('should define delete method', () => {
      expect(repository.delete).toBeDefined();
      expect(typeof repository.delete).toBe('function');
    });

    it('should define nextId method', () => {
      expect(repository.nextId).toBeDefined();
      expect(typeof repository.nextId).toBe('function');
    });
  });

  describe('unimplemented methods', () => {
    it('should throw error for save', async () => {
      const personality = new Personality(new PersonalityId('test'));

      await expect(repository.save(personality)).rejects.toThrow(
        'PersonalityRepository.save() must be implemented'
      );
    });

    it('should throw error for findById', async () => {
      const id = new PersonalityId('test');

      await expect(repository.findById(id)).rejects.toThrow(
        'PersonalityRepository.findById() must be implemented'
      );
    });

    it('should throw error for findByOwner', async () => {
      const ownerId = new UserId('123456789012345678');

      await expect(repository.findByOwner(ownerId)).rejects.toThrow(
        'PersonalityRepository.findByOwner() must be implemented'
      );
    });

    it('should throw error for findAll', async () => {
      await expect(repository.findAll()).rejects.toThrow(
        'PersonalityRepository.findAll() must be implemented'
      );
    });

    it('should throw error for exists', async () => {
      const id = new PersonalityId('test');

      await expect(repository.exists(id)).rejects.toThrow(
        'PersonalityRepository.exists() must be implemented'
      );
    });

    it('should throw error for delete', async () => {
      const id = new PersonalityId('test');

      await expect(repository.delete(id)).rejects.toThrow(
        'PersonalityRepository.delete() must be implemented'
      );
    });

    it('should throw error for nextId', async () => {
      await expect(repository.nextId()).rejects.toThrow(
        'PersonalityRepository.nextId() must be implemented'
      );
    });
  });

  describe('mock implementation', () => {
    class MockPersonalityRepository extends PersonalityRepository {
      constructor() {
        super();
        this.personalities = new Map();
      }

      async save(personality) {
        this.personalities.set(personality.id, personality);
      }

      async findById(personalityId) {
        return this.personalities.get(personalityId.toString()) || null;
      }

      async findByOwner(ownerId) {
        return Array.from(this.personalities.values()).filter(p => p.ownerId.equals(ownerId));
      }

      async findAll() {
        return Array.from(this.personalities.values());
      }

      async exists(personalityId) {
        return this.personalities.has(personalityId.toString());
      }

      async delete(personalityId) {
        this.personalities.delete(personalityId.toString());
      }

      async nextId() {
        return `personality_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      }
    }

    it('should allow implementation of interface', async () => {
      const mockRepo = new MockPersonalityRepository();
      const personalityId = new PersonalityId('test-personality');
      const ownerId = new UserId('123456789012345678');
      const profile = new PersonalityProfile({
        mode: 'local',
        name: 'test-personality',
        displayName: 'Test Personality',
        prompt: 'You are a test bot',
        modelPath: '/default',
        maxWordCount: 1000,
      });
      const model = AIModel.createDefault();
      const personality = Personality.create(personalityId, ownerId, profile, model);

      // Test save
      await mockRepo.save(personality);

      // Test findById
      const found = await mockRepo.findById(personality.personalityId);
      expect(found).toBe(personality);

      // Test exists
      const exists = await mockRepo.exists(personality.personalityId);
      expect(exists).toBe(true);

      // Test findByOwner
      const byOwner = await mockRepo.findByOwner(personality.ownerId);
      expect(byOwner).toContain(personality);

      // Test findAll
      const all = await mockRepo.findAll();
      expect(all).toContain(personality);

      // Test nextId
      const nextId = await mockRepo.nextId();
      expect(nextId).toMatch(/^personality_\d+_[a-z0-9]+$/);

      // Test delete
      await mockRepo.delete(personality.personalityId);
      const afterDelete = await mockRepo.exists(personality.personalityId);
      expect(afterDelete).toBe(false);
    });
  });

  describe('interface contract', () => {
    it('should be extendable', () => {
      class CustomRepo extends PersonalityRepository {}
      const customRepo = new CustomRepo();

      expect(customRepo).toBeInstanceOf(PersonalityRepository);
    });

    it('should maintain method signatures', () => {
      // save(personality) -> Promise<void>
      expect(repository.save.length).toBe(1);

      // findById(personalityId) -> Promise<Personality|null>
      expect(repository.findById.length).toBe(1);

      // findByOwner(ownerId) -> Promise<Personality[]>
      expect(repository.findByOwner.length).toBe(1);

      // findAll() -> Promise<Personality[]>
      expect(repository.findAll.length).toBe(0);

      // exists(personalityId) -> Promise<boolean>
      expect(repository.exists.length).toBe(1);

      // delete(personalityId) -> Promise<void>
      expect(repository.delete.length).toBe(1);

      // nextId() -> Promise<string>
      expect(repository.nextId.length).toBe(0);
    });
  });
});
