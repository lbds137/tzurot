import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  listRailwayVariableNames: vi.fn(),
  readRailwayVariableValue: vi.fn(),
}));

import { listRailwayVariableNames, readRailwayVariableValue } from '../deployment/railway-api.js';
import {
  isWindowOpenForVerifier,
  assertPreviousReachesVerifier,
  isDegenerateWindow,
  type VerifierWindowArgs,
} from './rotate-env-window.js';

const mockListNames = vi.mocked(listRailwayVariableNames);
const mockReadValue = vi.mocked(readRailwayVariableValue);

const SENTINEL_PRIMARY_VALUE = 'sentinel-primary-value-do-not-log';
const SENTINEL_PREVIOUS_VALUE = 'sentinel-previous-value-do-not-log';

const VAR_NAME = 'INTERNAL_SERVICE_SECRET';
const PREVIOUS_NAME = `${VAR_NAME}_PREVIOUS`;
const VERIFIER = { id: 'svc-gateway', name: 'api-gateway' };

function makeArgs(overrides: Partial<VerifierWindowArgs> = {}): VerifierWindowArgs {
  return {
    context: { projectId: 'proj-1', environmentId: 'env-1' },
    env: 'dev',
    verifier: VERIFIER,
    previousName: PREVIOUS_NAME,
    ...overrides,
  };
}

function makeDegenerateArgs(
  overrides: Partial<VerifierWindowArgs> = {}
): VerifierWindowArgs & { primaryName: string } {
  return { ...makeArgs(overrides), primaryName: VAR_NAME };
}

describe('rotate-env-window', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockListNames.mockReset().mockResolvedValue([]);
    mockReadValue.mockReset().mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isWindowOpenForVerifier', () => {
    it('passes the verifier id as serviceId', async () => {
      mockListNames.mockResolvedValue([VAR_NAME]);

      await isWindowOpenForVerifier(makeArgs());

      expect(mockListNames).toHaveBeenCalledTimes(1);
      const [callArgs] = mockListNames.mock.calls[0];
      expect(callArgs.serviceId).toBe(VERIFIER.id);
      expect(callArgs.projectId).toBe('proj-1');
      expect(callArgs.environmentId).toBe('env-1');
      expect(callArgs.env).toBe('dev');
    });

    it('returns true when the name is present in the effective set', async () => {
      mockListNames.mockResolvedValue([VAR_NAME, PREVIOUS_NAME]);

      const result = await isWindowOpenForVerifier(makeArgs());

      expect(result).toBe(true);
    });

    it('returns false when the name is absent from the effective set', async () => {
      mockListNames.mockResolvedValue([VAR_NAME]);

      const result = await isWindowOpenForVerifier(makeArgs());

      expect(result).toBe(false);
    });
  });

  describe('assertPreviousReachesVerifier', () => {
    it('resolves when the name is present', async () => {
      mockListNames.mockResolvedValue([VAR_NAME, PREVIOUS_NAME]);

      await expect(assertPreviousReachesVerifier(makeArgs())).resolves.toBeUndefined();
    });

    it('throws when the name is absent', async () => {
      mockListNames.mockResolvedValue([VAR_NAME]);

      await expect(assertPreviousReachesVerifier(makeArgs())).rejects.toThrow();
    });

    it('the thrown message names the verifier and the variable, but no secret value', async () => {
      mockListNames.mockResolvedValue([VAR_NAME]);

      const error = await assertPreviousReachesVerifier(makeArgs()).catch((err: unknown) => err);

      const message = String(error);
      expect(message).toContain(VERIFIER.name);
      expect(message).toContain(PREVIOUS_NAME);
      expect(message).not.toContain(SENTINEL_PRIMARY_VALUE);
      expect(message).not.toContain(SENTINEL_PREVIOUS_VALUE);
    });

    it('the thrown message never instructs a stage 1 re-run, and says nothing was redeployed', async () => {
      mockListNames.mockResolvedValue([VAR_NAME]);

      const error = await assertPreviousReachesVerifier(makeArgs()).catch((err: unknown) => err);

      const message = String(error);
      // A re-run reads the freshly minted primary as the current value and
      // overwrites `_PREVIOUS` with it — the window is CLOSED here, so stage 1
      // never reaches the resume branch that would have made it safe.
      expect(message).not.toContain('re-run stage 1');
      expect(message).toContain('Nothing was redeployed');
      expect(message).not.toContain(SENTINEL_PRIMARY_VALUE);
      expect(message).not.toContain(SENTINEL_PREVIOUS_VALUE);
    });
  });

  describe('isDegenerateWindow', () => {
    it('returns true when the primary and _PREVIOUS values match', async () => {
      mockReadValue.mockResolvedValue(SENTINEL_PRIMARY_VALUE);

      const result = await isDegenerateWindow(makeDegenerateArgs());

      expect(result).toBe(true);
    });

    it('returns false when the primary and _PREVIOUS values differ', async () => {
      mockReadValue.mockImplementation(async args =>
        args.name === PREVIOUS_NAME ? SENTINEL_PREVIOUS_VALUE : SENTINEL_PRIMARY_VALUE
      );

      const result = await isDegenerateWindow(makeDegenerateArgs());

      expect(result).toBe(false);
    });

    it('reads the primary with NO serviceId and _PREVIOUS WITH the verifier serviceId', async () => {
      mockReadValue.mockResolvedValue(SENTINEL_PRIMARY_VALUE);

      await isDegenerateWindow(makeDegenerateArgs());

      expect(mockReadValue).toHaveBeenCalledTimes(2);
      const primaryCall = mockReadValue.mock.calls.find(([callArgs]) => callArgs.name === VAR_NAME);
      const previousCall = mockReadValue.mock.calls.find(
        ([callArgs]) => callArgs.name === PREVIOUS_NAME
      );
      expect(primaryCall).toBeDefined();
      expect(previousCall).toBeDefined();
      expect(Object.hasOwn(primaryCall?.[0] ?? {}, 'serviceId')).toBe(false);
      expect(previousCall?.[0].serviceId).toBe(VERIFIER.id);
    });
  });

  it('neither function writes anything to stdout', async () => {
    mockListNames.mockResolvedValue([VAR_NAME]);
    mockReadValue.mockResolvedValue(SENTINEL_PRIMARY_VALUE);

    await isWindowOpenForVerifier(makeArgs());
    await assertPreviousReachesVerifier(makeArgs()).catch(() => undefined);
    await isDegenerateWindow(makeDegenerateArgs());

    expect(logSpy).not.toHaveBeenCalled();
  });
});
