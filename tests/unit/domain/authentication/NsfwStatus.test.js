/**
 * @jest-environment node
 * @testType domain
 *
 * NsfwStatus Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests NSFW verification status handling
 * - Uses fake timers for time-based testing
 */


// Domain model under test - NOT mocked!
const { NsfwStatus } = require('../../../../src/domain/authentication/NsfwStatus');

describe('NsfwStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create unverified status by default', () => {
      const status = new NsfwStatus();

      expect(status.verified).toBe(false);
      expect(status.verifiedAt).toBeNull();
    });

    it('should create verified status with date', () => {
      const verifiedAt = new Date();
      const status = new NsfwStatus(true, verifiedAt);

      expect(status.verified).toBe(true);
      expect(status.verifiedAt).toEqual(verifiedAt);
    });

    it('should coerce verified to boolean', () => {
      const status1 = new NsfwStatus('truthy', new Date());
      const status2 = new NsfwStatus(1, new Date());
      const status3 = new NsfwStatus(0);

      expect(status1.verified).toBe(true);
      expect(status2.verified).toBe(true);
      expect(status3.verified).toBe(false);
    });
  });

  describe('validation', () => {
    it('should require verification date when verified', () => {
      expect(() => new NsfwStatus(true, null)).toThrow(
        'Verified status requires verification date'
      );
      expect(() => new NsfwStatus(true)).toThrow('Verified status requires verification date');
    });

    it('should require verifiedAt to be Date', () => {
      expect(() => new NsfwStatus(true, '2024-01-01')).toThrow('VerifiedAt must be a Date');
      expect(() => new NsfwStatus(true, Date.now())).toThrow('VerifiedAt must be a Date');
    });

    it('should not allow verification date without being verified', () => {
      expect(() => new NsfwStatus(false, new Date())).toThrow(
        'Cannot have verification date without being verified'
      );
    });

    it('should allow unverified without date', () => {
      expect(() => new NsfwStatus(false, null)).not.toThrow();
      expect(() => new NsfwStatus(false)).not.toThrow();
    });
  });

  describe('markVerified', () => {
    it('should create new verified status', () => {
      const status = new NsfwStatus();

      const verified = status.markVerified();

      expect(verified).not.toBe(status); // New instance
      expect(verified.verified).toBe(true);
      expect(verified.verifiedAt).toBeDefined();
    });

    it('should use current time by default', () => {
      const status = new NsfwStatus();

      const verified = status.markVerified();

      expect(verified.verifiedAt).toEqual(new Date());
    });

    it('should accept custom verification time', () => {
      const status = new NsfwStatus();
      const customTime = new Date('2024-01-01T12:00:00Z');

      const verified = status.markVerified(customTime);

      expect(verified.verifiedAt).toEqual(customTime);
    });

    it('should preserve immutability', () => {
      const status = new NsfwStatus();

      status.markVerified();

      expect(status.verified).toBe(false); // Unchanged
    });
  });

  describe('clearVerification', () => {
    it('should create new unverified status', () => {
      const status = NsfwStatus.createVerified();

      const cleared = status.clearVerification();

      expect(cleared).not.toBe(status); // New instance
      expect(cleared.verified).toBe(false);
      expect(cleared.verifiedAt).toBeNull();
    });

    it('should work on already unverified status', () => {
      const status = new NsfwStatus();

      const cleared = status.clearVerification();

      expect(cleared.verified).toBe(false);
      expect(cleared.verifiedAt).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('should serialize verified status', () => {
      const verifiedAt = new Date();
      const status = new NsfwStatus(true, verifiedAt);

      const json = status.toJSON();

      expect(json).toEqual({
        verified: true,
        verifiedAt: verifiedAt.toISOString(),
      });
    });

    it('should serialize unverified status', () => {
      const status = new NsfwStatus();

      const json = status.toJSON();

      expect(json).toEqual({
        verified: false,
        verifiedAt: null,
      });
    });
  });

  describe('fromJSON', () => {
    it('should deserialize verified status', () => {
      const json = {
        verified: true,
        verifiedAt: '2024-01-01T00:00:00.000Z',
      };

      const status = NsfwStatus.fromJSON(json);

      expect(status).toBeInstanceOf(NsfwStatus);
      expect(status.verified).toBe(true);
      expect(status.verifiedAt).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    });

    it('should deserialize unverified status', () => {
      const json = {
        verified: false,
        verifiedAt: null,
      };

      const status = NsfwStatus.fromJSON(json);

      expect(status.verified).toBe(false);
      expect(status.verifiedAt).toBeNull();
    });

    it('should handle date string conversion', () => {
      const json = {
        verified: true,
        verifiedAt: '2024-01-01T00:00:00.000Z',
      };

      const status = NsfwStatus.fromJSON(json);

      expect(status.verifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('createUnverified', () => {
    it('should create unverified status', () => {
      const status = NsfwStatus.createUnverified();

      expect(status.verified).toBe(false);
      expect(status.verifiedAt).toBeNull();
    });
  });

  describe('createVerified', () => {
    it('should create verified status with current time', () => {
      const status = NsfwStatus.createVerified();

      expect(status.verified).toBe(true);
      expect(status.verifiedAt).toEqual(new Date());
    });

    it('should accept custom verification time', () => {
      const customTime = new Date('2024-01-01T12:00:00Z');
      const status = NsfwStatus.createVerified(customTime);

      expect(status.verifiedAt).toEqual(customTime);
    });
  });

  describe('immutability', () => {
    it('should not be affected by JSON modifications', () => {
      const status = NsfwStatus.createVerified();
      const json = status.toJSON();

      // Modify JSON
      json.verified = false;
      json.verifiedAt = null;

      // Original status unchanged
      expect(status.verified).toBe(true);
      expect(status.verifiedAt).toBeDefined();
    });

    it('should share date reference (current implementation)', () => {
      const verifiedAt = new Date();
      const status = new NsfwStatus(true, verifiedAt);

      // Modify original date - this WILL affect the status
      verifiedAt.setFullYear(2025);

      // Status date is changed because it shares the reference
      expect(status.verifiedAt.getFullYear()).toBe(2025);

      // Note: This is the current behavior. Consider making defensive copies
      // in the constructor if true immutability is desired
    });
  });
});
