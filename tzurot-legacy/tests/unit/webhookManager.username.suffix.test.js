// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

const { getStandardizedUsername } = require('../../src/webhookManager');

// Mock global.tzurotClient
global.tzurotClient = {
  user: {
    tag: 'Tzurot | Test Server',
  },
};

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('Webhook Username Suffix', () => {
  it('should append bot suffix to display name', () => {
    const personality = {
      fullName: 'albert-einstein',
      profile: {
        displayName: 'Albert Einstein',
      },
      avatarUrl: 'https://example.com/avatar.png',
    };

    const username = getStandardizedUsername(personality);
    expect(username).toBe('Albert Einstein | Test Server');

    // Test with inconsistent spacing in the bot tag
    const originalTag = global.tzurotClient.user.tag;
    global.tzurotClient.user.tag = 'Tzurot |  Test Server';

    const username2 = getStandardizedUsername(personality);
    expect(username2).toBe('Albert Einstein | Test Server');

    // Restore original tag
    global.tzurotClient.user.tag = originalTag;
  });

  it('should handle long display names and truncate properly', () => {
    const personality = {
      fullName: 'long-name',
      profile: {
        displayName: 'This is a very very very long display name that exceeds limit',
      },
      avatarUrl: 'https://example.com/avatar.png',
    };

    const username = getStandardizedUsername(personality);
    const expectedSuffix = ' | Test Server';
    const maxNameLength = 29 - expectedSuffix.length;

    expect(username).toBe(
      `${personality.profile.displayName.substring(0, maxNameLength)}...${expectedSuffix}`
    );
    expect(username.length).toBeLessThanOrEqual(32);
  });

  it('should handle missing display name and use fullName', () => {
    const personality = {
      fullName: 'marie-curie',
      avatarUrl: 'https://example.com/avatar.png',
    };

    const username = getStandardizedUsername(personality);
    expect(username).toBe('Marie | Test Server');
  });

  it('should handle null/undefined personality', () => {
    const username = getStandardizedUsername(null);
    expect(username).toBe('Bot');
  });

  it('should work when bot has no suffix', () => {
    // Temporarily modify the global
    const originalTag = global.tzurotClient.user.tag;
    global.tzurotClient.user.tag = 'Tzurot';

    const personality = {
      fullName: 'sigmund-freud',
      profile: {
        displayName: 'Sigmund Freud',
      },
      avatarUrl: 'https://example.com/avatar.png',
    };

    const username = getStandardizedUsername(personality);
    expect(username).toBe('Sigmund Freud');

    // Restore the global
    global.tzurotClient.user.tag = originalTag;
  });

  it('should remove Discord discriminator from suffix', () => {
    // Temporarily modify the global
    const originalTag = global.tzurotClient.user.tag;
    global.tzurotClient.user.tag = 'Tzurot | Test Server#1234';

    const personality = {
      fullName: 'carl-jung',
      profile: {
        displayName: 'Carl Jung',
      },
      avatarUrl: 'https://example.com/avatar.png',
    };

    const username = getStandardizedUsername(personality);
    expect(username).toBe('Carl Jung | Test Server');
    expect(username.includes('#1234')).toBe(false);

    // Test with a space before the discriminator
    global.tzurotClient.user.tag = 'Tzurot | Test Server #9999';
    const username2 = getStandardizedUsername(personality);
    expect(username2).toBe('Carl Jung | Test Server');
    expect(username2.includes('#9999')).toBe(false);

    // Restore the global
    global.tzurotClient.user.tag = originalTag;
  });

  it('should work when global.tzurotClient is undefined', () => {
    // Temporarily remove the global
    const originalClient = global.tzurotClient;
    global.tzurotClient = undefined;

    const personality = {
      fullName: 'carl-jung',
      profile: {
        displayName: 'Carl Jung',
      },
      avatarUrl: 'https://example.com/avatar.png',
    };

    const username = getStandardizedUsername(personality);
    expect(username).toBe('Carl Jung');

    // Restore the global
    global.tzurotClient = originalClient;
  });
});
