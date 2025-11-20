const { formatContextMetadata, formatTimestamp, getChannelPath } = require('../../../src/utils/contextMetadataFormatter');

describe('contextMetadataFormatter', () => {
  describe('formatTimestamp', () => {
    it('should format a Unix timestamp to ISO string', () => {
      const timestamp = 1720625445000; // 2024-07-10T15:30:45.000Z
      const result = formatTimestamp(timestamp);
      expect(result).toBe('2024-07-10T15:30:45.000Z');
    });

    it('should format a Date object to ISO string', () => {
      const date = new Date('2024-07-10T15:30:45.000Z');
      const result = formatTimestamp(date);
      expect(result).toBe('2024-07-10T15:30:45.000Z');
    });

    it('should return current time on invalid timestamp', () => {
      const beforeCall = new Date().toISOString();
      const result = formatTimestamp('invalid');
      const afterCall = new Date().toISOString();
      
      // Result should be between before and after call times
      expect(new Date(result).getTime()).toBeGreaterThanOrEqual(new Date(beforeCall).getTime());
      expect(new Date(result).getTime()).toBeLessThanOrEqual(new Date(afterCall).getTime());
    });
  });

  describe('getChannelPath', () => {
    it('should return "Direct Messages" for DM channels', () => {
      const channel = { type: 1 };
      expect(getChannelPath(channel)).toBe('Direct Messages');
    });

    it('should format regular guild channels', () => {
      const channel = { type: 0, name: 'general' };
      expect(getChannelPath(channel)).toBe('#general');
    });

    it('should format public threads with parent channel', () => {
      const channel = {
        type: 11,
        name: 'My Thread',
        parent: { name: 'general' }
      };
      expect(getChannelPath(channel)).toBe('#general > My Thread');
    });

    it('should format private threads with parent channel', () => {
      const channel = {
        type: 12,
        name: 'Private Thread',
        parent: { name: 'staff' }
      };
      expect(getChannelPath(channel)).toBe('#staff > Private Thread');
    });

    it('should format forum posts with parent forum', () => {
      const channel = {
        type: 15,
        name: 'Help Request',
        parent: { name: 'support' }
      };
      expect(getChannelPath(channel)).toBe('#support > Help Request');
    });

    it('should handle missing parent gracefully', () => {
      const channel = {
        type: 11,
        name: 'Orphan Thread'
      };
      expect(getChannelPath(channel)).toBe('#unknown-channel > Orphan Thread');
    });

    it('should handle missing channel name', () => {
      const channel = { type: 0 };
      expect(getChannelPath(channel)).toBe('#unknown-channel');
    });

    it('should return #unknown on error', () => {
      const channel = null;
      expect(getChannelPath(channel)).toBe('#unknown');
    });
  });

  describe('formatContextMetadata', () => {
    it('should format metadata for guild messages', () => {
      const message = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      const result = formatContextMetadata(message);
      expect(result).toBe('[Discord: Test Server > #general | 2024-07-10T15:30:45.000Z]');
    });

    it('should format metadata for DM messages', () => {
      const message = {
        guild: null,
        channel: { type: 1 },
        createdTimestamp: 1720625445000
      };
      
      const result = formatContextMetadata(message);
      expect(result).toBe('[Discord: Direct Messages | 2024-07-10T15:30:45.000Z]');
    });

    it('should format metadata for thread messages', () => {
      const message = {
        guild: { name: 'Cool Server' },
        channel: {
          type: 11,
          name: 'Discussion Thread',
          parent: { name: 'general' }
        },
        createdTimestamp: 1720625445000
      };
      
      const result = formatContextMetadata(message);
      expect(result).toBe('[Discord: Cool Server > #general > Discussion Thread | 2024-07-10T15:30:45.000Z]');
    });

    it('should format metadata for forum posts', () => {
      const message = {
        guild: { name: 'Help Server' },
        channel: {
          type: 15,
          name: 'How to use bot?',
          parent: { name: 'support' }
        },
        createdTimestamp: 1720625445000
      };
      
      const result = formatContextMetadata(message);
      expect(result).toBe('[Discord: Help Server > #support > How to use bot? | 2024-07-10T15:30:45.000Z]');
    });

    it('should use current time if createdTimestamp is missing', () => {
      const message = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' }
      };
      
      const beforeCall = Date.now();
      const result = formatContextMetadata(message);
      const afterCall = Date.now();
      
      // Extract timestamp from result
      const timestampMatch = result.match(/\[Discord: (.*?) > (.*?) \| (.*?)\]/);
      expect(timestampMatch).toBeTruthy();
      
      const timestamp = new Date(timestampMatch[3]).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(beforeCall);
      expect(timestamp).toBeLessThanOrEqual(afterCall);
    });

    it('should handle errors gracefully', () => {
      const message = null;
      const result = formatContextMetadata(message);
      
      // Should still return a valid format
      expect(result).toMatch(/^\[Discord: Unknown \| \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]$/);
    });
  });
});