import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFileSync: execFileSyncMock }));

import {
  getServiceClientForEnv,
  resolveServiceClientOrExit,
  getUserClientForEnv,
  getBotOwnerDiscordIdForEnv,
} from './gateway-client.js';

const BOT_OWNER_ID = '900000000000000099';

const RAILWAY_VARS = {
  PUBLIC_GATEWAY_URL: 'https://api-gateway-development.up.railway.app',
  RAILWAY_PUBLIC_DOMAIN: 'api-gateway-development.up.railway.app',
  INTERNAL_SERVICE_SECRET: 'secret-value',
  BOT_OWNER_ID,
};

describe('getServiceClientForEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execFileSyncMock.mockReturnValue(JSON.stringify(RAILWAY_VARS));
  });

  it('reads the gateway credentials from the api-gateway Railway service', () => {
    const client = getServiceClientForEnv('dev');

    expect(client).toBeDefined();
    // Array args (never string interpolation) and the mapped Railway env name.
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'railway',
      ['variables', '--environment', 'development', '--service', 'api-gateway', '--json'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('maps prod to the production Railway environment', () => {
    getServiceClientForEnv('prod');

    expect(execFileSyncMock.mock.calls[0][1]).toContain('production');
  });

  it('falls back to the public domain when PUBLIC_GATEWAY_URL is unset', () => {
    const { PUBLIC_GATEWAY_URL: _dropped, ...withoutUrl } = RAILWAY_VARS;
    execFileSyncMock.mockReturnValue(JSON.stringify(withoutUrl));

    // Constructs without throwing — the bare domain gets an https:// scheme.
    expect(() => getServiceClientForEnv('dev')).not.toThrow();
  });

  it('throws an actionable error naming the missing secret', () => {
    execFileSyncMock.mockReturnValue(
      JSON.stringify({ PUBLIC_GATEWAY_URL: RAILWAY_VARS.PUBLIC_GATEWAY_URL })
    );

    // An opaque 401 later is much worse than a named variable now.
    expect(() => getServiceClientForEnv('dev')).toThrow(/INTERNAL_SERVICE_SECRET/);
    expect(() => getServiceClientForEnv('dev')).toThrow(/api-gateway/);
  });

  it('reads local credentials from the ambient env, not Railway', () => {
    const prevUrl = process.env.PUBLIC_GATEWAY_URL;
    const prevSecret = process.env.INTERNAL_SERVICE_SECRET;
    process.env.PUBLIC_GATEWAY_URL = 'http://localhost:3000';
    process.env.INTERNAL_SERVICE_SECRET = 'local-secret';
    try {
      expect(getServiceClientForEnv('local')).toBeDefined();
      expect(execFileSyncMock).not.toHaveBeenCalled();
    } finally {
      process.env.PUBLIC_GATEWAY_URL = prevUrl;
      process.env.INTERNAL_SERVICE_SECRET = prevSecret;
    }
  });

  it('throws when the local gateway URL is unset', () => {
    const prevUrl = process.env.PUBLIC_GATEWAY_URL;
    const prevGateway = process.env.GATEWAY_URL;
    delete process.env.PUBLIC_GATEWAY_URL;
    delete process.env.GATEWAY_URL;
    try {
      expect(() => getServiceClientForEnv('local')).toThrow(/PUBLIC_GATEWAY_URL/);
    } finally {
      process.env.PUBLIC_GATEWAY_URL = prevUrl;
      process.env.GATEWAY_URL = prevGateway;
    }
  });
});

describe('resolveServiceClientOrExit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    execFileSyncMock.mockReturnValue(JSON.stringify(RAILWAY_VARS));
  });

  it('returns the client and leaves the exit code alone on success', () => {
    expect(resolveServiceClientOrExit('dev')).not.toBeNull();
    expect(process.exitCode).toBeUndefined();
  });

  it('reports the actionable message and exits nonzero instead of throwing', () => {
    // Credential resolution fails routinely (Railway CLI not logged in, a
    // missing variable). Every gateway-backed command routes through here, so
    // an uncaught throw would surface as an unhandled rejection in all of them.
    execFileSyncMock.mockImplementation(() => {
      throw new Error('Check that the Railway CLI is logged in');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(resolveServiceClientOrExit('prod')).toBeNull();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Railway CLI is logged in'));
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });
});

