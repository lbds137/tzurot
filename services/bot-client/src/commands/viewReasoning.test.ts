/**
 * Tests for the "View Reasoning" context-menu command.
 *
 * Only the gateway boundary is mocked (`inspect/lookup.js` + the typed
 * clients): the reasoning view builder, the shared `renderViewResult` unpack
 * path, and the chunked-reply splitter all run for real, so a trace that never
 * reaches `editReply` fails here rather than passing against a stubbed render.
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

interface MockInteraction {
  targetId: string;
  user: { id: string };
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
}

function makeInteraction(): MockInteraction {
  return {
    targetId: '123456789012345678',
    user: { id: 'user-1' },
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

beforeEach(() => {
  vi.clearAllMocks();
  clientsForMock.mockReturnValue({ userClient: { stub: true } });
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
    expect(resolveMock).toHaveBeenCalledWith('123456789012345678', { stub: true });

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
});
