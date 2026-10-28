/**
 * Tests for BYOK stage 2's redeploy-then-reencrypt ordering. Everything the stage
 * touches is injected, so call order and "reencrypt never ran" are observable.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseEncryptionKeyMaterial } from '@tzurot/common-types/utils/encryption';
import { BYOK_REDEPLOY_WORDING, reencryptByokRows } from './byok-reencrypt-stage.js';
import type { ByokServiceIds } from './byok-stage-helpers.js';
import { RailwayRedeployRefusedError } from '../deployment/railway-api.js';
import { redeployAndWaitForService } from './service-redeploy-wait.js';

const KEY_A_HEX = 'a'.repeat(64);
const KEY_B_HEX = 'b'.repeat(64);

const IDS: ByokServiceIds = {
  'api-gateway': { projectId: 'proj', environmentId: 'env-gw', serviceId: 'svc-gateway' },
  'ai-worker': { projectId: 'proj', environmentId: 'env-worker', serviceId: 'svc-worker' },
};

type StageDeps = Parameters<typeof reencryptByokRows>[0];

function makeDeps(vars: Record<string, string>, overrides: Partial<StageDeps> = {}): StageDeps {
  return {
    env: 'dev',
    getServiceVariable: vi.fn((_env: string, _service: string, key: string) => vars[key] ?? ''),
    getServiceVariableOrEmpty: vi.fn(
      (_env: string, _service: string, key: string) => vars[key] ?? ''
    ),
    resolveByokIds: vi.fn(() => IDS),
    assertServiceDeploymentReady: vi.fn().mockResolvedValue(undefined),
    redeployAndWait: vi.fn().mockResolvedValue('dep-new'),
    assertServicesConsistent: vi.fn(),
    reencryptAndVerify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const OPEN_WINDOW = {
  API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
  API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX,
};

function expectNothingChanged(deps: StageDeps): void {
  expect(deps.redeployAndWait).not.toHaveBeenCalled();
  expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
}

describe('reencryptByokRows', () => {
  describe('window refusals come before any redeploy', () => {
    it('refuses a missing CURRENT before any redeploy', async () => {
      const deps = makeDeps({ API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_B_HEX });

      await expect(reencryptByokRows(deps)).rejects.toThrow('API_KEY_ENCRYPTION_KEY');
      expectNothingChanged(deps);
      expect(deps.assertServiceDeploymentReady).not.toHaveBeenCalled();
    });

    it('refuses an empty PREVIOUS before any redeploy', async () => {
      const deps = makeDeps({ API_KEY_ENCRYPTION_KEY: KEY_A_HEX });

      await expect(reencryptByokRows(deps)).rejects.toThrow(
        'No rotation window is open (PREVIOUS is empty) — run stage 1 first.'
      );
      expectNothingChanged(deps);
      expect(deps.assertServiceDeploymentReady).not.toHaveBeenCalled();
    });

    it('refuses PREVIOUS equal to CURRENT before any redeploy', async () => {
      const deps = makeDeps({
        API_KEY_ENCRYPTION_KEY: KEY_A_HEX,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_A_HEX,
      });

      await expect(reencryptByokRows(deps)).rejects.toThrow(
        'PREVIOUS equals CURRENT (an interrupted stage 1). Re-run stage 1.'
      );
      expectNothingChanged(deps);
      expect(deps.assertServiceDeploymentReady).not.toHaveBeenCalled();
    });

    it('refuses a service that is not ready before any redeploy', async () => {
      const deps = makeDeps(OPEN_WINDOW, {
        assertServiceDeploymentReady: vi.fn().mockRejectedValue(new Error('ai-worker is FAILED')),
      });

      await expect(reencryptByokRows(deps)).rejects.toThrow('ai-worker is FAILED');
      expectNothingChanged(deps);
    });
  });

  it('redeploys api-gateway then ai-worker, one at a time, and only then re-encrypts with the parsed keys', async () => {
    const calls: string[] = [];
    const deps = makeDeps(OPEN_WINDOW, {
      redeployAndWait: vi.fn(async ({ service }: { service: { name: string } }) => {
        calls.push(`start:${service.name}`);
        await Promise.resolve();
        calls.push(`end:${service.name}`);
        return 'dep-new';
      }),
      reencryptAndVerify: vi.fn(async () => {
        calls.push('reencrypt');
      }),
    });

    await reencryptByokRows(deps);

    expect(calls).toEqual([
      'start:api-gateway',
      'end:api-gateway',
      'start:ai-worker',
      'end:ai-worker',
      'reencrypt',
    ]);
    expect(deps.redeployAndWait).toHaveBeenNthCalledWith(1, {
      environmentId: 'env-gw',
      service: { id: 'svc-gateway', name: 'api-gateway' },
      env: 'dev',
      wording: BYOK_REDEPLOY_WORDING,
    });
    expect(deps.redeployAndWait).toHaveBeenNthCalledWith(2, {
      environmentId: 'env-worker',
      service: { id: 'svc-worker', name: 'ai-worker' },
      env: 'dev',
      wording: BYOK_REDEPLOY_WORDING,
    });
    expect(deps.reencryptAndVerify).toHaveBeenCalledWith(
      parseEncryptionKeyMaterial(KEY_A_HEX, 'TEST'),
      parseEncryptionKeyMaterial(KEY_B_HEX, 'TEST')
    );
    expect(deps.getServiceVariable).toHaveBeenCalledWith(
      'dev',
      'api-gateway',
      'API_KEY_ENCRYPTION_KEY'
    );
  });

  it('runs the readiness preflight for both services before the first redeploy', async () => {
    const deps = makeDeps(OPEN_WINDOW);

    await reencryptByokRows(deps);

    expect(deps.assertServiceDeploymentReady).toHaveBeenCalledTimes(2);
    expect(deps.assertServiceDeploymentReady).toHaveBeenNthCalledWith(1, {
      environmentId: 'env-gw',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      env: 'dev',
    });
    expect(deps.assertServiceDeploymentReady).toHaveBeenNthCalledWith(2, {
      environmentId: 'env-worker',
      serviceId: 'svc-worker',
      serviceName: 'ai-worker',
      env: 'dev',
    });
    const lastReady = vi.mocked(deps.assertServiceDeploymentReady).mock.invocationCallOrder[1];
    const firstRedeploy = vi.mocked(deps.redeployAndWait).mock.invocationCallOrder[0];
    expect(lastReady).toBeLessThan(firstRedeploy);
  });

  it('never re-encrypts or redeploys ai-worker when the api-gateway wait fails', async () => {
    const deps = makeDeps(OPEN_WINDOW, {
      redeployAndWait: vi.fn().mockRejectedValueOnce(new Error('gateway wait failed')),
    });

    await expect(reencryptByokRows(deps)).rejects.toThrow('gateway wait failed');
    expect(deps.redeployAndWait).toHaveBeenCalledTimes(1);
    expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
  });

  it('never re-encrypts when the ai-worker wait fails after api-gateway succeeded', async () => {
    const deps = makeDeps(OPEN_WINDOW, {
      redeployAndWait: vi
        .fn()
        .mockResolvedValueOnce('dep-gw')
        .mockRejectedValueOnce(new Error('worker wait failed')),
    });

    await expect(reencryptByokRows(deps)).rejects.toThrow('worker wait failed');
    expect(deps.redeployAndWait).toHaveBeenCalledTimes(2);
    expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
  });

  describe('key re-read after the waits', () => {
    const KEY_C_HEX = 'c'.repeat(64);
    const CHANGED_MESSAGE =
      'The rotation keys changed in Railway while BYOK stage 2 waited for the redeploys — no row has been re-encrypted; re-run BYOK stage 2, which re-reads them.';

    /** Deps whose second redeploy wait rewrites the given Railway variables, as a concurrent edit would. */
    function depsChangedDuringWaits(change: Record<string, string>): StageDeps {
      const vars: Record<string, string> = { ...OPEN_WINDOW };
      return makeDeps(vars, {
        redeployAndWait: vi.fn(async ({ service }: { service: { name: string } }) => {
          if (service.name === 'ai-worker') {
            Object.assign(vars, change);
          }
          return 'dep-new';
        }),
      });
    }

    /**
     * Deps over one variable map per service. `getServiceVariable` throws on an absent
     * variable like the real one, and the consistency stub compares the two services'
     * maps at call time, so a change on ai-worker alone is only visible through it.
     */
    function depsWithPerServiceVars(
      onWorkerWait: (workerVars: Record<string, string>) => void
    ): StageDeps {
      const byService: Record<string, Record<string, string>> = {
        'api-gateway': { ...OPEN_WINDOW },
        'ai-worker': { ...OPEN_WINDOW },
      };
      const readOrEmpty = (_env: string, service: string, key: string): string =>
        byService[service][key] ?? '';
      return makeDeps(
        {},
        {
          getServiceVariable: vi.fn((env: string, service: string, key: string) => {
            if (byService[service][key] === undefined) {
              throw new Error(`${key} not found on ${service} (${env})`);
            }
            return byService[service][key];
          }),
          getServiceVariableOrEmpty: vi.fn(readOrEmpty),
          assertServicesConsistent: vi.fn(() => {
            for (const key of Object.keys(OPEN_WINDOW)) {
              if (readOrEmpty('dev', 'api-gateway', key) !== readOrEmpty('dev', 'ai-worker', key)) {
                throw new Error(`${key} DIFFERS between api-gateway and ai-worker (dev)`);
              }
            }
          }),
          redeployAndWait: vi.fn(async ({ service }: { service: { name: string } }) => {
            if (service.name === 'ai-worker') {
              onWorkerWait(byService['ai-worker']);
            }
            return 'dep-new';
          }),
        }
      );
    }

    it.each(['API_KEY_ENCRYPTION_KEY', 'API_KEY_ENCRYPTION_KEY_PREVIOUS'])(
      'refuses without re-encrypting when only ai-worker %s changed during the waits',
      async key => {
        const deps = depsWithPerServiceVars(workerVars => {
          workerVars[key] = KEY_C_HEX;
        });

        await expect(reencryptByokRows(deps)).rejects.toThrow('DIFFERS between api-gateway');
        expect(deps.redeployAndWait).toHaveBeenCalledTimes(2);
        expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
      }
    );

    it('proceeds when both services still agree after the waits', async () => {
      const deps = depsWithPerServiceVars(() => undefined);

      await reencryptByokRows(deps);

      expect(deps.assertServicesConsistent).toHaveBeenCalledWith('dev');
      expect(deps.reencryptAndVerify).toHaveBeenCalledTimes(1);
    });

    it('refuses with the changed-keys message, not a raw throw, when CURRENT was deleted during the waits', async () => {
      const vars: Record<string, string> = { ...OPEN_WINDOW };
      const deps = makeDeps(vars, {
        getServiceVariable: vi.fn((env: string, service: string, key: string) => {
          if (vars[key] === undefined) {
            throw new Error(`${key} not found on ${service} (${env})`);
          }
          return vars[key];
        }),
        redeployAndWait: vi.fn(async ({ service }: { service: { name: string } }) => {
          if (service.name === 'ai-worker') {
            delete vars.API_KEY_ENCRYPTION_KEY;
          }
          return 'dep-new';
        }),
      });

      await expect(reencryptByokRows(deps)).rejects.toThrow(CHANGED_MESSAGE);
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('proceeds with the original keys when the variables are unchanged across the waits', async () => {
      const deps = makeDeps(OPEN_WINDOW);

      await reencryptByokRows(deps);

      expect(deps.reencryptAndVerify).toHaveBeenCalledTimes(1);
      expect(deps.reencryptAndVerify).toHaveBeenCalledWith(
        parseEncryptionKeyMaterial(KEY_A_HEX, 'TEST'),
        parseEncryptionKeyMaterial(KEY_B_HEX, 'TEST')
      );
    });

    it('refuses without re-encrypting when CURRENT changed during the waits', async () => {
      const deps = depsChangedDuringWaits({ API_KEY_ENCRYPTION_KEY: KEY_C_HEX });

      await expect(reencryptByokRows(deps)).rejects.toThrow(CHANGED_MESSAGE);
      expect(deps.redeployAndWait).toHaveBeenCalledTimes(2);
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('refuses without re-encrypting when PREVIOUS changed during the waits', async () => {
      const deps = depsChangedDuringWaits({ API_KEY_ENCRYPTION_KEY_PREVIOUS: KEY_C_HEX });

      await expect(reencryptByokRows(deps)).rejects.toThrow(CHANGED_MESSAGE);
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('refuses without re-encrypting when PREVIOUS was cleared during the waits', async () => {
      const deps = depsChangedDuringWaits({ API_KEY_ENCRYPTION_KEY_PREVIOUS: '' });

      await expect(reencryptByokRows(deps)).rejects.toThrow(CHANGED_MESSAGE);
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('carries no key material in the refusal', async () => {
      const deps = depsChangedDuringWaits({ API_KEY_ENCRYPTION_KEY: KEY_C_HEX });
      const message = await reencryptByokRows(deps).then(
        () => '',
        (error: unknown) => (error as Error).message
      );

      expect(message).toContain('BYOK stage 2');
      expect(message).toContain('no row has been re-encrypted');
      expect(message).not.toMatch(/[0-9a-f]{64}/);
    });

    it('reads the keys again only after both waits have finished', async () => {
      const deps = makeDeps(OPEN_WINDOW);

      await reencryptByokRows(deps);

      const waits = vi.mocked(deps.redeployAndWait).mock.invocationCallOrder;
      // The first read of CURRENT is the strict one; every later read is absent-tolerant.
      const strictReads = vi.mocked(deps.getServiceVariable).mock.invocationCallOrder;
      // Three tolerant reads: the PREVIOUS snapshot, then the CURRENT and PREVIOUS re-reads.
      const tolerantReads = vi.mocked(deps.getServiceVariableOrEmpty).mock.invocationCallOrder;
      expect(waits).toHaveLength(2);
      expect(strictReads).toHaveLength(1);
      expect(strictReads[0]).toBeLessThan(waits[0]);
      expect(tolerantReads).toHaveLength(3);
      expect(tolerantReads[0]).toBeLessThan(waits[0]);
      expect(tolerantReads[1]).toBeGreaterThan(waits[1]);
      expect(tolerantReads[2]).toBeGreaterThan(waits[1]);
    });

    it('asserts the two services agree again only after both waits have finished', async () => {
      const deps = makeDeps(OPEN_WINDOW);

      await reencryptByokRows(deps);

      const waits = vi.mocked(deps.redeployAndWait).mock.invocationCallOrder;
      const consistency = vi.mocked(deps.assertServicesConsistent).mock.invocationCallOrder;
      expect(consistency).toHaveLength(1);
      expect(consistency[0]).toBeGreaterThan(waits[1]);
      expect(consistency[0]).toBeLessThan(
        vi.mocked(deps.reencryptAndVerify).mock.invocationCallOrder[0]
      );
    });
  });

  describe('operator-facing refusals (real wait, faked Railway)', () => {
    function withFakeRailway(status: string): Pick<StageDeps, 'redeployAndWait'> {
      return {
        redeployAndWait: args =>
          redeployAndWaitForService({
            ...args,
            redeploy: vi
              .fn()
              .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' }),
            getLatestDeployment: vi.fn().mockResolvedValue({ id: 'dep-new', status }),
            sleep: vi.fn().mockResolvedValue(undefined),
          }),
      };
    }

    /** Run stage 2 with console output silenced and return the refusal message it threw. */
    async function refusalMessage(deps: StageDeps): Promise<string> {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      return reencryptByokRows(deps)
        .then(
          () => '',
          (error: unknown) => (error as Error).message
        )
        .finally(() => logSpy.mockRestore());
    }

    it('names the service and BYOK stage 2, claims nothing about presenters, and says no row was re-encrypted', async () => {
      const deps = makeDeps(OPEN_WINDOW, withFakeRailway('FAILED'));
      const message = await refusalMessage(deps);

      expect(message).toBe(
        'BYOK stage 2 redeployed service "api-gateway" (dev), but the new deployment reached terminal status FAILED instead of SUCCESS — no row has been re-encrypted. ' +
          "That deployment is now api-gateway's latest deployment, so BYOK stage 2 refuses to run until it is fixed, and " +
          '`pnpm ops deploy:redeploy` refuses it too (it also needs a SUCCESS latest deployment): ' +
          'fix api-gateway in the Railway dashboard until its latest deployment is SUCCESS, then re-run BYOK stage 2.'
      );
      expect(message).not.toContain('--service');
      expect(message).not.toMatch(/presenter|dual-acceptance|verifier/);
      expect(message).not.toMatch(/[0-9a-f]{64}/);
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it.each(['CRASHED', 'REMOVED', 'SKIPPED'])(
      'a %s terminal status tells the operator to fix the failed service in the Railway dashboard, not to run deploy:redeploy',
      async status => {
        const deps = makeDeps(OPEN_WINDOW, withFakeRailway(status));
        const message = await refusalMessage(deps);

        expect(message).toContain(`reached terminal status ${status}`);
        expect(message).toContain(
          'fix api-gateway in the Railway dashboard until its latest deployment is SUCCESS'
        );
        expect(message).not.toContain('--service');
        expect(message).toContain('latest deployment, so BYOK stage 2 refuses to run');
        expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
      }
    );

    it('a worker trigger refused after the gateway reached SUCCESS names the worker and BYOK stage 2, says it was refused before it restarted (not that nothing restarted), and re-encrypts nothing', async () => {
      const refusal =
        'Cannot redeploy Railway service "ai-worker" (dev): its latest deployment is DEPLOYING, not SUCCESS; resolve that before rotating';
      const redeploy = vi.fn(async ({ serviceName }: { serviceName: string }) => {
        if (serviceName === 'ai-worker') {
          throw new RailwayRedeployRefusedError(refusal);
        }
        return { sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' };
      });
      const deps = makeDeps(OPEN_WINDOW, {
        redeployAndWait: args =>
          redeployAndWaitForService({
            ...args,
            redeploy,
            getLatestDeployment: vi.fn().mockResolvedValue({ id: 'dep-new', status: 'SUCCESS' }),
            sleep: vi.fn().mockResolvedValue(undefined),
          }),
      });
      const message = await refusalMessage(deps);

      expect(message).toContain('service "ai-worker"');
      expect(message).toContain('BYOK stage 2');
      expect(message).toContain(refusal);
      expect(message).toContain('was refused before it restarted');
      expect(message).not.toContain('anything restarted');
      expect(message).not.toContain('may already be restarting');
      expect(message).toContain("wait for the service's latest deployment to settle");
      expect(message).toContain(
        'fix ai-worker in the Railway dashboard until its latest deployment is SUCCESS first.'
      );
      expect(message).not.toContain('deploy:redeploy');
      expect(message).not.toMatch(/<env>|<name>/);
      expect(message).not.toMatch(/presenter|dual-acceptance|verifier/);
      expect(redeploy).toHaveBeenCalledTimes(2);
      expect(redeploy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ serviceName: 'api-gateway' })
      );
      expect(redeploy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ serviceName: 'ai-worker' })
      );
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('a trigger that fails with a non-refusal error still says the service may already be restarting', async () => {
      const deps = makeDeps(OPEN_WINDOW, {
        redeployAndWait: args =>
          redeployAndWaitForService({
            ...args,
            redeploy: vi.fn().mockRejectedValue(new Error('network down')),
            getLatestDeployment: vi.fn().mockResolvedValue(null),
            sleep: vi.fn().mockResolvedValue(undefined),
          }),
      });
      const message = await refusalMessage(deps);

      expect(message).toContain('failed or returned an unexpected shape (network down)');
      expect(message).toContain('the service may already be restarting');
      expect(message).not.toContain('refused before it restarted');
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('a superseding deployment names the dashboard repair for a settling-to-terminal deployment, not deploy:redeploy', async () => {
      const deps = makeDeps(OPEN_WINDOW, {
        redeployAndWait: args =>
          redeployAndWaitForService({
            ...args,
            redeploy: vi
              .fn()
              .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' }),
            getLatestDeployment: vi
              .fn()
              .mockResolvedValue({ id: 'dep-other', status: 'DEPLOYING' }),
            sleep: vi.fn().mockResolvedValue(undefined),
          }),
      });
      const message = await refusalMessage(deps);

      expect(message).toContain('supersedes ours');
      expect(message).toContain(
        'then re-run BYOK stage 2 (no row has been re-encrypted; if the latest deployment settles to FAILED, CRASHED, REMOVED or SKIPPED, ' +
          'fix api-gateway in the Railway dashboard until its latest deployment is SUCCESS first)'
      );
      expect(message).not.toContain('deploy:redeploy');
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('a timeout tells the operator to let the still-deploying service settle, names the dashboard repair for a later terminal failure, and re-encrypts nothing', async () => {
      let clock = 0;
      const deps = makeDeps(OPEN_WINDOW, {
        redeployAndWait: args =>
          redeployAndWaitForService({
            ...args,
            redeploy: vi
              .fn()
              .mockResolvedValue({ sourceDeploymentId: 'dep-old', newDeploymentId: 'dep-new' }),
            getLatestDeployment: vi.fn().mockResolvedValue({ id: 'dep-new', status: 'DEPLOYING' }),
            sleep: vi.fn().mockResolvedValue(undefined),
            now: () => {
              clock += 10 * 60 * 1000;
              return clock;
            },
          }),
      });
      const message = await refusalMessage(deps);

      expect(message).toContain('Timed out');
      expect(message).toContain('service "api-gateway"');
      expect(message).toContain("wait for the service's latest deployment to settle");
      expect(message).toContain('FAILED, CRASHED, REMOVED or SKIPPED');
      expect(message).toContain(
        'fix api-gateway in the Railway dashboard until its latest deployment is SUCCESS first.'
      );
      expect(message).not.toContain('deploy:redeploy');
      expect(message).not.toMatch(/<env>|<name>/);
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });

    it('NEEDS_APPROVAL names BYOK stage 2 and the dashboard approval, and nothing is re-encrypted', async () => {
      const deps = makeDeps(OPEN_WINDOW, withFakeRailway('NEEDS_APPROVAL'));
      const message = await refusalMessage(deps);

      expect(message).toContain('BYOK stage 2');
      expect(message).toContain('approve it in the dashboard');
      expect(message).toContain(
        '(no row has been re-encrypted; if the latest deployment settles to'
      );
      expect(message).not.toContain("wait for the service's latest deployment to settle");
      expect(message.match(/re-run BYOK stage 2/gi)).toHaveLength(1);
      expect(message).not.toContain('deploy:redeploy');
      expect(message).not.toMatch(/<env>|<name>/);
      expect(message).not.toContain('latest deployment, so BYOK stage 2 refuses to run');
      expect(deps.reencryptAndVerify).not.toHaveBeenCalled();
    });
  });
});
