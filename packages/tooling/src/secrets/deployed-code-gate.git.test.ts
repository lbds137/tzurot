import { describe, it, expect, vi } from 'vitest';

// Only the Railway read is mocked. Git is real: this file pins that the gate's
// token and pathspec still match the decrypt source at HEAD, which a mocked git
// cannot show.
vi.mock('../deployment/railway-api.js', () => ({ getLiveDeployment: vi.fn() }));

import { execFileSync } from 'node:child_process';
import { getLiveDeployment } from '../deployment/railway-api.js';
import { checkDeployedCodeDecryptsWithNext } from './deployed-code-gate.js';

const mockGetLiveDeployment = vi.mocked(getLiveDeployment);

describe('checkDeployedCodeDecryptsWithNext against the real git repo at HEAD', () => {
  // Pins that BYOK_NEXT_TOKEN and BYOK_DECRYPT_PATHSPECS still match the real
  // decrypt source at HEAD. If encryption.ts stops defining the NEXT-aware
  // fallback under that name, this test goes red and the gate must be updated
  // with it.
  //
  // The negative side (a commit that lacks the token is refused) is NOT pinned
  // here: CI clones are shallow, so a historical commit is not guaranteed to be
  // present. The mocked suite covers the refusal cases (the tooling-only file and
  // the commit-not-in-clone case in deployed-code-gate.test.ts).
  it('passes for HEAD, whose decrypt module defines getNextEncryptionKey', async () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    mockGetLiveDeployment.mockResolvedValue({ id: 'dep-head', commit: head });

    const result = await checkDeployedCodeDecryptsWithNext({
      environmentId: 'env-1',
      serviceId: 'svc-worker',
      serviceName: 'ai-worker',
      env: 'dev',
    });

    expect(result).toEqual({ ok: true, commit: head, deploymentId: 'dep-head' });
  });
});
