/**
 * Flow-level tests against a stub adapter. The two entity suites
 * (character/persona truncationWarning.test.ts) exercise the real adapters
 * end-to-end through the factory-bound exports; this file pins the flow's
 * own contracts — ack-before-async ordering, the null-sync warm skip, the
 * warm-failure containment, and the adapter-owns-error-replies convention.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTruncationEditFlow,
  type EntitySectionAdapter,
  type EntitySectionSync,
} from './entityEditFlow.js';

vi.mock('../ModalFactory.js', () => ({
  buildSectionModal: vi.fn().mockReturnValue({ modal: true }),
}));
const mockShowModal = vi.hoisted(() => vi.fn());
vi.mock('../showModalWithTimeoutCatch.js', () => ({
  showModalWithTimeoutCatch: mockShowModal,
}));

type Data = Record<string, unknown>;

const section = { id: 'identity', label: '🧬 Identity', fields: [] } as never;
const sync: EntitySectionSync<Data> = { dashboardConfig: {} as never, section };

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

function makeAdapter(
  overrides: Partial<EntitySectionAdapter<Data>> = {}
): EntitySectionAdapter<Data> {
  return {
    entityType: 'persona',
    findSection: vi.fn().mockReturnValue(sync),
    loadSectionData: vi.fn().mockResolvedValue({ ...sync, data: {} }),
    resolveSectionContext: vi.fn().mockResolvedValue({ ...sync, data: {} }),
    ...overrides,
  };
}

function makeButtonInteraction(): {
  update: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  user: { id: string };
} {
  return {
    update: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    user: { id: 'user-1' },
  };
}

describe('createTruncationEditFlow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edit-truncated acks via update BEFORE the session warm runs', async () => {
    const order: string[] = [];
    const interaction = makeButtonInteraction();
    interaction.update.mockImplementation(async () => {
      order.push('update');
    });
    const adapter = makeAdapter({
      loadSectionData: vi.fn().mockImplementation(async () => {
        order.push('warm');
        return { ...sync, data: {} };
      }),
    });
    const flow = createTruncationEditFlow(adapter, logger);

    await flow.handleEditTruncatedButton(interaction as never, 'e-1', 'identity');

    expect(order).toEqual(['update', 'warm']);
  });

  it('skips the warm (but still acks) when the section is unknown', async () => {
    const interaction = makeButtonInteraction();
    const load = vi.fn();
    const adapter = makeAdapter({
      findSection: vi.fn().mockReturnValue(null),
      loadSectionData: load,
    });
    const flow = createTruncationEditFlow(adapter, logger);

    await flow.handleEditTruncatedButton(interaction as never, 'e-1', 'nope');

    expect(interaction.update).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it('contains a warm failure — the ack already happened, nothing rethrows', async () => {
    const interaction = makeButtonInteraction();
    const adapter = makeAdapter({
      loadSectionData: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const flow = createTruncationEditFlow(adapter, logger);

    await expect(
      flow.handleEditTruncatedButton(interaction as never, 'e-1', 'identity')
    ).resolves.toBeUndefined();
  });

  it('open-editor stops silently on null context (adapter owns the error reply)', async () => {
    const interaction = makeButtonInteraction();
    const adapter = makeAdapter({
      resolveSectionContext: vi.fn().mockResolvedValue(null),
    });
    const flow = createTruncationEditFlow(adapter, logger);

    await flow.handleOpenEditorButton(interaction as never, 'e-1', 'identity');

    expect(mockShowModal).not.toHaveBeenCalled();
  });

  it('view-full defers BEFORE resolving and reports the nothing-over-length edge', async () => {
    const order: string[] = [];
    const interaction = makeButtonInteraction();
    interaction.deferReply.mockImplementation(async () => {
      order.push('defer');
    });
    const adapter = makeAdapter({
      resolveSectionContext: vi.fn().mockImplementation(async () => {
        order.push('resolve');
        return { ...sync, data: {} };
      }),
    });
    const flow = createTruncationEditFlow(adapter, logger);

    await flow.handleViewFullButton(interaction as never, 'e-1', 'identity');

    expect(order).toEqual(['defer', 'resolve']);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '✅ No fields in this section exceed the edit limit. Nothing to display.',
    });
  });
});
