/**
 * @jest-environment node
 * @testType domain
 *
 * BlacklistRepository Interface Test
 * - Tests repository interface contract
 * - Includes mock implementation example
 * - Pure domain test with no external dependencies
 */

// Domain models under test - NOT mocked!
const {
  BlacklistRepository,
} = require('../../../../src/domain/blacklist/BlacklistRepository');
const {
  BlacklistedUser,
} = require('../../../../src/domain/blacklist/BlacklistedUser');

describe('BlacklistRepository', () => {
  let repository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new BlacklistRepository();
  });

  describe('interface methods', () => {
    it('should define add method', () => {
      expect(repository.add).toBeDefined();
      expect(typeof repository.add).toBe('function');
    });

    it('should define remove method', () => {
      expect(repository.remove).toBeDefined();
      expect(typeof repository.remove).toBe('function');
    });

    it('should define find method', () => {
      expect(repository.find).toBeDefined();
      expect(typeof repository.find).toBe('function');
    });

    it('should define findAll method', () => {
      expect(repository.findAll).toBeDefined();
      expect(typeof repository.findAll).toBe('function');
    });

    it('should define isBlacklisted method', () => {
      expect(repository.isBlacklisted).toBeDefined();
      expect(typeof repository.isBlacklisted).toBe('function');
    });
  });

  describe('unimplemented methods', () => {
    it('should throw error for add', async () => {
      const blacklistedUser = new BlacklistedUser(
        '123456789012345678',
        'Test reason',
        '987654321098765432',
        new Date()
      );

      await expect(repository.add(blacklistedUser)).rejects.toThrow(
        'BlacklistRepository.add must be implemented'
      );
    });

    it('should throw error for remove', async () => {
      await expect(repository.remove('123456789012345678')).rejects.toThrow(
        'BlacklistRepository.remove must be implemented'
      );
    });

    it('should throw error for find', async () => {
      await expect(repository.find('123456789012345678')).rejects.toThrow(
        'BlacklistRepository.find must be implemented'
      );
    });

    it('should throw error for findAll', async () => {
      await expect(repository.findAll()).rejects.toThrow(
        'BlacklistRepository.findAll must be implemented'
      );
    });

    it('should throw error for isBlacklisted', async () => {
      await expect(repository.isBlacklisted('123456789012345678')).rejects.toThrow(
        'BlacklistRepository.isBlacklisted must be implemented'
      );
    });
  });

  describe('mock implementation', () => {
    class MockBlacklistRepository extends BlacklistRepository {
      constructor() {
        super();
        this.blacklist = new Map();
      }

      async add(blacklistedUser) {
        this.blacklist.set(blacklistedUser.userId.toString(), blacklistedUser);
      }

      async remove(userId) {
        this.blacklist.delete(userId);
      }

      async find(userId) {
        return this.blacklist.get(userId) || null;
      }

      async findAll() {
        return Array.from(this.blacklist.values());
      }

      async isBlacklisted(userId) {
        return this.blacklist.has(userId);
      }
    }

    it('should allow implementation of interface', async () => {
      const mockRepo = new MockBlacklistRepository();

      // Create blacklisted users
      const user1 = new BlacklistedUser(
        '123456789012345678',
        'Spamming',
        '987654321098765432',
        new Date()
      );
      const user2 = new BlacklistedUser(
        '111111111111111111',
        'Harassment',
        '987654321098765432',
        new Date()
      );

      // Test add
      await mockRepo.add(user1);
      await mockRepo.add(user2);

      // Test find
      const found = await mockRepo.find('123456789012345678');
      expect(found).toBe(user1);
      expect(found.userId.toString()).toBe('123456789012345678');
      expect(found.reason).toBe('Spamming');

      // Test isBlacklisted
      const isBlacklisted1 = await mockRepo.isBlacklisted('123456789012345678');
      expect(isBlacklisted1).toBe(true);

      const isBlacklisted2 = await mockRepo.isBlacklisted('999999999999999999');
      expect(isBlacklisted2).toBe(false);

      // Test findAll
      const all = await mockRepo.findAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(user1);
      expect(all).toContain(user2);

      // Test remove
      await mockRepo.remove('123456789012345678');
      const afterRemove = await mockRepo.find('123456789012345678');
      expect(afterRemove).toBeNull();

      const isBlacklistedAfterRemove = await mockRepo.isBlacklisted('123456789012345678');
      expect(isBlacklistedAfterRemove).toBe(false);

      // Verify only one user remains
      const remaining = await mockRepo.findAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBe(user2);
    });

    it('should handle empty blacklist', async () => {
      const mockRepo = new MockBlacklistRepository();

      const all = await mockRepo.findAll();
      expect(all).toEqual([]);

      const found = await mockRepo.find('123456789012345678');
      expect(found).toBeNull();

      const isBlacklisted = await mockRepo.isBlacklisted('123456789012345678');
      expect(isBlacklisted).toBe(false);
    });

    it('should handle remove on non-existent user', async () => {
      const mockRepo = new MockBlacklistRepository();

      // Should not throw
      await expect(mockRepo.remove('999999999999999999')).resolves.toBeUndefined();
    });
  });

  describe('interface contract', () => {
    it('should be extendable', () => {
      class CustomRepo extends BlacklistRepository {}
      const customRepo = new CustomRepo();

      expect(customRepo).toBeInstanceOf(BlacklistRepository);
    });

    it('should maintain method signatures', () => {
      // add(blacklistedUser) -> Promise<void>
      expect(repository.add.length).toBe(1);

      // remove(userId) -> Promise<void>
      expect(repository.remove.length).toBe(1);

      // find(userId) -> Promise<BlacklistedUser|null>
      expect(repository.find.length).toBe(1);

      // findAll() -> Promise<BlacklistedUser[]>
      expect(repository.findAll.length).toBe(0);

      // isBlacklisted(userId) -> Promise<boolean>
      expect(repository.isBlacklisted.length).toBe(1);
    });
  });

  describe('usage patterns', () => {
    it('should support batch operations', async () => {
      class BatchCapableRepo extends BlacklistRepository {
        constructor() {
          super();
          this.blacklist = new Map();
        }

        async add(blacklistedUser) {
          this.blacklist.set(blacklistedUser.userId, blacklistedUser);
        }

        async addBatch(blacklistedUsers) {
          // Example of how implementors might add batch operations
          for (const user of blacklistedUsers) {
            await this.add(user);
          }
        }

        async find(userId) {
          return this.blacklist.get(userId) || null;
        }

        async findAll() {
          return Array.from(this.blacklist.values());
        }

        async remove(userId) {
          this.blacklist.delete(userId);
        }

        async isBlacklisted(userId) {
          return this.blacklist.has(userId);
        }
      }

      const repo = new BatchCapableRepo();
      const users = [
        new BlacklistedUser(
          '111111111111111111',
          'Reason 1',
          '987654321098765432',
          new Date()
        ),
        new BlacklistedUser(
          '222222222222222222',
          'Reason 2',
          '987654321098765432',
          new Date()
        ),
      ];

      await repo.addBatch(users);

      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });

    it('should support filtering operations', async () => {
      class FilterableRepo extends BlacklistRepository {
        constructor() {
          super();
          this.blacklist = new Map();
        }

        async add(blacklistedUser) {
          this.blacklist.set(blacklistedUser.userId, blacklistedUser);
        }

        async find(userId) {
          return this.blacklist.get(userId) || null;
        }

        async findAll() {
          return Array.from(this.blacklist.values());
        }

        async findByReason(reason) {
          // Example of how implementors might add filtering
          const all = await this.findAll();
          return all.filter(user => user.reason.includes(reason));
        }

        async remove(userId) {
          this.blacklist.delete(userId);
        }

        async isBlacklisted(userId) {
          return this.blacklist.has(userId);
        }
      }

      const repo = new FilterableRepo();
      await repo.add(
        new BlacklistedUser(
          '111111111111111111',
          'Spamming repeatedly',
          '987654321098765432',
          new Date()
        )
      );
      await repo.add(
        new BlacklistedUser(
          '222222222222222222',
          'Harassment',
          '987654321098765432',
          new Date()
        )
      );

      const spammers = await repo.findByReason('Spamming');
      expect(spammers).toHaveLength(1);
      expect(spammers[0].userId.toString()).toBe('111111111111111111');
    });
  });
});