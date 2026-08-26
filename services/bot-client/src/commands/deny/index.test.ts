/**
 * Deny Command Router
 *
 * Covers only the group-dispatch seam in `execute()`: group `add`/`remove`
 * must route to their scope-group handlers, and everything else must fall
 * through to the flat subcommand router (`browse`/`view`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeCommandContext } from '../../utils/defineCommand.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    })),
  };
});

// Registration side effect only — importing it for real would pull in
// browse.js's fetchEntries/buildBrowseResponse, which the browse.js mock
// below does not provide.
vi.mock('./browseRebuilder.js', () => ({}));

const mockHandleAdd = vi.fn();
vi.mock('./add.js', () => ({
  handleAdd: (...args: unknown[]) => mockHandleAdd(...args),
}));

const mockHandleRemove = vi.fn();
vi.mock('./remove.js', () => ({
  handleRemove: (...args: unknown[]) => mockHandleRemove(...args),
}));

const mockHandleView = vi.fn();
vi.mock('./view.js', () => ({
  handleView: (...args: unknown[]) => mockHandleView(...args),
}));

const mockHandleBrowse = vi.fn();
vi.mock('./browse.js', () => ({
  handleBrowse: (...args: unknown[]) => mockHandleBrowse(...args),
  handleBrowsePagination: vi.fn(),
  handleBrowseSelect: vi.fn(),
  isDenyBrowseInteraction: vi.fn(() => false),
  isDenyBrowseSelectInteraction: vi.fn(() => false),
}));

vi.mock('./detail.js', () => ({
  handleDetailButton: vi.fn(),
  handleDetailModal: vi.fn(),
}));

// Imported after the mocks above so the module picks up the mocked deps.
const { default: denyCommand } = await import('./index.js');

function createMockContext(group: string | null, subcommand: string | null): SafeCommandContext {
  return {
    user: { id: 'user-123' },
    getSubcommandGroup: vi.fn(() => group),
    getSubcommand: vi.fn(() => subcommand),
    editReply: vi.fn(),
  } as unknown as SafeCommandContext;
}

describe('deny execute() group dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes group "add" to handleAdd and not handleRemove', async () => {
    const context = createMockContext('add', 'everywhere');

    await denyCommand.execute(context);

    expect(mockHandleAdd).toHaveBeenCalledWith(context);
    expect(mockHandleRemove).not.toHaveBeenCalled();
    expect(mockHandleBrowse).not.toHaveBeenCalled();
  });

  it('routes group "remove" to handleRemove and not handleAdd', async () => {
    const context = createMockContext('remove', 'everywhere');

    await denyCommand.execute(context);

    expect(mockHandleRemove).toHaveBeenCalledWith(context);
    expect(mockHandleAdd).not.toHaveBeenCalled();
    expect(mockHandleBrowse).not.toHaveBeenCalled();
  });

  it('falls through to the flat router for a null group, without calling either group handler', async () => {
    const context = createMockContext(null, 'browse');

    await denyCommand.execute(context);

    expect(mockHandleAdd).not.toHaveBeenCalled();
    expect(mockHandleRemove).not.toHaveBeenCalled();
    expect(mockHandleBrowse).toHaveBeenCalledWith(context);
  });
});
