/**
 * @jest-environment node
 * @testType domain
 *
 * AuthenticationRepository Interface Test
 * - Tests repository interface contract
 * - Includes mock implementation example
 * - Pure domain test with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const {
  AuthenticationRepository,
} = require('../../../../src/domain/authentication/AuthenticationRepository');
const { UserAuth } = require('../../../../src/domain/authentication/UserAuth');
const { UserId } = require('../../../../src/domain/personality/UserId');
const { Token } = require('../../../../src/domain/authentication/Token');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');

describe('AuthenticationRepository', () => {
  let repository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new AuthenticationRepository();
  });

  describe('interface methods', () => {
    it('should define save method', () => {
      expect(repository.save).toBeDefined();
      expect(typeof repository.save).toBe('function');
    });

    it('should define findByUserId method', () => {
      expect(repository.findByUserId).toBeDefined();
      expect(typeof repository.findByUserId).toBe('function');
    });

    it('should define findBlacklisted method', () => {
      expect(repository.findBlacklisted).toBeDefined();
      expect(typeof repository.findBlacklisted).toBe('function');
    });

    it('should define findExpiredTokens method', () => {
      expect(repository.findExpiredTokens).toBeDefined();
      expect(typeof repository.findExpiredTokens).toBe('function');
    });

    it('should define delete method', () => {
      expect(repository.delete).toBeDefined();
      expect(typeof repository.delete).toBe('function');
    });

    it('should define countAuthenticated method', () => {
      expect(repository.countAuthenticated).toBeDefined();
      expect(typeof repository.countAuthenticated).toBe('function');
    });
  });

  describe('unimplemented methods', () => {
    it('should throw error for save', async () => {
      const userId = new UserId('123456789012345678');
      const userAuth = new UserAuth(userId);

      await expect(repository.save(userAuth)).rejects.toThrow(
        'AuthenticationRepository.save() must be implemented'
      );
    });

    it('should throw error for findByUserId', async () => {
      const userId = new UserId('123456789012345678');

      await expect(repository.findByUserId(userId)).rejects.toThrow(
        'AuthenticationRepository.findByUserId() must be implemented'
      );
    });

    it('should throw error for findBlacklisted', async () => {
      await expect(repository.findBlacklisted()).rejects.toThrow(
        'AuthenticationRepository.findBlacklisted() must be implemented'
      );
    });

    it('should throw error for findExpiredTokens', async () => {
      const expiryDate = new Date();

      await expect(repository.findExpiredTokens(expiryDate)).rejects.toThrow(
        'AuthenticationRepository.findExpiredTokens() must be implemented'
      );
    });

    it('should throw error for delete', async () => {
      const userId = new UserId('123456789012345678');

      await expect(repository.delete(userId)).rejects.toThrow(
        'AuthenticationRepository.delete() must be implemented'
      );
    });

    it('should throw error for countAuthenticated', async () => {
      await expect(repository.countAuthenticated()).rejects.toThrow(
        'AuthenticationRepository.countAuthenticated() must be implemented'
      );
    });
  });

  describe('mock implementation', () => {
    class MockAuthenticationRepository extends AuthenticationRepository {
      constructor() {
        super();
        this.users = new Map();
      }

      async save(userAuth) {
        this.users.set(userAuth.userId.toString(), userAuth);
      }

      async findByUserId(userId) {
        return this.users.get(userId.toString()) || null;
      }

      async findBlacklisted() {
        return Array.from(this.users.values()).filter(userAuth => userAuth.blacklisted);
      }

      async findExpiredTokens(expiryDate) {
        return Array.from(this.users.values()).filter(userAuth => {
          return userAuth.token && userAuth.token.isExpired(expiryDate);
        });
      }

      async delete(userId) {
        this.users.delete(userId.toString());
      }

      async countAuthenticated() {
        return Array.from(this.users.values()).filter(
          userAuth => userAuth.token && !userAuth.token.isExpired()
        ).length;
      }
    }

    it('should allow implementation of interface', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const mockRepo = new MockAuthenticationRepository();
      const userId = new UserId('123456789012345678');

      // Create authenticated user
      const token = Token.createWithLifetime('test-token-123', 3600 * 1000); // 1 hour
      const userAuth = UserAuth.authenticate(userId, token);

      // Test save
      await mockRepo.save(userAuth);

      // Test findByUserId
      const found = await mockRepo.findByUserId(userId);
      expect(found).toBe(userAuth);

      // Test countAuthenticated
      const count = await mockRepo.countAuthenticated();
      expect(count).toBe(1);

      // Test findBlacklisted (empty initially)
      let blacklisted = await mockRepo.findBlacklisted();
      expect(blacklisted).toHaveLength(0);

      // Blacklist the user
      userAuth.blacklist('Test reason');
      await mockRepo.save(userAuth);

      blacklisted = await mockRepo.findBlacklisted();
      expect(blacklisted).toHaveLength(1);
      expect(blacklisted[0]).toBe(userAuth);

      // Test findExpiredTokens (need to test with fresh user since blacklisting revokes token)
      // Create a separate user to test expired tokens
      const userId2 = new UserId('987654321098765432');
      const token2 = Token.createWithLifetime('test-token-456', 1000); // 1 second only
      const userAuth2 = UserAuth.authenticate(userId2, token2);

      // Save the user before token expires
      await mockRepo.save(userAuth2);

      // Now advance time to expire the token
      jest.advanceTimersByTime(2000); // 2 seconds to ensure expiry

      const expired = await mockRepo.findExpiredTokens(new Date());
      expect(expired).toHaveLength(1);
      expect(expired[0]).toBe(userAuth2);

      // Test delete
      await mockRepo.delete(userId);
      const afterDelete = await mockRepo.findByUserId(userId);
      expect(afterDelete).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('interface contract', () => {
    it('should be extendable', () => {
      class CustomRepo extends AuthenticationRepository {}
      const customRepo = new CustomRepo();

      expect(customRepo).toBeInstanceOf(AuthenticationRepository);
    });

    it('should maintain method signatures', () => {
      // save(userAuth) -> Promise<void>
      expect(repository.save.length).toBe(1);

      // findByUserId(userId) -> Promise<UserAuth|null>
      expect(repository.findByUserId.length).toBe(1);

      // findBlacklisted() -> Promise<UserAuth[]>
      expect(repository.findBlacklisted.length).toBe(0);

      // findExpiredTokens(expiryDate) -> Promise<UserAuth[]>
      expect(repository.findExpiredTokens.length).toBe(1);

      // delete(userId) -> Promise<void>
      expect(repository.delete.length).toBe(1);

      // countAuthenticated() -> Promise<number>
      expect(repository.countAuthenticated.length).toBe(0);
    });
  });
});