describe('getUserClientForEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execFileSyncMock.mockReturnValue(JSON.stringify(RAILWAY_VARS));
  });

  it('acts as the bot owner by default', () => {
    const { client, actingDiscordId, isBotOwner } = getUserClientForEnv('dev');

    expect(actingDiscordId).toBe(BOT_OWNER_ID);
    expect(isBotOwner).toBe(true);
    expect(client.actor).toBe(BOT_OWNER_ID);
    expect(client.user).toEqual({
      discordId: BOT_OWNER_ID,
      username: BOT_OWNER_ID,
      displayName: BOT_OWNER_ID,
      isBot: false,
    });
  });

  it('an explicit --as-user overrides the bot owner and is not flagged as owner', () => {
    const otherUser = '900000000000000001';
    const { actingDiscordId, isBotOwner } = getUserClientForEnv('dev', otherUser);

    expect(actingDiscordId).toBe(otherUser);
    expect(isBotOwner).toBe(false);
  });

  it('--as-user equal to the bot owner id is still flagged as owner', () => {
    const { isBotOwner } = getUserClientForEnv('dev', BOT_OWNER_ID);

    expect(isBotOwner).toBe(true);
  });

  it('throws an actionable error naming BOT_OWNER_ID when neither is available', () => {
    const { BOT_OWNER_ID: _dropped, ...withoutOwner } = RAILWAY_VARS;
    execFileSyncMock.mockReturnValue(JSON.stringify(withoutOwner));

    expect(() => getUserClientForEnv('dev')).toThrow(/BOT_OWNER_ID/);
  });

  it('throws on a malformed --as-user rather than sending a bad snowflake', () => {
    expect(() => getUserClientForEnv('dev', 'not-a-snowflake')).toThrow(/snowflake/);
    expect(() => getUserClientForEnv('dev', '123')).toThrow(/snowflake/);
  });

  it('CANARY: validates --as-user before reading Railway credentials', () => {
    expect(() => getUserClientForEnv('dev', 'not-a-snowflake')).toThrow(/snowflake/);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('never prints the bot owner id or the service secret', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    getUserClientForEnv('dev');

    for (const call of logSpy.mock.calls) {
      const line = call.join(' ');
      expect(line).not.toContain(BOT_OWNER_ID);
      expect(line).not.toContain(RAILWAY_VARS.INTERNAL_SERVICE_SECRET);
    }
    logSpy.mockRestore();
  });
});

describe('getBotOwnerDiscordIdForEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execFileSyncMock.mockReturnValue(JSON.stringify(RAILWAY_VARS));
  });

  it('reads BOT_OWNER_ID from the api-gateway Railway service for dev', () => {
    expect(getBotOwnerDiscordIdForEnv('dev')).toBe(BOT_OWNER_ID);
    expect(execFileSyncMock.mock.calls[0][1]).toContain('api-gateway');
  });

  it('reads the ambient env for local, never Railway', () => {
    const prev = process.env.BOT_OWNER_ID;
    process.env.BOT_OWNER_ID = '800000000000000088';
    try {
      expect(getBotOwnerDiscordIdForEnv('local')).toBe('800000000000000088');
      expect(execFileSyncMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.BOT_OWNER_ID;
      } else {
        process.env.BOT_OWNER_ID = prev;
      }
    }
  });

  it('throws naming BOT_OWNER_ID when unset on Railway', () => {
    const { BOT_OWNER_ID: _dropped, ...withoutOwner } = RAILWAY_VARS;
    execFileSyncMock.mockReturnValue(JSON.stringify(withoutOwner));

    expect(() => getBotOwnerDiscordIdForEnv('prod')).toThrow(/BOT_OWNER_ID/);
  });

  it('treats an empty BOT_OWNER_ID as unset', () => {
    execFileSyncMock.mockReturnValue(JSON.stringify({ ...RAILWAY_VARS, BOT_OWNER_ID: '' }));

    expect(() => getBotOwnerDiscordIdForEnv('dev')).toThrow(/BOT_OWNER_ID/);
  });

  it('throws naming BOT_OWNER_ID when unset locally', () => {
    const prev = process.env.BOT_OWNER_ID;
    delete process.env.BOT_OWNER_ID;
    try {
      expect(() => getBotOwnerDiscordIdForEnv('local')).toThrow(/BOT_OWNER_ID/);
    } finally {
      if (prev !== undefined) {
        process.env.BOT_OWNER_ID = prev;
      }
    }
  });
});
