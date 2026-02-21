import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processAvatarData } from './avatarProcessor.js';

vi.mock('./imageProcessor.js', () => ({
  optimizeAvatar: vi.fn(),
}));

import { optimizeAvatar } from './imageProcessor.js';

const mockOptimizeAvatar = vi.mocked(optimizeAvatar);

describe('processAvatarData', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when avatarData is undefined', async () => {
    const result = await processAvatarData(undefined, 'test-slug');
    expect(result).toBeNull();
    expect(mockOptimizeAvatar).not.toHaveBeenCalled();
  });

  it('returns null when avatarData is empty string', async () => {
    const result = await processAvatarData('', 'test-slug');
    expect(result).toBeNull();
    expect(mockOptimizeAvatar).not.toHaveBeenCalled();
  });

  it('returns ok result with buffer on successful optimization', async () => {
    const fakeBuffer = Buffer.from('optimized-image');
    mockOptimizeAvatar.mockResolvedValue({
      buffer: fakeBuffer,
      originalSizeKB: 100,
      processedSizeKB: 50,
      quality: 80,
      exceedsTarget: false,
    });

    const result = await processAvatarData('base64data', 'my-persona');

    expect(result).toEqual({ ok: true, buffer: fakeBuffer });
    expect(mockOptimizeAvatar).toHaveBeenCalledWith('base64data');
  });

  it('returns ok result even when avatar exceeds target size', async () => {
    const fakeBuffer = Buffer.from('large-image');
    mockOptimizeAvatar.mockResolvedValue({
      buffer: fakeBuffer,
      originalSizeKB: 500,
      processedSizeKB: 300,
      quality: 50,
      exceedsTarget: true,
    });

    const result = await processAvatarData('base64data', 'big-avatar');

    expect(result).toEqual({ ok: true, buffer: fakeBuffer });
  });

  it('returns error result when optimization throws', async () => {
    mockOptimizeAvatar.mockRejectedValue(new Error('Invalid image format'));

    const result = await processAvatarData('bad-data', 'broken-slug');

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result !== null && !result.ok) {
      expect(result.error.message).toContain('Failed to process avatar image');
    }
  });
});
