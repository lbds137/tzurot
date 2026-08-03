/**
 * Tests for the /voice tts default handler.
 *
 * One subcommand covers both directions: providing the `tts` option locks the
 * BYOK-gate-then-mutation set flow, omitting it takes the clear path. Both
 * branches are exercised here because the option's presence IS the routing
 * decision — a handler that ignored it would still pass a set-only suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const { mockCheckTtsByokAccess, mockTtsOption } = vi.hoisted(() => ({
  mockCheckTtsByokAccess: vi.fn(),
  mockTtsOption: vi.fn<() => string | null>(),
}));

const stub = {
  setTtsDefaultConfig: vi.fn(),
  clearTtsDefaultConfig: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('./guestModeValidation.js', () => ({
  checkTtsByokAccess: mockCheckTtsByokAccess,
}));

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    voiceTtsDefaultOptions: vi.fn(() => ({
      tts: mockTtsOption,
    })),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { mockClearTtsDefaultConfigResponse } from '@tzurot/test-factories';
import {
  AUTOCOMPLETE_ERROR_SENTINEL,
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
} from '../../../utils/apiCheck.js';

const { handleTtsDefault } = await import('./default.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleTtsDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.setTtsDefaultConfig.mockReset();
    stub.clearTtsDefaultConfig.mockReset();
  });

  describe('set branch (tts option provided)', () => {
    beforeEach(() => {
      mockTtsOption.mockReturnValue('cfg-uuid-1');
    });

    it('blocks at command time when BYOK gate fails', async () => {
      mockCheckTtsByokAccess.mockResolvedValue({ blocked: true, reason: 'blocked-byok' });
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(stub.setTtsDefaultConfig).not.toHaveBeenCalled();
    });

    it('short-circuits on the autocomplete-error sentinel before any gateway work', async () => {
      // A failed autocomplete submits the sentinel as the option value; it must
      // never reach the BYOK gate or the PUT as if it were a real configId.
      mockTtsOption.mockReturnValue(AUTOCOMPLETE_ERROR_SENTINEL);
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(mockCheckTtsByokAccess).not.toHaveBeenCalled();
      expect(stub.setTtsDefaultConfig).not.toHaveBeenCalled();
      expect(context.editReply).toHaveBeenCalledWith({
        content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
      });
    });

    it('calls setTtsDefaultConfig on happy path', async () => {
      mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'self-hosted' });
      stub.setTtsDefaultConfig.mockResolvedValue(
        makeOk({ default: { configId: 'cfg-uuid-1', configName: 'kyutai-self-hosted' } })
      );
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(stub.setTtsDefaultConfig).toHaveBeenCalledWith({ configId: 'cfg-uuid-1' });
      expect(stub.clearTtsDefaultConfig).not.toHaveBeenCalled();
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({ title: expect.stringContaining('Default TTS') }),
            }),
          ],
        })
      );
    });

    it('shows error embed on gateway failure', async () => {
      mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
      stub.setTtsDefaultConfig.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('❌') })
      );
    });

    it('catches and reports unexpected errors on the set path', async () => {
      mockCheckTtsByokAccess.mockRejectedValue(new Error('network down'));
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('error occurred') })
      );
    });
  });

  describe('clear branch (tts option omitted)', () => {
    beforeEach(() => {
      mockTtsOption.mockReturnValue(null);
    });

    it('calls clearTtsDefaultConfig and shows success embed', async () => {
      stub.clearTtsDefaultConfig.mockResolvedValue(makeOk(mockClearTtsDefaultConfigResponse()));
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(stub.clearTtsDefaultConfig).toHaveBeenCalled();
      // The absent option must not reach the set path — the BYOK gate belongs
      // to the set branch only.
      expect(stub.setTtsDefaultConfig).not.toHaveBeenCalled();
      expect(mockCheckTtsByokAccess).not.toHaveBeenCalled();
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({ title: expect.stringContaining('Cleared') }),
            }),
          ],
        })
      );
    });

    it('renders the new effective default name when one exists', async () => {
      stub.clearTtsDefaultConfig.mockResolvedValue(
        makeOk(
          mockClearTtsDefaultConfigResponse({
            newEffectiveDefault: { id: 'free-id', name: 'kyutai-self-hosted' },
          })
        )
      );
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringContaining('kyutai-self-hosted'),
              }),
            }),
          ],
        })
      );
    });

    it('renders hardcoded-fallback notice when newEffectiveDefault is null', async () => {
      stub.clearTtsDefaultConfig.mockResolvedValue(
        makeOk(mockClearTtsDefaultConfigResponse({ newEffectiveDefault: null }))
      );
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringContaining('built-in fallback'),
              }),
            }),
          ],
        })
      );
    });

    it('shows error message on gateway failure', async () => {
      stub.clearTtsDefaultConfig.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('❌') })
      );
    });

    it('catches and reports unexpected errors', async () => {
      stub.clearTtsDefaultConfig.mockRejectedValue(new Error('network down'));
      const context = makeContext();

      await handleTtsDefault(context as never);

      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('error occurred') })
      );
    });
  });
});
