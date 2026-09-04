/**
 * Tests for the "View Reasoning" context-menu command.
 *
 * Only the gateway boundary is mocked (`inspect/lookup.js` + the typed
 * clients): the reasoning view builder, the shared `renderViewResult` unpack
 * path, and the chunked-reply splitter all run for real, so a trace that never
 * reaches `editReply` fails here rather than passing against a stubbed render.
 *
 * Two lookup tiers are exercised: the 7d diagnostic log (`resolveMock`) and
 * the persisted history trace (`getMessageReasoningMock`). The tier-2 default
 * is a 404 so every pre-existing tier-1 case keeps asserting tier-1 behaviour;
 * cases that mean to reach tier 2 override it explicitly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApplicationCommandType } from 'discord.js';
import type { MessageContextMenuCommandInteraction } from 'discord.js';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import type { DiagnosticLog, LookupResult } from './inspect/types.js';
import viewReasoningCommand from './viewReasoning.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock('./inspect/lookup.js', () => ({
  resolveDiagnosticLog: resolveMock,
  // inspect/index.js (imported for renderViewResult) also pulls lookupByRequestId
  lookupByRequestId: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (id: string) => id === 'owner-123',
  };
});

interface MockInteraction {
  targetId: string;
  user: { id: string };
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
}

function makeInteraction(userId = 'user-1'): MockInteraction {
  return {
    targetId: '123456789012345678',
    user: { id: userId },
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

function asInteraction(mock: MockInteraction): MessageContextMenuCommandInteraction {
  return mock as unknown as MessageContextMenuCommandInteraction;
}

/**
 * Minimal resolved-log fixture; `thinkingContent` is what each case varies.
 *
 * Typed as `LookupResult` so a rename in the discriminated union (or in `log`'s
 * own top-level keys) breaks compilation here rather than silently passing
 * against a stale shape. The two inner casts are deliberate: `DiagnosticLog`
 * and `DiagnosticPayload` require many fields this command never reads, and
 * spelling them all out would obscure the one field each case varies.
 */
function logWithThinking(thinkingContent: string | null): LookupResult {
  return {
    success: true,
    log: {
      requestId: 'req-1',
      personalityId: 'pers-1',
      data: {
        meta: {},
        postProcessing: { thinkingContent },
      } as unknown as DiagnosticPayload,
    } as DiagnosticLog,
  };
}

function editReplyContent(mock: MockInteraction): string {
  const payload = mock.editReply.mock.calls[0][0] as { content?: string };
  return payload.content ?? '';
}

const getMessageReasoningMock = vi.hoisted(() => vi.fn());

/** The tier-2 gateway result for "no readable row" — the handler's 404. */
const REASONING_NOT_FOUND = { ok: false as const, status: 404, error: 'Not found' };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: tier 2 has nothing, so tier-1 assertions stay about tier 1.
  getMessageReasoningMock.mockResolvedValue(REASONING_NOT_FOUND);
  clientsForMock.mockReturnValue({
    userClient: { stub: true, getMessageReasoning: getMessageReasoningMock },
  });
});

