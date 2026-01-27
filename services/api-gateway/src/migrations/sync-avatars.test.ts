/**
 * Avatar Sync Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mock functions before they're used in vi.mock
const { mockWriteFile, mockAccess, mockUnlink, mockGlob, mockMkdir, mockFindMany, mockDisconnect } =
  vi.hoisted(() => ({
    mockWriteFile: vi.fn(),
    mockAccess: vi.fn(),
    mockUnlink: vi.fn(),
    mockGlob: vi.fn(),
    mockMkdir: vi.fn(),
    mockFindMany: vi.fn(),
    mockDisconnect: vi.fn(),
  }));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  access: mockAccess,
  unlink: mockUnlink,
  glob: mockGlob,
  mkdir: mockMkdir,
}));

// Mock Prisma client
vi.mock('@tzurot/common-types', () => ({
  getPrismaClient: () => ({
    personality: {
      findMany: mockFindMany,
    },
    $disconnect: mockDisconnect,
  }),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { syncAvatars } from './sync-avatars.js';

// Helper to create async generator for glob mock
function createAsyncGenerator(items: string[]): AsyncGenerator<string> {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

describe('syncAvatars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  it('should handle no personalities with avatar data', async () => {
    mockFindMany.mockResolvedValue([]);

    await syncAvatars();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { avatarData: { not: null } },
        select: { id: true, slug: true, avatarData: true, updatedAt: true },
        take: 100,
        orderBy: { id: 'asc' },
      })
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should sync avatar from database when file does not exist', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');
    const timestamp = updatedAt.getTime();

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'test-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockGlob.mockReturnValue(createAsyncGenerator([]));

    await syncAvatars();

    // Should ensure subdirectory exists
    expect(mockMkdir).toHaveBeenCalledWith('/data/avatars/t', { recursive: true });

    // Should write versioned file
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/data/avatars/t/test-bot-${timestamp}.png`,
      avatarBuffer
    );
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should skip syncing when versioned file already exists', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'existing-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockResolvedValue(undefined); // File exists

    await syncAvatars();

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should skip personalities with invalid slugs', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'invalid<script>slug', avatarData: avatarBuffer, updatedAt },
    ]);

    await syncAvatars();

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should cleanup old versions after syncing new avatar', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T12:00:00.000Z');
    const currentTimestamp = updatedAt.getTime();
    const oldTimestamp = 1705749600000; // older

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'test-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    // Glob returns current file and old version
    mockGlob.mockReturnValue(
      createAsyncGenerator([
        `/data/avatars/t/test-bot-${currentTimestamp}.png`,
        `/data/avatars/t/test-bot-${oldTimestamp}.png`,
      ])
    );

    await syncAvatars();

    // Should delete the old version, not the current one
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith(`/data/avatars/t/test-bot-${oldTimestamp}.png`);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should cleanup legacy files without timestamps', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');
    const timestamp = updatedAt.getTime();

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'test-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    // Glob returns legacy file without timestamp
    mockGlob.mockReturnValue(createAsyncGenerator(['/data/avatars/t/test-bot.png']));

    await syncAvatars();

    // Should delete the legacy file
    expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/t/test-bot.png');
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/data/avatars/t/test-bot-${timestamp}.png`,
      avatarBuffer
    );
  });

  it('should not delete files for different slugs with same prefix', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');
    const timestamp = updatedAt.getTime();

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'test', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    // Glob returns files for 'test' and 'test-bot' (different slug with same prefix)
    mockGlob.mockReturnValue(
      createAsyncGenerator([
        `/data/avatars/t/test-${timestamp}.png`,
        `/data/avatars/t/test-bot-${timestamp}.png`, // Different slug
      ])
    );

    await syncAvatars();

    // Should not delete test-bot (different slug)
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('should handle glob ENOENT gracefully (directory does not exist)', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'new-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    // Glob throws ENOENT (directory doesn't exist yet)
    const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
    enoentError.code = 'ENOENT';
    mockGlob.mockImplementation(() => {
      throw enoentError;
    });

    await syncAvatars();

    // Should still write the file
    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should rethrow non-ENOENT glob errors', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'test-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    // Glob throws permission error
    const permError = new Error('EACCES') as NodeJS.ErrnoException;
    permError.code = 'EACCES';
    mockGlob.mockImplementation(() => {
      throw permError;
    });

    await expect(syncAvatars()).rejects.toThrow('EACCES');
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should handle unlink errors gracefully for cleanup', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');
    const oldTimestamp = 1705749600000;

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'test-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockGlob.mockReturnValue(
      createAsyncGenerator([`/data/avatars/t/test-bot-${oldTimestamp}.png`])
    );

    // Unlink fails with permission error (should log warning but not throw)
    const permError = new Error('EACCES') as NodeJS.ErrnoException;
    permError.code = 'EACCES';
    mockUnlink.mockRejectedValue(permError);

    await syncAvatars();

    // Should still complete successfully
    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should ignore ENOENT errors during unlink (file already deleted)', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');
    const oldTimestamp = 1705749600000;

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'test-bot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockGlob.mockReturnValue(
      createAsyncGenerator([`/data/avatars/t/test-bot-${oldTimestamp}.png`])
    );

    // Unlink fails with ENOENT (file already deleted, should be silent)
    const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
    enoentError.code = 'ENOENT';
    mockUnlink.mockRejectedValue(enoentError);

    await syncAvatars();

    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should sync multiple personalities', async () => {
    const avatar1 = Buffer.from('avatar-1');
    const avatar2 = Buffer.from('avatar-2');
    const date1 = new Date('2024-01-20T10:00:00.000Z');
    const date2 = new Date('2024-01-21T10:00:00.000Z');

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'alpha', avatarData: avatar1, updatedAt: date1 },
      { id: 'p2', slug: 'beta', avatarData: avatar2, updatedAt: date2 },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockGlob.mockReturnValue(createAsyncGenerator([]));

    await syncAvatars();

    expect(mockMkdir).toHaveBeenCalledWith('/data/avatars/a', { recursive: true });
    expect(mockMkdir).toHaveBeenCalledWith('/data/avatars/b', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/data/avatars/a/alpha-${date1.getTime()}.png`,
      avatar1
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/data/avatars/b/beta-${date2.getTime()}.png`,
      avatar2
    );
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should handle database error and still disconnect', async () => {
    mockFindMany.mockRejectedValue(new Error('Database connection failed'));

    await expect(syncAvatars()).rejects.toThrow('Database connection failed');
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should use correct subdirectory based on slug first character', async () => {
    const avatarBuffer = Buffer.from('fake-png-data');
    const updatedAt = new Date('2024-01-20T10:00:00.000Z');

    mockFindMany.mockResolvedValue([
      { id: 'p1', slug: 'MyBot', avatarData: avatarBuffer, updatedAt },
    ]);
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockGlob.mockReturnValue(createAsyncGenerator([]));

    await syncAvatars();

    // Should use lowercase 'm' for subdirectory
    expect(mockMkdir).toHaveBeenCalledWith('/data/avatars/m', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/data/avatars/m/MyBot-${updatedAt.getTime()}.png`,
      avatarBuffer
    );
  });

  it('should use cursor-based pagination for large datasets', async () => {
    const avatar1 = Buffer.from('avatar-1');
    const avatar2 = Buffer.from('avatar-2');
    const date = new Date('2024-01-20T10:00:00.000Z');

    // First batch returns 100 items (batch size), second batch returns 1 item
    mockFindMany
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, i) => ({
          id: `p${i}`,
          slug: `bot${i}`,
          avatarData: avatar1,
          updatedAt: date,
        }))
      )
      .mockResolvedValueOnce([
        { id: 'p100', slug: 'bot100', avatarData: avatar2, updatedAt: date },
      ]);

    mockAccess.mockResolvedValue(undefined); // All files exist (skip writing)
    mockGlob.mockReturnValue(createAsyncGenerator([]));

    await syncAvatars();

    // Should call findMany twice (pagination)
    expect(mockFindMany).toHaveBeenCalledTimes(2);

    // Second call should use cursor from last item of first batch
    expect(mockFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: 'p99' },
        skip: 1,
      })
    );
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
