import { describe, it, expect, vi } from 'vitest';

// Only the Railway read is mocked. Git is real: this file pins that the gate's
// token and pathspec still match the decrypt source at HEAD, which a mocked git
// cannot show.
vi.mock('../deployment/railway-api.js', () => ({ getLiveDeploymentCommit: vi.fn() }));

import { execFileSync } from 'node:child_process';
import { getLiveDeploymentCommit } from '../deployment/railway-api.js';
import { checkDeployedCodeDecryptsWithNext } from './deployed-code-gate.js';

const mockGetLiveDeploymentCommit = vi.mocked(getLiveDeploymentCommit);

describe('checkDeployedCodeDecryptsWithNext against the real git repo at HEAD', () => {
  // Pins that BYOK_NEXT_TOKEN and BYOK_DECRYPT_PATHSPECS still match the real
  // decrypt source at HEAD. If encryption.ts stops reading NEXT that way, this
  // test goes red and the gate must be updated with it.
  it('passes for HEAD, whose decrypt module reads API_KEY_ENCRYPTION_KEY_NEXT', async () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    mockGetLiveDeploymentCommit.mockResolvedValue(head);

    const result = await checkDeployedCodeDecryptsWithNext({
      environmentId: 'env-1',
      serviceId: 'svc-worker',
      serviceName: 'ai-worker',
      env: 'dev',
    });

    expect(result).toEqual({ ok: true, commit: head });
  });
});
