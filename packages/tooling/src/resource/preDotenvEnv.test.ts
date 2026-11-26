import { afterEach, describe, expect, it } from 'vitest';

import {
  profileEnvView,
  recordPreDotenvProfileEnv,
  resetPreDotenvProfileEnv,
} from './preDotenvEnv.js';

afterEach(() => {
  resetPreDotenvProfileEnv();
});

describe('profileEnvView', () => {
  it('returns the env unchanged when nothing was recorded', () => {
    const env = { RESOURCE_PROFILE: 'cloud', OTHER: 'x' };
    expect(profileEnvView(env)).toBe(env);
  });

  it('swaps both profile keys back to their recorded values and keeps the rest', () => {
    recordPreDotenvProfileEnv({ LOW_RESOURCE_MODE: '1', OTHER: 'ignored' });
    const view = profileEnvView({
      LOW_RESOURCE_MODE: '1',
      RESOURCE_PROFILE: 'cloud',
      OTHER: 'kept',
    });
    expect(view).toEqual({ LOW_RESOURCE_MODE: '1', OTHER: 'kept' });
  });

  it('restores a key that dotenv overwrote with a different value', () => {
    recordPreDotenvProfileEnv({ RESOURCE_PROFILE: 'low' });
    expect(profileEnvView({ RESOURCE_PROFILE: 'full', LOW_RESOURCE_MODE: '0' })).toEqual({
      RESOURCE_PROFILE: 'low',
    });
  });

  it('restores a NODE_OPTIONS that dotenv overwrote and deletes one it added', () => {
    recordPreDotenvProfileEnv({ NODE_OPTIONS: '--max-old-space-size=2048' });
    expect(profileEnvView({ NODE_OPTIONS: '--max-old-space-size=9999' })).toEqual({
      NODE_OPTIONS: '--max-old-space-size=2048',
    });
    resetPreDotenvProfileEnv();
    recordPreDotenvProfileEnv({});
    expect(profileEnvView({ NODE_OPTIONS: '--max-old-space-size=9999' })).toEqual({});
  });

  it('never mutates the env it is given', () => {
    recordPreDotenvProfileEnv({});
    const env = { RESOURCE_PROFILE: 'cloud' };
    profileEnvView(env);
    expect(env).toEqual({ RESOURCE_PROFILE: 'cloud' });
  });
});
