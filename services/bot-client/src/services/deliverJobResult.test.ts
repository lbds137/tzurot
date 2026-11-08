/**
 * Tests for the disposition-gated delivery seam.
 *
 * This is the literal TASK-821 incident site, extracted from `index.ts` so it
 * can be tested at all: the reported failure was a generated reply that was
 * dropped while its gateway row was marked delivered. Both directions of the
 * gate are pinned here.
 */

import { describe, it, expect, vi } from 'vitest';
import { deliverJobResult } from './deliverJobResult.js';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';

const RESULT = {
  requestId: 'req-1',
  success: true,
  content: 'a generated reply',
} as LLMGenerationResult;

describe('deliverJobResult', () => {
  it('confirms delivery when the handler reports `delivered`', async () => {
    const confirmDelivery = vi.fn().mockResolvedValue(undefined);
    const handleJobResult = vi.fn().mockResolvedValue('delivered');

    const disposition = await deliverJobResult(
      { handleJobResult, confirmDelivery },
      'job-1',
      RESULT
    );

    expect(disposition).toBe('delivered');
    expect(confirmDelivery).toHaveBeenCalledWith('job-1');
  });

  it('does NOT confirm delivery when the handler reports `dropped`', async () => {
    // The regression this module exists for. A confirmed row records a reply
    // the user never received, and nothing ever revisits PENDING_DELIVERY —
    // so the unconfirmed row is the only surviving evidence of the loss.
    const confirmDelivery = vi.fn().mockResolvedValue(undefined);
    const handleJobResult = vi.fn().mockResolvedValue('dropped');

    const disposition = await deliverJobResult(
      { handleJobResult, confirmDelivery },
      'job-lost',
      RESULT
    );

    expect(disposition).toBe('dropped');
    expect(confirmDelivery).not.toHaveBeenCalled();
  });

  it('forwards the jobId and the result verbatim across the handler seam', async () => {
    // The handler is mocked here, so a caller that dropped or swapped an
    // argument would otherwise look identical to a correct one.
    const confirmDelivery = vi.fn().mockResolvedValue(undefined);
    const handleJobResult = vi.fn().mockResolvedValue('delivered');
    const sentinel = {
      requestId: 'req-sentinel',
      success: true,
      content: 'FORWARDED-CONTENT-SENTINEL',
    } as LLMGenerationResult;

    await deliverJobResult({ handleJobResult, confirmDelivery }, 'job-sentinel', sentinel);

    expect(handleJobResult).toHaveBeenCalledWith('job-sentinel', sentinel);
  });

  it('propagates a confirmDelivery failure rather than swallowing it', async () => {
    // The caller wraps this in its own try/catch and logs; silently eating the
    // failure here would hide a gateway outage behind a clean delivery.
    const confirmDelivery = vi.fn().mockRejectedValue(new Error('gateway down'));
    const handleJobResult = vi.fn().mockResolvedValue('delivered');

    await expect(
      deliverJobResult({ handleJobResult, confirmDelivery }, 'job-boom', RESULT)
    ).rejects.toThrow('gateway down');
  });
});