describe('View Reasoning context-menu command', () => {
  it('declares a MESSAGE-type context-menu command named "View Reasoning"', () => {
    const json = viewReasoningCommand.data.toJSON();
    expect(json.name).toBe('View Reasoning');
    expect(json.type).toBe(ApplicationCommandType.Message);
  });

  it('feeds the target message id into the diagnostic lookup and renders the trace', async () => {
    resolveMock.mockResolvedValue(logWithThinking('the model deliberated SENTINEL_TRACE here'));
    const interaction = makeInteraction();

    await viewReasoningCommand.execute(asInteraction(interaction));

    // Seam: the right-clicked message's id is the lookup identifier, run as
    // the clicking user's client (server-side permission filtering).
    expect(resolveMock).toHaveBeenCalledWith(
      '123456789012345678',
      expect.objectContaining({ stub: true })
    );

    // The real view builder + render path put the trace itself in the reply.
    expect(editReplyContent(interaction)).toContain('SENTINEL_TRACE');
    expect(editReplyContent(interaction)).toContain('Reasoning');
  });

  it('splits a long trace across ephemeral follow-ups', async () => {
    resolveMock.mockResolvedValue(logWithThinking(`${'a'.repeat(2500)}SENTINEL_TAIL`));
    const interaction = makeInteraction();

    await viewReasoningCommand.execute(asInteraction(interaction));

    expect(interaction.followUp).toHaveBeenCalled();
    const tail = interaction.followUp.mock.calls
      .map(call => (call[0] as { content?: string }).content ?? '')
      .join('');
    expect(tail).toContain('SENTINEL_TAIL');
  });

  it('reports a resolved log that carries no reasoning trace', async () => {
    resolveMock.mockResolvedValue(logWithThinking(null));
    const interaction = makeInteraction();

    await viewReasoningCommand.execute(asInteraction(interaction));

    expect(editReplyContent(interaction)).toContain('No reasoning content captured');
    // Distinct from the lookup miss below — no retention/inspect hint here.
    expect(editReplyContent(interaction)).not.toContain('/inspect');
  });

  it('renders the lookup miss with a pointer at the full /inspect surface', async () => {
    resolveMock.mockResolvedValue({
      success: false,
      errorMessage: 'No diagnostic logs found for this message.',
    });
    const interaction = makeInteraction();

    await viewReasoningCommand.execute(asInteraction(interaction));

    const content = editReplyContent(interaction);
    expect(content).toContain('No diagnostic logs found');
    expect(content).toContain('/inspect');
    // The two misses stay distinguishable
    expect(content).not.toContain('No reasoning content captured');
  });

  describe('persisted-history fallback (tier 2)', () => {
    /** Tier 1 always misses in this block — that is the trigger for tier 2. */
    beforeEach(() => {
      resolveMock.mockResolvedValue({
        success: false,
        errorMessage: 'No diagnostic logs found for this message.',
      });
    });

    it('renders the persisted trace when the diagnostic has expired', async () => {
      getMessageReasoningMock.mockResolvedValue({
        ok: true,
        data: { thinkingContent: 'PERSISTED_SENTINEL survived the 24h purge', createdAt: 'T' },
      });
      const interaction = makeInteraction();

      await viewReasoningCommand.execute(asInteraction(interaction));

      // Seam: the right-clicked message id is what tier 2 is asked for.
      expect(getMessageReasoningMock).toHaveBeenCalledWith('123456789012345678');
      // The real view builder ran — the trace itself reaches the reply, and the
      // tier-1 miss copy does NOT.
      expect(editReplyContent(interaction)).toContain('PERSISTED_SENTINEL');
      expect(editReplyContent(interaction)).toContain('Reasoning');
      expect(editReplyContent(interaction)).not.toContain('/inspect');
    });

    it('states the age of the trace, since tier 2 answers after the diagnostic missed', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      getMessageReasoningMock.mockResolvedValue({
        ok: true,
        data: { thinkingContent: 'PERSISTED_SENTINEL', createdAt: threeDaysAgo },
      });
      const interaction = makeInteraction();

      await viewReasoningCommand.execute(asInteraction(interaction));

      expect(editReplyContent(interaction)).toContain('Reasoning from a message 3 days ago');
      expect(editReplyContent(interaction)).toContain('PERSISTED_SENTINEL');
    });

    it('omits the age line when the row carries no trace to date', async () => {
      getMessageReasoningMock.mockResolvedValue({
        ok: true,
        data: { thinkingContent: null, createdAt: new Date().toISOString() },
      });
      const interaction = makeInteraction();

      await viewReasoningCommand.execute(asInteraction(interaction));

      // Dating an absence would be noise — there is nothing whose age matters.
      expect(editReplyContent(interaction)).not.toContain('Reasoning from a message');
    });

    it('reports a persisted row that carries no trace, distinctly from a miss', async () => {
      getMessageReasoningMock.mockResolvedValue({
        ok: true,
        data: { thinkingContent: null, createdAt: 'T' },
      });
      const interaction = makeInteraction();

      await viewReasoningCommand.execute(asInteraction(interaction));

      const content = editReplyContent(interaction);
      expect(content).toContain('No reasoning content was captured for this message');
      // The row exists, so this is not the lookup-miss path.
      expect(content).not.toContain('/inspect');
    });

    it('falls back to the tier-1 miss copy when no readable row exists', async () => {
      getMessageReasoningMock.mockResolvedValue(REASONING_NOT_FOUND);
      const interaction = makeInteraction();

      await viewReasoningCommand.execute(asInteraction(interaction));

      const content = editReplyContent(interaction);
      expect(content).toContain('No diagnostic logs found');
      expect(content).toContain('/inspect');
    });

    it('surfaces a non-404 tier-2 failure as a read error, not as an expired trace', async () => {
      // Degrading a 500 to "not found" would report a broken gateway as an
      // absent trace, which is the wrong thing to tell the user.
      getMessageReasoningMock.mockResolvedValue({ ok: false, status: 500, error: 'boom' });
      const interaction = makeInteraction();

      await viewReasoningCommand.execute(asInteraction(interaction));

      const content = editReplyContent(interaction);
      expect(content).toContain('Failed to load the reasoning trace');
      expect(content).not.toContain('No diagnostic logs found');
    });

    it('does not consult tier 2 when the diagnostic log resolved', async () => {
      resolveMock.mockResolvedValue(logWithThinking('tier one answered'));
      const interaction = makeInteraction();

      await viewReasoningCommand.execute(asInteraction(interaction));

      expect(getMessageReasoningMock).not.toHaveBeenCalled();
    });
  });

  it('classifies unexpected failures as read errors', async () => {
    resolveMock.mockRejectedValue(new Error('boom'));
    const interaction = makeInteraction();

    await viewReasoningCommand.execute(asInteraction(interaction));

    const content = editReplyContent(interaction);
    // Pin the resolved copy, not just its shape: asserting only "non-empty and
    // not a write-error" would still pass if the classifier regressed to some
    // other read-flavoured string.
    expect(content).toContain('Failed to load the reasoning trace');
    // Read classification: never claims a change may still be applying
    expect(content).not.toContain('may still');
    expect(content.length).toBeGreaterThan(0);
  });

  describe('header id-tag masking', () => {
    // `meta` is empty in every fixture here, so `computeViewContext` resolves
    // `canViewCharacter: true` for both an owner and a non-owner viewer — the
    // ONLY difference between the two paths in this block is whether the
    // header id tag survives byte-exact or gets masked. Tier 1 masks through
    // `payloadForViewer`; tier 2 masks through the `maskTags` param on
    // `lookupPersistedReasoning`.
    it('masks a tier-1 header id tag for a non-owner viewer', async () => {
      resolveMock.mockResolvedValue(
        logWithThinking('the model weighed Vlad (id:abcd1234) against the roster')
      );
      const interaction = makeInteraction('user-1');

      await viewReasoningCommand.execute(asInteraction(interaction));

      const content = editReplyContent(interaction);
      expect(content).not.toContain('abcd1234');
      expect(content).toContain('(id:····)');
    });

    it('leaves a tier-1 header id tag byte-exact for the bot owner', async () => {
      resolveMock.mockResolvedValue(
        logWithThinking('the model weighed Vlad (id:abcd1234) against the roster')
      );
      const interaction = makeInteraction('owner-123');

      await viewReasoningCommand.execute(asInteraction(interaction));

      expect(editReplyContent(interaction)).toContain('(id:abcd1234)');
    });

    it('masks a tier-2 header id tag for a non-owner viewer', async () => {
      resolveMock.mockResolvedValue({
        success: false,
        errorMessage: 'No diagnostic logs found for this message.',
      });
      getMessageReasoningMock.mockResolvedValue({
        ok: true,
        data: { thinkingContent: 'the trace named Vlad (id:deadbeef) once', createdAt: 'T' },
      });
      const interaction = makeInteraction('user-1');

      await viewReasoningCommand.execute(asInteraction(interaction));

      const content = editReplyContent(interaction);
      expect(content).not.toContain('deadbeef');
      expect(content).toContain('(id:····)');
    });

    it('leaves a tier-2 header id tag byte-exact for the bot owner', async () => {
      resolveMock.mockResolvedValue({
        success: false,
        errorMessage: 'No diagnostic logs found for this message.',
      });
      getMessageReasoningMock.mockResolvedValue({
        ok: true,
        data: { thinkingContent: 'the trace named Vlad (id:deadbeef) once', createdAt: 'T' },
      });
      const interaction = makeInteraction('owner-123');

      await viewReasoningCommand.execute(asInteraction(interaction));

      expect(editReplyContent(interaction)).toContain('(id:deadbeef)');
    });
  });
});
