import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  deleteRailwayVariable: vi.fn(),
  listRailwayVariableNames: vi.fn(),
  readRailwayVariableValue: vi.fn(),
  upsertRailwayVariable: vi.fn(),
}));

import {
  deleteRailwayVariable,
  listRailwayVariableNames,
  readRailwayVariableValue,
  upsertRailwayVariable,
} from '../deployment/railway-api.js';
import {
  isWindowOpenForVerifier,
  assertPreviousReachesVerifier,
  isDegenerateWindow,
  readRollMarkerValue,
  writeRollMarker,
  isRollComplete,
  deleteRollMarker,
  rollMarkerName,
  type RollMarkerArgs,
  type VerifierWindowArgs,
} from './rotate-env-window.js';

const mockDelete = vi.mocked(deleteRailwayVariable);
const mockListNames = vi.mocked(listRailwayVariableNames);
const mockReadValue = vi.mocked(readRailwayVariableValue);
const mockUpsert = vi.mocked(upsertRailwayVariable);

const SENTINEL_PRIMARY_VALUE = 'sentinel-primary-value-do-not-log';
const SENTINEL_PREVIOUS_VALUE = 'sentinel-previous-value-do-not-log';
const SENTINEL_PRIMARY_HASH = crypto
  .createHash('sha256')
  .update(SENTINEL_PRIMARY_VALUE)
  .digest('hex');
const SENTINEL_OTHER_HASH = crypto
  .createHash('sha256')
  .update(SENTINEL_PREVIOUS_VALUE)
  .digest('hex');

const VAR_NAME = 'INTERNAL_SERVICE_SECRET';
const PREVIOUS_NAME = `${VAR_NAME}_PREVIOUS`;
const ROLLED_NAME = rollMarkerName(VAR_NAME);
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

function makeRollMarkerArgs(overrides: Partial<RollMarkerArgs> = {}): RollMarkerArgs {
  return {
    context: { projectId: 'proj-1', environmentId: 'env-1' },
    env: 'dev',
    verifier: VERIFIER,
    primaryName: VAR_NAME,
    ...overrides,
  };
}

describe('rotate-env-window', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockListNames.mockReset().mockResolvedValue([]);
    mockReadValue.mockReset().mockResolvedValue(undefined);
    mockUpsert.mockReset().mockResolvedValue(undefined);
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

  describe('readRollMarkerValue', () => {
    it('reads the primary at the shared tier and returns its sha256 hex hash without upserting', async () => {
      mockReadValue.mockResolvedValue(SENTINEL_PRIMARY_VALUE);

      const value = await readRollMarkerValue(makeRollMarkerArgs());

      expect(value).toBe(SENTINEL_PRIMARY_HASH);
      expect(mockReadValue).toHaveBeenCalledTimes(1);
      const [readArgs] = mockReadValue.mock.calls[0];
      expect(readArgs.name).toBe(VAR_NAME);
      expect(Object.hasOwn(readArgs, 'serviceId')).toBe(false);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'undefined', value: undefined },
      { label: 'empty', value: '' },
    ])(
      'throws naming the variable and never a value or hash when the primary read is $label',
      async ({ value }) => {
        mockReadValue.mockResolvedValue(value);

        const error = await readRollMarkerValue(makeRollMarkerArgs()).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(Error);
        const message = String(error);
        expect(message).toContain(VAR_NAME);
        expect(message).not.toContain(SENTINEL_PRIMARY_VALUE);
        expect(message).not.toContain(SENTINEL_PRIMARY_HASH);
        expect(mockUpsert).not.toHaveBeenCalled();
      }
    );
  });

  describe('writeRollMarker', () => {
    it('upserts <NAME>_ROLLED in the verifier scope with skipDeploys without reading', async () => {
      await writeRollMarker(makeRollMarkerArgs(), SENTINEL_PRIMARY_HASH);

      expect(mockReadValue).not.toHaveBeenCalled();
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledWith({
        projectId: 'proj-1',
        environmentId: 'env-1',
        serviceId: VERIFIER.id,
        name: ROLLED_NAME,
        value: SENTINEL_PRIMARY_HASH,
        skipDeploys: true,
        env: 'dev',
      });
    });
  });

  describe('isRollComplete', () => {
    it('returns true when the marker matches the sha256 of a non-empty primary', async () => {
      mockReadValue.mockImplementation(async args =>
        args.name === ROLLED_NAME ? SENTINEL_PRIMARY_HASH : SENTINEL_PRIMARY_VALUE
      );

      const result = await isRollComplete(makeRollMarkerArgs());

      expect(result).toBe(true);
      const primaryCall = mockReadValue.mock.calls.find(([callArgs]) => callArgs.name === VAR_NAME);
      const markerCall = mockReadValue.mock.calls.find(
        ([callArgs]) => callArgs.name === ROLLED_NAME
      );
      expect(Object.hasOwn(primaryCall?.[0] ?? {}, 'serviceId')).toBe(false);
      expect(markerCall?.[0].serviceId).toBe(VERIFIER.id);
    });

    it('returns false when the marker is absent', async () => {
      mockReadValue.mockImplementation(async args =>
        args.name === ROLLED_NAME ? undefined : SENTINEL_PRIMARY_VALUE
      );

      const result = await isRollComplete(makeRollMarkerArgs());

      expect(result).toBe(false);
    });

    it('returns false when the marker mismatches the current primary hash', async () => {
      mockReadValue.mockImplementation(async args =>
        args.name === ROLLED_NAME ? SENTINEL_OTHER_HASH : SENTINEL_PRIMARY_VALUE
      );

      const result = await isRollComplete(makeRollMarkerArgs());

      expect(result).toBe(false);
    });

    it('returns false when the primary is undefined', async () => {
      mockReadValue.mockImplementation(async args =>
        args.name === ROLLED_NAME ? SENTINEL_PRIMARY_HASH : undefined
      );

      const result = await isRollComplete(makeRollMarkerArgs());

      expect(result).toBe(false);
    });

    it('returns false when the primary is empty, even if the marker hashes the empty string', async () => {
      const emptyHash = crypto.createHash('sha256').update('').digest('hex');
      mockReadValue.mockImplementation(async args => (args.name === ROLLED_NAME ? emptyHash : ''));

      const result = await isRollComplete(makeRollMarkerArgs());

      expect(result).toBe(false);
    });
  });

  describe('deleteRollMarker', () => {
    it('deletes <NAME>_ROLLED from the verifier scope', async () => {
      await deleteRollMarker(makeRollMarkerArgs());

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith({
        projectId: 'proj-1',
        environmentId: 'env-1',
        serviceId: VERIFIER.id,
        name: ROLLED_NAME,
        env: 'dev',
      });
    });
  });

  it('no helper writes any secret value or hash to stdout', async () => {
    mockListNames.mockResolvedValue([VAR_NAME]);
    mockReadValue.mockResolvedValue(SENTINEL_PRIMARY_VALUE);

    await isWindowOpenForVerifier(makeArgs());
    await assertPreviousReachesVerifier(makeArgs()).catch(() => undefined);
    await isDegenerateWindow(makeDegenerateArgs());
    const markerValue = await readRollMarkerValue(makeRollMarkerArgs());
    await writeRollMarker(makeRollMarkerArgs(), markerValue);
    await isRollComplete(makeRollMarkerArgs());
    await deleteRollMarker(makeRollMarkerArgs());

    expect(logSpy).not.toHaveBeenCalled();
  });
});
