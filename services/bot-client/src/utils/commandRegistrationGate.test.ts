/**
 * Tests for commandRegistrationGate
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  shouldAutoRegisterCommands,
  hashCommandBody,
  deployedCommandsKey,
} from './commandRegistrationGate.js';

describe('shouldAutoRegisterCommands', () => {
  it('is off when RAILWAY_ENVIRONMENT_NAME is unset', () => {
    expect(shouldAutoRegisterCommands({ RAILWAY_ENVIRONMENT_NAME: undefined })).toBe(false);
  });

  it('is on when RAILWAY_ENVIRONMENT_NAME is a non-empty string', () => {
    expect(shouldAutoRegisterCommands({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(true);
    expect(shouldAutoRegisterCommands({ RAILWAY_ENVIRONMENT_NAME: 'development' })).toBe(true);
  });

  it('is off when RAILWAY_ENVIRONMENT_NAME is an empty string', () => {
    expect(shouldAutoRegisterCommands({ RAILWAY_ENVIRONMENT_NAME: '' })).toBe(false);
  });
});

describe('hashCommandBody', () => {
  it('is stable for equal input', () => {
    const body = [{ name: 'foo' }, { name: 'bar' }];
    expect(hashCommandBody(body)).toBe(hashCommandBody([{ name: 'foo' }, { name: 'bar' }]));
  });

  it('is independent of command order', () => {
    expect(hashCommandBody([{ name: 'a' }, { name: 'b' }])).toBe(
      hashCommandBody([{ name: 'b' }, { name: 'a' }])
    );
  });

  it('differs for different input', () => {
    expect(hashCommandBody([{ name: 'foo' }])).not.toBe(hashCommandBody([{ name: 'bar' }]));
  });

  it('matches an independently-computed sha256 of the JSON body', () => {
    const body = [{ name: 'foo', options: [1, 2, 3] }, { name: 'bar' }];
    const canonical = body.map(command => JSON.stringify(command)).sort();
    const expected = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    expect(hashCommandBody(body)).toBe(expected);
  });
});

describe('deployedCommandsKey', () => {
  it('keys global and guild registrations separately', () => {
    const globalKey = deployedCommandsKey('client-1', { global: true });
    const guildKey = deployedCommandsKey('client-1', { global: false, guildId: 'guild-9' });

    expect(globalKey).not.toBe(guildKey);
    expect(globalKey).toBe('bot:commands:deployed:client-1:global');
    expect(guildKey).toBe('bot:commands:deployed:client-1:guild:guild-9');
  });
});
