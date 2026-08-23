import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { HttpError } from '../../utils/attachmentFetch.js';
import { ExpiredCdnUrlError } from '../../utils/discordCdnExpiry.js';

const mockDownloadImageToDataUrl = vi.fn();
vi.mock('../../utils/imageToDataUrl.js', () => ({
  downloadImageToDataUrl: (url: string, opts: unknown) => mockDownloadImageToDataUrl(url, opts),
}));

import { resolveVisionImageUrl } from './visionImageResolver.js';

const mockAttachment: AttachmentMetadata = {
  id: '123456789012345678',
  url: 'https://cdn.discordapp.com/test-image.png',
  name: 'test-image.png',
  contentType: 'image/png',
  size: 1024,
};

describe('resolveVisionImageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the data URL untouched without downloading', async () => {
    const result = await resolveVisionImageUrl(
      { ...mockAttachment, url: 'data:image/jpeg;base64,ZmFrZQ==' },
      {}
    );
    expect(result).toEqual({ kind: 'resolved', imageUrl: 'data:image/jpeg;base64,ZmFrZQ==' });
    expect(mockDownloadImageToDataUrl).not.toHaveBeenCalled();
  });

  it('resolves to the downloaded data URL on success', async () => {
    mockDownloadImageToDataUrl.mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,cmVzaXplZA==',
      bytes: 4,
    });

    const result = await resolveVisionImageUrl(mockAttachment, {});

    expect(result).toEqual({ kind: 'resolved', imageUrl: 'data:image/jpeg;base64,cmVzaXplZA==' });
  });

  it('reports "dead" for an ExpiredCdnUrlError', async () => {
    mockDownloadImageToDataUrl.mockRejectedValue(new ExpiredCdnUrlError(Date.now() - 1000));

    const result = await resolveVisionImageUrl(mockAttachment, {});

    expect(result).toEqual({ kind: 'dead', reason: 'discord-cdn-url-expired' });
  });

  it('reports "dead" for a 403 on a Discord-CDN URL', async () => {
    mockDownloadImageToDataUrl.mockRejectedValue(new HttpError(403, 'Forbidden'));

    const result = await resolveVisionImageUrl(mockAttachment, {});

    expect(result).toEqual({ kind: 'dead', reason: 'discord-cdn-http-403' });
  });

  it('reports "dead" for a 404 on a Discord-CDN URL', async () => {
    mockDownloadImageToDataUrl.mockRejectedValue(new HttpError(404, 'Not Found'));

    const result = await resolveVisionImageUrl(mockAttachment, {});

    expect(result).toEqual({ kind: 'dead', reason: 'discord-cdn-http-404' });
  });

  it('falls back to the original URL for a 403/404 on a NON-Discord-CDN URL', async () => {
    mockDownloadImageToDataUrl.mockRejectedValue(new HttpError(404, 'Not Found'));

    const result = await resolveVisionImageUrl(
      { ...mockAttachment, url: 'https://i.redd.it/x.jpg' },
      {}
    );

    expect(result).toEqual({ kind: 'resolved', imageUrl: 'https://i.redd.it/x.jpg' });
  });

  it('falls back to the original URL for any other download failure', async () => {
    mockDownloadImageToDataUrl.mockRejectedValue(new Error('host blocked our egress'));

    const result = await resolveVisionImageUrl(mockAttachment, {});

    expect(result).toEqual({ kind: 'resolved', imageUrl: mockAttachment.url });
  });
});
