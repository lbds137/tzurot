import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetchOrCreateSession, mockBuildSectionModal, mockParseDashboardCustomId } = vi.hoisted(
  () => ({
    mockFetchOrCreateSession: vi.fn(),
    mockBuildSectionModal: vi.fn(),
    mockParseDashboardCustomId: vi.fn(),
  })
);

vi.mock('./sessionHelpers.js', () => ({
  fetchOrCreateSession: mockFetchOrCreateSession,
}));

vi.mock('./ModalFactory.js', () => ({
  buildSectionModal: mockBuildSectionModal,
}));

vi.mock('./types.js', async () => {
  const actual = await vi.importActual('./types.js');
  return {
    ...actual,
    parseDashboardCustomId: mockParseDashboardCustomId,
  };
});

vi.mock('./messages.js', () => ({
  DASHBOARD_MESSAGES: {
    NOT_FOUND: (name: string) => `❌ ${name} not found.`,
    NO_PERMISSION: (action: string) => `❌ You don't have permission to ${action}.`,
  },
}));

import { handleDashboardSectionSelect } from './genericSelectMenuHandler.js';
import type { DashboardConfig } from './types.js';

interface TestData extends Record<string, unknown> {
  name: string;
  canEdit?: boolean;
}

interface TestRaw {
  id: string;
  rawName: string;
  rawCanEdit?: boolean;
}

const TEST_CONFIG: DashboardConfig<TestData> = {
  entityType: 'test',
  title: 'Test Dashboard',
  sections: [
    {
      id: 'section-a',
      title: 'Section A',
      fields: [{ id: 'name', label: 'Name', style: 1, required: true }],
    },
  ],
  // Other required fields filled with minimal stubs
} as never;

interface MockInteraction {
  customId: string;
  values: string[];
  user: { id: string };
  reply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
}

function createInteraction(customId: string, value: string): MockInteraction {
  return {
    customId,
    values: [value],
    user: { id: 'user-123' },
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

function createConfig(canEdit?: (data: TestData) => boolean): never {
  return {
    entityType: 'test',
    dashboardConfig: TEST_CONFIG,
    fetchFn: vi.fn().mockResolvedValue({ id: 'e1', rawName: 'Test', rawCanEdit: true }),
    transformFn: (raw: TestRaw): TestData => ({ name: raw.rawName, canEdit: raw.rawCanEdit }),
    entityName: 'Test',
    canEdit,
  } as never;
}

describe('handleDashboardSectionSelect', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns early when entityType does not match', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'other',
      entityId: 'e1',
    });
    const interaction = createInteraction('other::select::e1', 'edit-section-a');

    await handleDashboardSectionSelect(interaction as never, createConfig());

    expect(mockFetchOrCreateSession).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('returns early when entityId is missing', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'test',
      entityId: undefined,
    });
    const interaction = createInteraction('test::select::', 'edit-section-a');

    await handleDashboardSectionSelect(interaction as never, createConfig());

    expect(mockFetchOrCreateSession).not.toHaveBeenCalled();
  });

  it('ignores values that do not start with "edit-"', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'test',
      entityId: 'e1',
    });
    const interaction = createInteraction('test::select::e1', 'other-action');

    await handleDashboardSectionSelect(interaction as never, createConfig());

    expect(mockFetchOrCreateSession).not.toHaveBeenCalled();
  });

  it('shows error for unknown section', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'test',
      entityId: 'e1',
    });
    const interaction = createInteraction('test::select::e1', 'edit-bogus-section');

    await handleDashboardSectionSelect(interaction as never, createConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '❌ Unknown section.' })
    );
    expect(mockFetchOrCreateSession).not.toHaveBeenCalled();
  });

  it('shows not-found error when session fetch fails', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'test',
      entityId: 'e1',
    });
    mockFetchOrCreateSession.mockResolvedValue({ success: false, error: 'not_found' });
    const interaction = createInteraction('test::select::e1', 'edit-section-a');

    await handleDashboardSectionSelect(interaction as never, createConfig());

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '❌ Test not found.' })
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('shows no-permission error when canEdit returns false', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'test',
      entityId: 'e1',
    });
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Test', canEdit: false },
      fromCache: false,
    });
    const interaction = createInteraction('test::select::e1', 'edit-section-a');

    await handleDashboardSectionSelect(
      interaction as never,
      createConfig(data => data.canEdit === true)
    );

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "❌ You don't have permission to edit this test." })
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('builds and shows modal on successful flow', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'test',
      entityId: 'e1',
    });
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Test', canEdit: true },
      fromCache: false,
    });
    mockBuildSectionModal.mockReturnValue({ customId: 'modal-1' });
    const interaction = createInteraction('test::select::e1', 'edit-section-a');

    await handleDashboardSectionSelect(interaction as never, createConfig());

    expect(mockBuildSectionModal).toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledWith({ customId: 'modal-1' });
  });

  it('skips canEdit check when not provided', async () => {
    mockParseDashboardCustomId.mockReturnValue({
      entityType: 'test',
      entityId: 'e1',
    });
    mockFetchOrCreateSession.mockResolvedValue({
      success: true,
      data: { name: 'Test', canEdit: false }, // canEdit false but no check configured
      fromCache: false,
    });
    mockBuildSectionModal.mockReturnValue({ customId: 'modal-1' });
    const interaction = createInteraction('test::select::e1', 'edit-section-a');

    // No canEdit in config — should proceed regardless of data.canEdit
    await handleDashboardSectionSelect(interaction as never, createConfig());

    expect(interaction.showModal).toHaveBeenCalled();
  });
});
