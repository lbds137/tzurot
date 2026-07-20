/**
 * Tests for the Memory Facts detail view (correction verbs).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  FACT_DETAIL_PREFIX,
  buildFactActionId,
  parseFactActionId,
  buildFactDetailEmbed,
  buildFactDetailButtons,
  handleFactSelect,
  handleCorrectButton,
  handleCorrectModalSubmit,
  handleFactLockButton,
  handleForgetButton,
  handleForgetConfirm,
} from './factsDetail.js';
import type { FactItem } from './factsApi.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({ clientsFor: clientsForMock }));

const showModalMock = vi.hoisted(() => vi.fn());
const ackMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/dashboard/showModalWithTimeoutCatch.js', () => ({
  showModalWithTimeoutCatch: showModalMock,
}));
vi.mock('../../utils/dashboard/ackWithTimeoutCatch.js', () => ({
  ackWithTimeoutCatch: ackMock,
}));

interface FactClientStub {
  getFact: ReturnType<typeof vi.fn>;
  correctFact: ReturnType<typeof vi.fn>;
  forgetFact: ReturnType<typeof vi.fn>;
  setFactLock: ReturnType<typeof vi.fn>;
}

function createStub(): FactClientStub {
  return { getFact: vi.fn(), correctFact: vi.fn(), forgetFact: vi.fn(), setFactLock: vi.fn() };
}

const createMockFact = (overrides: Partial<FactItem> = {}): FactItem => ({
  id: 'fact-123',
  personalityId: 'personality-456',
  personaId: 'persona-789',
  statement: 'The user has a cat named Miso',
  entityTags: ['user'],
  salience: 0.7,
  tier: 'observed',
  isLocked: false,
  validFrom: '2026-06-15T12:00:00.000Z',
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: ['mem-1'],
  createdAt: '2026-06-15T12:00:00.000Z',
  ...overrides,
});

function createButtonInteraction(): ButtonInteraction {
  return {
    user: { id: 'user-1' },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

describe('fact custom IDs', () => {
  it('round-trips action, factId, and extra', () => {
    const id = buildFactActionId('lock', 'fact-123', '1');
    expect(id).toBe(`${FACT_DETAIL_PREFIX}::lock::fact-123::1`);
    expect(parseFactActionId(id)).toEqual({ action: 'lock', factId: 'fact-123', extra: '1' });
  });

  it('does NOT match the fact-browse pagination prefix (shared stem)', () => {
    // memory-fact-browse::... must never parse as a memory-fact:: action.
    expect(parseFactActionId('memory-fact-browse::browse::1::all')).toBeNull();
  });

  it('returns null for foreign prefixes', () => {
    expect(parseFactActionId('memory-detail::edit::x')).toBeNull();
  });
});

describe('buildFactDetailEmbed', () => {
  it('shows the statement, origin tier, and lock status', () => {
    const embed = buildFactDetailEmbed(createMockFact()).toJSON();
    expect(embed.description).toContain('The user has a cat named Miso');
    expect(embed.fields?.find(f => f.name === 'Origin')?.value).toContain('Learned');
    expect(embed.fields?.find(f => f.name === 'Status')?.value).toContain('Unlocked');
  });

  it('marks a corrected fact and a locked fact distinctly', () => {
    const corrected = buildFactDetailEmbed(
      createMockFact({ tier: 'corrected', isLocked: true })
    ).toJSON();
    expect(corrected.title).toContain('🔐');
    expect(corrected.fields?.find(f => f.name === 'Origin')?.value).toContain('Corrected');
  });

  it('includes Sources only when the fact has source memories', () => {
    const withSources = buildFactDetailEmbed(createMockFact()).toJSON();
    expect(withSources.fields?.find(f => f.name === 'Sources')?.value).toBe(
      '1 conversation memory'
    );

    const withoutSources = buildFactDetailEmbed(createMockFact({ sourceMemoryIds: [] })).toJSON();
    expect(withoutSources.fields?.map(f => f.name)).toEqual(['Origin', 'Status', 'Learned']);
  });
});

describe('buildFactDetailButtons', () => {
  it('disables Correct and Forget on a locked fact (hard freeze)', () => {
    const row = buildFactDetailButtons(createMockFact({ isLocked: true })).toJSON();
    const byLabel = new Map(row.components.map(c => ['label' in c ? c.label : '', c]));
    expect(byLabel.get('Correct')?.disabled).toBe(true);
    expect(byLabel.get('Forget')?.disabled).toBe(true);
    expect(byLabel.get('Unlock')?.disabled).toBeFalsy();
  });

  it('encodes the lock TARGET state in the customId', () => {
    const unlockedRow = buildFactDetailButtons(createMockFact({ isLocked: false })).toJSON();
    const lockButton = unlockedRow.components.find(c => 'label' in c && c.label === 'Lock');
    expect(lockButton !== undefined && 'custom_id' in lockButton && lockButton.custom_id).toBe(
      buildFactActionId('lock', 'fact-123', '1')
    );
  });
});

describe('handlers', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('handleFactSelect acks FIRST, then fetches and renders the detail view', async () => {
    const fact = createMockFact();
    stub.getFact.mockResolvedValue(makeOk({ fact }));
    const interaction = {
      ...createButtonInteraction(),
      values: ['fact-123'],
    } as unknown as StringSelectMenuInteraction;

    await handleFactSelect(interaction);

    // Ack-first: deferUpdate must have been called before the gateway fetch.
    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    const fetchOrder = stub.getFact.mock.invocationCallOrder[0];
    expect(deferOrder).toBeLessThan(fetchOrder);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.anything()], components: [expect.anything()] })
    );
  });

  it('handleCorrectModalSubmit sends the new statement and renders the SURVIVOR', async () => {
    const survivor = createMockFact({ id: 'other-fact', tier: 'corrected' });
    stub.correctFact.mockResolvedValue(makeOk({ fact: survivor, supersededFactId: 'fact-123' }));
    const interaction = {
      user: { id: 'user-1' },
      fields: { getTextInputValue: vi.fn().mockReturnValue('The user has a dog named Rex') },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handleCorrectModalSubmit(interaction, 'fact-123');

    expect(stub.correctFact).toHaveBeenCalledWith('fact-123', {
      statement: 'The user has a dog named Rex',
    });
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('handleCorrectModalSubmit surfaces a classified error via followUp (e.g. stale-view 403)', async () => {
    stub.correctFact.mockResolvedValue(makeErr(403, 'Cannot correct a locked fact'));
    const interaction = {
      user: { id: 'user-1' },
      fields: { getTextInputValue: vi.fn().mockReturnValue('x') },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handleCorrectModalSubmit(interaction, 'fact-123');

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('handleFactLockButton passes the desired target state through', async () => {
    stub.setFactLock.mockResolvedValue(makeOk({ fact: createMockFact({ isLocked: true }) }));
    const interaction = createButtonInteraction();

    await handleFactLockButton(interaction, 'fact-123', true);

    expect(stub.setFactLock).toHaveBeenCalledWith('fact-123', { locked: true });
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('handleForgetButton renders the confirmation with a danger confirm id', async () => {
    stub.getFact.mockResolvedValue(makeOk({ fact: createMockFact() }));
    const interaction = createButtonInteraction();

    await handleForgetButton(interaction, 'fact-123');

    const call = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as unknown as {
      components: { toJSON(): { components: { custom_id?: string }[] } }[];
    };
    const ids = call.components[0].toJSON().components.map(c => c.custom_id);
    expect(ids).toContain(buildFactActionId('confirm-forget', 'fact-123'));
  });

  it('handleForgetConfirm forgets and reports true; false on a genuine 404', async () => {
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-123', forgotten: true }));
    expect(await handleForgetConfirm(createButtonInteraction(), 'fact-123')).toBe(true);

    stub.forgetFact.mockResolvedValue(makeErr(404, 'gone'));
    expect(await handleForgetConfirm(createButtonInteraction(), 'fact-123')).toBe(false);
  });
});

describe('handleCorrectButton (pre-modal fetch path)', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('shows the modal prefilled with the current statement', async () => {
    stub.getFact.mockResolvedValue(makeOk({ fact: createMockFact() }));
    const interaction = createButtonInteraction();

    await handleCorrectButton(interaction, 'fact-123');

    expect(showModalMock).toHaveBeenCalled();
    const modal = showModalMock.mock.calls[0][1] as { toJSON(): unknown };
    const json = JSON.stringify(modal.toJSON());
    expect(json).toContain('The user has a cat named Miso'); // prefill
    expect(json).toContain(buildFactActionId('correct', 'fact-123'));
    // showModal must be the first response — no defer/reply on this path.
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('delivers a not-found error through the timeout-catch ack (no modal)', async () => {
    stub.getFact.mockResolvedValue(makeErr(404, 'Not found'));
    const interaction = createButtonInteraction();

    await handleCorrectButton(interaction, 'fact-123');

    expect(showModalMock).not.toHaveBeenCalled();
    expect(ackMock).toHaveBeenCalled();
  });

  it('delivers a classified infra error through the timeout-catch ack', async () => {
    stub.getFact.mockResolvedValue(makeErr(0, 'timed out', undefined, 'timeout'));
    const interaction = createButtonInteraction();

    await handleCorrectButton(interaction, 'fact-123');

    expect(showModalMock).not.toHaveBeenCalled();
    expect(ackMock).toHaveBeenCalled();
  });
});

describe('handler error branches', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('handleFactSelect: infra failure and genuine 404 both surface via followUp', async () => {
    const throwing = {
      ...createButtonInteraction(),
      values: ['fact-123'],
    } as unknown as StringSelectMenuInteraction;
    stub.getFact.mockResolvedValue(makeErr(500, 'boom'));
    await handleFactSelect(throwing);
    expect(throwing.followUp).toHaveBeenCalled();
    expect(throwing.editReply).not.toHaveBeenCalled();

    const missing = {
      ...createButtonInteraction(),
      values: ['fact-123'],
    } as unknown as StringSelectMenuInteraction;
    stub.getFact.mockResolvedValue(makeErr(404, 'gone'));
    await handleFactSelect(missing);
    expect(missing.followUp).toHaveBeenCalled();
  });

  it('handleCorrectModalSubmit: genuine 404 surfaces as not-found via followUp', async () => {
    stub.correctFact.mockResolvedValue(makeErr(404, 'gone'));
    const interaction = {
      user: { id: 'user-1' },
      fields: { getTextInputValue: vi.fn().mockReturnValue('x') },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handleCorrectModalSubmit(interaction, 'fact-123');

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('handleFactLockButton: 404 and infra failure surface via followUp', async () => {
    const gone = createButtonInteraction();
    stub.setFactLock.mockResolvedValue(makeErr(404, 'gone'));
    await handleFactLockButton(gone, 'fact-123', true);
    expect(gone.followUp).toHaveBeenCalled();

    const broken = createButtonInteraction();
    stub.setFactLock.mockResolvedValue(makeErr(500, 'boom'));
    await handleFactLockButton(broken, 'fact-123', true);
    expect(broken.followUp).toHaveBeenCalled();
  });

  it('handleForgetButton: 404 and infra failure surface via followUp (no confirm view)', async () => {
    const gone = createButtonInteraction();
    stub.getFact.mockResolvedValue(makeErr(404, 'gone'));
    await handleForgetButton(gone, 'fact-123');
    expect(gone.followUp).toHaveBeenCalled();
    expect(gone.editReply).not.toHaveBeenCalled();

    const broken = createButtonInteraction();
    stub.getFact.mockResolvedValue(makeErr(500, 'boom'));
    await handleForgetButton(broken, 'fact-123');
    expect(broken.followUp).toHaveBeenCalled();
  });

  it('handleForgetConfirm: a thrown failure surfaces via followUp and reports false', async () => {
    stub.forgetFact.mockResolvedValue(makeErr(500, 'boom'));
    const interaction = createButtonInteraction();

    expect(await handleForgetConfirm(interaction, 'fact-123')).toBe(false);
    expect(interaction.followUp).toHaveBeenCalled();
  });

  it('handleForgetConfirm: skips the defer when already deferred (router pre-ack)', async () => {
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-123', forgotten: true }));
    const interaction = {
      ...createButtonInteraction(),
      deferred: true,
    } as unknown as ButtonInteraction;

    expect(await handleForgetConfirm(interaction, 'fact-123')).toBe(true);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });
});
