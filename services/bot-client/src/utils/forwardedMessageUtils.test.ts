/**
 * Forwarded Message Utilities Tests
 *
 * Tests for the centralized forwarded message detection and content extraction utilities.
 * These utilities are the SINGLE SOURCE OF TRUTH for handling Discord forwarded messages.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Message, MessageSnapshot, Collection } from 'discord.js';
import { ChannelType, MessageReferenceType, PermissionFlagsBits } from 'discord.js';
import {
  isForwardedMessage,
  hasForwardedSnapshots,
  getFirstSnapshot,
  getSnapshots,
  extractForwardedContent,
  extractForwardedAttachments,
  extractAllForwardedContent,
  hasForwardedVoiceAttachment,
  hasVoiceAttachments,
  getEffectiveContent,
  resolveForwardedOrigin,
} from './forwardedMessageUtils.js';

/**
 * Create a mock Discord message for testing
 */
function createMockMessage(options: {
  referenceType?: typeof MessageReferenceType.Forward | typeof MessageReferenceType.Default | null;
  referenceMessageId?: string;
  content?: string;
  snapshots?: Array<{
    content?: string;
    attachments?: Array<{
      url: string;
      contentType?: string | null;
      name?: string;
      size?: number;
      duration?: number;
      isVoiceMessage?: boolean;
    }>;
    embeds?: Array<{ title?: string; description?: string }>;
    stickers?: Array<{ id: string; name: string; format: number; url: string }>;
  }>;
  attachments?: Array<{
    url: string;
    contentType?: string;
    name?: string;
    size?: number;
    duration?: number | null;
  }>;
  embeds?: Array<{ title?: string; description?: string }>;
  stickers?: Array<{ id: string; name: string; format: number; url: string }>;
}): Message {
  // Create attachments map with Discord.js Collection-like .some() method
  const attachmentsMap = new Map() as Map<string, unknown> & {
    some: (fn: (a: unknown) => boolean) => boolean;
  };
  if (options.attachments) {
    options.attachments.forEach((att, index) => {
      attachmentsMap.set(`att-${index}`, {
        url: att.url,
        contentType: att.contentType ?? 'application/octet-stream',
        name: att.name ?? `file-${index}`,
        size: att.size ?? 1000,
        duration: att.duration ?? null,
      });
    });
  }
  attachmentsMap.some = (fn: (a: unknown) => boolean): boolean =>
    [...attachmentsMap.values()].some(fn);

  // Create messageSnapshots collection
  let messageSnapshots: Collection<string, MessageSnapshot> | undefined;
  if (options.snapshots && options.snapshots.length > 0) {
    const snapshotsMap = new Map();
    options.snapshots.forEach((snap, index) => {
      // Create snapshot attachments map
      const snapAttachments = new Map();
      if (snap.attachments) {
        snap.attachments.forEach((att, attIndex) => {
          snapAttachments.set(`snap-att-${attIndex}`, {
            url: att.url,
            // Preserve an explicit null (Discord omits content-type on some
            // forwarded snapshots) so the real extractAttachments normalization is
            // exercised; default only when the key is absent.
            contentType: 'contentType' in att ? att.contentType : 'application/octet-stream',
            name: att.name ?? `snap-file-${attIndex}`,
            size: att.size ?? 1000,
            duration: att.duration ?? null,
          });
        });
      }

      snapshotsMap.set(`snapshot-${index}`, {
        content: snap.content ?? '',
        attachments: snapAttachments,
        embeds: snap.embeds ?? [],
        // Discord keeps a forward's stickers on the SNAPSHOT, not on the
        // forwarding message — the shape the sticker extractor reads.
        stickers:
          snap.stickers === undefined ? undefined : new Map(snap.stickers.map(st => [st.id, st])),
      });
    });

    // Add Collection-like methods
    messageSnapshots = {
      size: snapshotsMap.size,
      values: () => snapshotsMap.values(),
      first: () => snapshotsMap.values().next().value,
    } as unknown as Collection<string, MessageSnapshot>;
  }

  // Create reference object
  const reference =
    options.referenceType !== null && options.referenceType !== undefined
      ? {
          type: options.referenceType,
          messageId: options.referenceMessageId,
        }
      : null;

  return {
    content: options.content ?? '',
    reference,
    messageSnapshots,
    attachments: attachmentsMap,
    embeds: options.embeds ?? [],
    stickers:
      options.stickers === undefined ? undefined : new Map(options.stickers.map(st => [st.id, st])),
  } as unknown as Message;
}

describe('forwardedMessageUtils', () => {
  describe('isForwardedMessage', () => {
    it('should return true for message with Forward reference type', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(isForwardedMessage(message)).toBe(true);
    });

    it('should return true for forwarded message even without snapshots', () => {
      // This is a key behavior - we detect forwarded messages by reference type only
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [], // No snapshots
      });

      expect(isForwardedMessage(message)).toBe(true);
    });

    it('should return false for regular message', () => {
      const message = createMockMessage({
        content: 'Hello',
      });

      expect(isForwardedMessage(message)).toBe(false);
    });

    it('should return false for reply message', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Default,
        content: 'This is a reply',
      });

      expect(isForwardedMessage(message)).toBe(false);
    });
  });

  describe('hasForwardedSnapshots', () => {
    it('should return true when forward message has snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Forwarded content' }],
      });

      expect(hasForwardedSnapshots(message)).toBe(true);
    });

    it('should return false when forward message has no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        // No snapshots
      });

      expect(hasForwardedSnapshots(message)).toBe(false);
    });

    it('should return false when forward message has empty snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [],
      });

      expect(hasForwardedSnapshots(message)).toBe(false);
    });

    it('should return true when snapshots exist even if reference type is Default', () => {
      // Snapshots only exist on forwarded messages, so their presence indicates forwarding
      // This handles cases where Discord API may not correctly set reference.type
      const message = createMockMessage({
        referenceType: MessageReferenceType.Default,
        snapshots: [{ content: 'Some content' }],
      });

      expect(hasForwardedSnapshots(message)).toBe(true);
    });
  });

  describe('getFirstSnapshot', () => {
    it('should return first snapshot from forwarded message', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'First snapshot' }, { content: 'Second snapshot' }],
      });

      const snapshot = getFirstSnapshot(message);

      expect(snapshot).toBeDefined();
      expect(snapshot?.content).toBe('First snapshot');
    });

    it('should return undefined when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(getFirstSnapshot(message)).toBeUndefined();
    });

    it('should return undefined for non-forwarded message', () => {
      const message = createMockMessage({
        content: 'Regular message',
      });

      expect(getFirstSnapshot(message)).toBeUndefined();
    });
  });

  describe('getSnapshots', () => {
    it('should return snapshots collection from forwarded message', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Snapshot 1' }, { content: 'Snapshot 2' }],
      });

      const snapshots = getSnapshots(message);

      expect(snapshots).toBeDefined();
      expect(snapshots?.size).toBe(2);
    });

    it('should return undefined when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(getSnapshots(message)).toBeUndefined();
    });
  });

  describe('extractForwardedContent', () => {
    it('should extract content from snapshot', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Content from forwarded message' }],
        content: '', // Main content empty
      });

      expect(extractForwardedContent(message)).toBe('Content from forwarded message');
    });

    it('should fall back to main content when snapshot is empty', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: '' }], // Empty snapshot content
        content: 'Fallback content',
      });

      expect(extractForwardedContent(message)).toBe('Fallback content');
    });

    it('should fall back to main content when no snapshots exist', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        content: 'Main message content',
        // No snapshots
      });

      expect(extractForwardedContent(message)).toBe('Main message content');
    });
  });

  describe('extractForwardedAttachments', () => {
    it('extracts a snapshot sticker as a synthetic image attachment', () => {
      // This walk collected regular attachments and embed images but skipped
      // stickers, so a forwarded sticker arrived name-only and vision never saw
      // it. The other media kinds beside it are the reason the omission was easy
      // to miss.
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            stickers: [
              {
                id: '55',
                name: 'thumbsup',
                format: 1, // StickerFormatType.PNG
                url: 'https://cdn.discordapp.com/stickers/55.png',
              },
            ],
          },
        ],
      });

      const result = extractForwardedAttachments(message);

      expect(result).toEqual([
        expect.objectContaining({ id: '55', isSticker: true, contentType: 'image/png' }),
      ]);
    });

    it('should extract attachments from snapshot', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/image.png',
                contentType: 'image/png',
                name: 'image.png',
              },
            ],
          },
        ],
      });

      const attachments = extractForwardedAttachments(message);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].url).toBe('https://cdn.discord.com/image.png');
      expect(attachments[0].contentType).toBe('image/png');
    });

    it('should extract attachments from multiple snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [{ url: 'https://cdn.discord.com/img1.png', contentType: 'image/png' }],
          },
          {
            attachments: [{ url: 'https://cdn.discord.com/img2.png', contentType: 'image/png' }],
          },
        ],
      });

      const attachments = extractForwardedAttachments(message);

      expect(attachments).toHaveLength(2);
    });

    it('should return empty array when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(extractForwardedAttachments(message)).toEqual([]);
    });

    it('should return empty array for non-forwarded message', () => {
      const message = createMockMessage({
        content: 'Regular message',
        attachments: [{ url: 'https://cdn.discord.com/file.txt' }],
      });

      // extractForwardedAttachments is specifically for forwarded message snapshots
      // For non-forwarded messages, it returns empty because there are no snapshots
      expect(extractForwardedAttachments(message)).toEqual([]);
    });
  });

  describe('extractAllForwardedContent', () => {
    it('should extract all content from snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        referenceMessageId: 'original-123',
        snapshots: [
          {
            content: 'Forwarded text',
            attachments: [{ url: 'https://cdn.discord.com/image.png', contentType: 'image/png' }],
            embeds: [{ title: 'Embed Title' }],
          },
        ],
      });

      const result = extractAllForwardedContent(message);

      expect(result.content).toBe('Forwarded text');
      expect(result.attachments).toHaveLength(1);
      expect(result.embeds).toHaveLength(1);
      expect(result.fromSnapshot).toBe(true);
      expect(result.originalMessageId).toBe('original-123');
    });

    it('should fall back to main message when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        referenceMessageId: 'original-456',
        content: 'Main content',
        attachments: [{ url: 'https://cdn.discord.com/main.png', contentType: 'image/png' }],
        embeds: [{ title: 'Main Embed' }],
      });

      const result = extractAllForwardedContent(message);

      expect(result.content).toBe('Main content');
      expect(result.attachments).toHaveLength(1);
      expect(result.embeds).toHaveLength(1);
      expect(result.fromSnapshot).toBe(false);
      expect(result.originalMessageId).toBe('original-456');
    });
  });

  describe('hasForwardedVoiceAttachment', () => {
    it('should return true when forwarded message has voice attachment', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice.ogg',
                contentType: 'audio/ogg',
                duration: 5.5,
                isVoiceMessage: true,
              },
            ],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(true);
    });

    it('should return true when forwarded attachment has audio contentType and duration', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice.ogg',
                contentType: 'audio/ogg',
                duration: 10,
              },
            ],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(true);
    });

    it('should return false when forwarded video has duration but no audio contentType', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/clip.mp4',
                contentType: 'video/mp4',
                duration: 15,
              },
            ],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(false);
    });

    it('should detect a forwarded voice snapshot when Discord omits the content-type', () => {
      // Reads the precomputed isVoiceMessage flag (set on the RAW attachment before
      // extractAttachments normalizes null → octet-stream), so the duration fallback
      // still applies. Calling isVoiceAttachment on the normalized metadata would
      // miss this case.
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice/forwarded.ogg',
                contentType: null,
                duration: 6.5,
              },
            ],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(true);
    });

    it('should return false when forwarded message has no voice attachments', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [{ url: 'https://cdn.discord.com/image.png', contentType: 'image/png' }],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(false);
    });

    it('should return false for non-forwarded message', () => {
      const message = createMockMessage({
        content: 'Regular message',
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(false);
    });
  });

  describe('getEffectiveContent', () => {
    it('should return message content for regular messages', () => {
      const message = createMockMessage({
        content: 'Hello world!',
      });

      expect(getEffectiveContent(message)).toBe('Hello world!');
    });

    it('should return snapshot content for forwarded messages', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Forwarded content here' }],
        content: '', // Main content empty
      });

      expect(getEffectiveContent(message)).toBe('Forwarded content here');
    });

    it('should return main content for forwarded message without snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        content: 'Fallback content from main',
        // No snapshots
      });

      expect(getEffectiveContent(message)).toBe('Fallback content from main');
    });

    it('should return main content when the snapshot exists but is empty', () => {
      // A present-but-empty snapshot must fall back the same way a missing
      // snapshot does — otherwise the forward reads as a blank message.
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: '' }],
        content: 'fallback content',
      });

      expect(getEffectiveContent(message)).toBe('fallback content');
    });

    it('should return first snapshot content when multiple exist', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'First' }, { content: 'Second' }],
      });

      expect(getEffectiveContent(message)).toBe('First');
    });

    it('should return reply message content (not forwarded)', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Default,
        content: 'My reply',
      });

      expect(getEffectiveContent(message)).toBe('My reply');
    });
  });

  describe('hasVoiceAttachments', () => {
    it('should return true for voice message (audio contentType + duration)', () => {
      const message = createMockMessage({
        content: '',
        attachments: [
          {
            url: 'https://cdn.discord.com/voice.ogg',
            contentType: 'audio/ogg',
            duration: 5.5,
          },
        ],
      });

      expect(hasVoiceAttachments(message)).toBe(true);
    });

    it('should return false for audio file upload without duration (not a voice message)', () => {
      const message = createMockMessage({
        content: '',
        attachments: [{ url: 'https://cdn.discord.com/song.mp3', contentType: 'audio/mpeg' }],
      });

      expect(hasVoiceAttachments(message)).toBe(false);
    });

    it('should return false for video attachment with duration (not a voice message)', () => {
      const message = createMockMessage({
        content: '',
        attachments: [
          {
            url: 'https://cdn.discord.com/clip.mp4',
            contentType: 'video/mp4',
            duration: 10.0,
          },
        ],
      });

      expect(hasVoiceAttachments(message)).toBe(false);
    });

    it('should return false for non-audio attachment', () => {
      const message = createMockMessage({
        content: 'Hello',
        attachments: [{ url: 'https://cdn.discord.com/image.png', contentType: 'image/png' }],
      });

      expect(hasVoiceAttachments(message)).toBe(false);
    });

    it('should return false when no attachments', () => {
      const message = createMockMessage({ content: 'Hello' });

      expect(hasVoiceAttachments(message)).toBe(false);
    });
  });
  /**
   * Its own builder rather than the shared `createMockMessage`: this is the only
   * group that needs a client, a channel and a snapshot timestamp, and widening
   * the shared one would hand every other group a channel it never asked for.
   */
  describe('resolveForwardedOrigin', () => {
    /** Distinct from every snapshot timestamp used below, so the two are never confusable. */
    const DEFAULT_ORIGINAL_CREATED_AT = new Date(Date.UTC(2026, 7, 19, 9, 0, 0));

    function buildForward(options: {
      snapshotCreatedTimestamp?: number | null;
      referenceChannelId?: string;
      referenceMessageId?: string;
      fetchedAuthor?: { id: string; displayName: string };
      /**
       * Creation time of the FETCHED original. Every real Discord message has
       * one, and it is the fallback the resolver uses when a REST re-fetch left
       * the snapshot timestamp absent.
       */
      fetchedCreatedAt?: Date;
      /** Marks the fetched original as webhook-authored. */
      fetchedWebhookId?: string;
      fetchRejects?: boolean;
      channelFetch?: ReturnType<typeof vi.fn>;
      messagesFetch?: ReturnType<typeof vi.fn>;
      clientUserTag?: string;
      channelType?: number;
      /** The origin channel's display name, for the `channel=` attribution. */
      channelName?: string;
      /** Whether the origin channel is a DM — narrows the attribution gate off entirely. */
      channelIsDM?: boolean;
      /**
       * What `channel.permissionsFor(forwarderId)` returns — `null` for an
       * uncached/unresolvable member (the default, matching Discord's own
       * fail shape), or a bitfield-like object for a resolved one.
       */
      permissionsForResult?: { has: (flag: bigint) => boolean } | null;
      /**
       * Whether the origin channel is a thread. Combined with `channelType`
       * PrivateThread, this is what reaches the membership lookup — a public
       * thread is a thread but must NOT trigger it.
       */
      channelIsThread?: boolean;
      /**
       * What `thread.members.fetch(forwarderId)` does. Discord's manager
       * THROWS for a non-member rather than resolving null, so the rejecting
       * shape is the real non-member fixture.
       */
      threadMembersFetch?: ReturnType<typeof vi.fn>;
    }): Message {
      const messagesFetch =
        options.messagesFetch ??
        vi.fn(() =>
          options.fetchRejects === true
            ? Promise.reject(new Error('Unknown Message'))
            : Promise.resolve({
                author: options.fetchedAuthor,
                webhookId: options.fetchedWebhookId ?? null,
                createdAt: options.fetchedCreatedAt ?? DEFAULT_ORIGINAL_CREATED_AT,
              })
        );
      const channel = {
        id: 'channel-1',
        type: options.channelType ?? 0,
        name: options.channelName,
        isTextBased: () => true,
        isDMBased: () => options.channelIsDM ?? false,
        isThread: () => options.channelIsThread ?? false,
        permissionsFor: vi.fn(() => options.permissionsForResult ?? null),
        members: {
          fetch: options.threadMembersFetch ?? vi.fn(() => Promise.resolve({ id: 'forwarder-1' })),
        },
        messages: { fetch: messagesFetch },
      };
      const snapshot = { createdTimestamp: options.snapshotCreatedTimestamp ?? null };

      return {
        id: 'forward-1',
        content: '',
        channel,
        author: { id: 'forwarder-1' },
        client: {
          user: options.clientUserTag !== undefined ? { tag: options.clientUserTag } : undefined,
          channels: { fetch: options.channelFetch ?? vi.fn(() => Promise.resolve(channel)) },
        },
        reference: {
          type: MessageReferenceType.Forward,
          channelId: options.referenceChannelId ?? 'channel-1',
          messageId: options.referenceMessageId ?? 'original-1',
        },
        messageSnapshots: {
          size: 1,
          values: () => [snapshot].values(),
          first: () => snapshot,
        },
      } as unknown as Message;
    }

    it('recovers the original author and post time', async () => {
      const origin = await resolveForwardedOrigin(
        buildForward({
          snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
          fetchedAuthor: { id: '1472768398135001108', displayName: 'COLD' },
        })
      );

      expect(origin).toEqual({
        timestamp: '2026-08-18T11:13:53.000Z',
        authorName: 'COLD',
        authorId: '1472768398135001108',
      });
    });

    it("strips our bot suffix from a webhook-authored original's name", async () => {
      // A webhook author's displayName IS the webhook username, so a
      // character's message previously persisted as "COLD · Tzurot" — the
      // bot's own name injected into a character attribution.
      const origin = await resolveForwardedOrigin(
        buildForward({
          fetchedAuthor: { id: 'wh-1', displayName: 'COLD · Tzurot' },
          fetchedWebhookId: 'webhook-1',
          clientUserTag: 'Tzurot#1234',
        })
      );

      expect(origin?.authorName).toBe('COLD');
    });

    it('passes the raw name through when the client user tag is unavailable', async () => {
      // Degraded branch: no tag, no derivable suffix — raw name over guessing.
      const origin = await resolveForwardedOrigin(
        buildForward({
          fetchedAuthor: { id: 'wh-1', displayName: 'COLD · Tzurot' },
          fetchedWebhookId: 'webhook-1',
        })
      );

      expect(origin?.authorName).toBe('COLD · Tzurot');
    });

    it('leaves a foreign webhook name without our suffix unchanged', async () => {
      const origin = await resolveForwardedOrigin(
        buildForward({
          fetchedAuthor: { id: 'wh-2', displayName: 'Some Other Bot' },
          fetchedWebhookId: 'webhook-2',
          clientUserTag: 'Tzurot#1234',
        })
      );

      expect(origin?.authorName).toBe('Some Other Bot');
    });

    it("classifies the ORIGIN channel's surface for the personality lookup, not the landing channel's", async () => {
      // A DM-origin forward landing in a guild: the validator decides what
      // shape the ORIGINAL must have, so classifying the landing channel
      // silently rejects both cross-surface directions.
      const dmChannel = {
        id: 'dm-1',
        type: 1, // ChannelType.DM
        isTextBased: () => true,
        isDMBased: () => true,
        messages: {
          fetch: vi.fn(() =>
            Promise.resolve({
              author: { id: 'bot-1', displayName: 'COLD' },
              webhookId: null,
              createdAt: DEFAULT_ORIGINAL_CREATED_AT,
            })
          ),
        },
      };
      const resolver = vi.fn((_original: unknown, _viewerId: string, _isDM: boolean) =>
        Promise.resolve('personality-uuid')
      );

      await resolveForwardedOrigin(
        buildForward({
          referenceChannelId: 'dm-1',
          channelFetch: vi.fn(() => Promise.resolve(dmChannel)),
        }),
        resolver
      );

      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver.mock.calls[0][2]).toBe(true); // the ORIGIN is a DM
    });

    it('fetches from the reference channel, not the channel the forward landed in', async () => {
      const otherChannelMessagesFetch = vi.fn(() =>
        Promise.resolve({
          author: { id: 'author-9', displayName: 'Elsewhere' },
          createdAt: DEFAULT_ORIGINAL_CREATED_AT,
        })
      );
      const channelFetch = vi.fn(() =>
        Promise.resolve({
          id: 'channel-2',
          isTextBased: () => true,
          isDMBased: () => false,
          permissionsFor: () => null,
          messages: { fetch: otherChannelMessagesFetch },
        })
      );

      const origin = await resolveForwardedOrigin(
        buildForward({ referenceChannelId: 'channel-2', channelFetch })
      );

      // The seam that matters: a cross-channel forward must resolve against the
      // reference's own channel. Fetching the right id from the wrong channel
      // throws, and the fail-open catch would hide it as "unattributed".
      expect(channelFetch).toHaveBeenCalledWith('channel-2');
      expect(otherChannelMessagesFetch).toHaveBeenCalledWith('original-1');
      expect(origin?.authorName).toBe('Elsewhere');
    });

    it("falls back to the fetched original's creation time when the snapshot has none", async () => {
      // A REST re-fetch can omit snapshot data entirely (see
      // extractForwardedContent), which is exactly what the extended-context
      // path does — so without this the whole path renders with no t=.
      const origin = await resolveForwardedOrigin(
        buildForward({
          snapshotCreatedTimestamp: null,
          fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
          fetchedCreatedAt: new Date(Date.UTC(2026, 7, 19, 9, 0, 0)),
        })
      );

      expect(origin?.timestamp).toBe('2026-08-19T09:00:00.000Z');
    });

    it('prefers the snapshot timestamp over the fetched original', async () => {
      const origin = await resolveForwardedOrigin(
        buildForward({
          snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
          fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
          fetchedCreatedAt: new Date(Date.UTC(2026, 7, 19, 9, 0, 0)),
        })
      );

      expect(origin?.timestamp).toBe('2026-08-18T11:13:53.000Z');
    });

    it('keeps the timestamp when the original can no longer be fetched', async () => {
      const origin = await resolveForwardedOrigin(
        buildForward({
          snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
          fetchRejects: true,
        })
      );

      // The two halves cost different things, so they fail independently: the
      // timestamp comes off the snapshot and survives a deleted original.
      expect(origin).toEqual({ timestamp: '2026-08-18T11:13:53.000Z' });
    });

    it('returns undefined when nothing at all is recoverable', async () => {
      const origin = await resolveForwardedOrigin(
        buildForward({ snapshotCreatedTimestamp: null, fetchRejects: true })
      );

      // Not an empty object — persistence gates on undefined so an unresolvable
      // forward writes no metadata key rather than an empty one.
      expect(origin).toBeUndefined();
    });

    it('hands the personality resolver the ORIGINAL, with the forwarder as viewer', async () => {
      const original = {
        author: { id: 'webhook-1', displayName: 'COLD' },
        createdAt: DEFAULT_ORIGINAL_CREATED_AT,
      };
      const resolver = vi.fn(() => Promise.resolve('personality-uuid-cold'));
      const messagesFetch = vi.fn(() => Promise.resolve(original));

      const forward = buildForward({ messagesFetch });
      // The forwarder — distinct from the webhook that authored the original,
      // so a mix-up between the two is visible rather than coincidental.
      (forward as unknown as { author: { id: string } }).author = { id: 'forwarder-1' };

      const origin = await resolveForwardedOrigin(forward, resolver);

      // Passing the FORWARD here instead would send the resolver back through
      // a reply-shaped lookup that reads the landing channel — silently wrong
      // for every cross-channel forward, and swallowed by its own catch.
      expect(resolver).toHaveBeenCalledWith(original, 'forwarder-1', false);
      expect(origin?.authorPersonalityId).toBe('personality-uuid-cold');
      // And exactly ONE fetch of the original: the resolver reuses it rather
      // than fetching a second time.
      expect(messagesFetch).toHaveBeenCalledTimes(1);
    });

    it('keeps the rest of the origin when the personality resolver yields nothing', async () => {
      const resolver = vi.fn(() => Promise.resolve(undefined));

      const origin = await resolveForwardedOrigin(
        buildForward({
          snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
          fetchedAuthor: { id: 'webhook-1', displayName: 'COLD' },
        }),
        resolver
      );

      // A forward of a HUMAN's message resolves to no personality, and that
      // must not cost the display name or the timestamp.
      expect(origin).toEqual({
        timestamp: '2026-08-18T11:13:53.000Z',
        authorName: 'COLD',
        authorId: 'webhook-1',
        authorPersonalityId: undefined,
      });
    });

    it('skips a reference that resolves to a non-text channel', async () => {
      const messagesFetch = vi.fn();
      const channelFetch = vi.fn(() =>
        Promise.resolve({
          id: 'channel-2',
          isTextBased: () => false,
          messages: { fetch: messagesFetch },
        })
      );

      const origin = await resolveForwardedOrigin(
        buildForward({
          snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
          referenceChannelId: 'channel-2',
          channelFetch,
        })
      );

      // Never reaches the message fetch, and the free half still survives.
      expect(messagesFetch).not.toHaveBeenCalled();
      expect(origin).toEqual({ timestamp: '2026-08-18T11:13:53.000Z' });
    });

    it('returns undefined for a message that is not a forward', async () => {
      const origin = await resolveForwardedOrigin(
        createMockMessage({ referenceType: MessageReferenceType.Default, content: 'a reply' })
      );

      expect(origin).toBeUndefined();
    });

    describe('channel attribution', () => {
      it('populates channelName when the forwarder can view the origin channel', async () => {
        const origin = await resolveForwardedOrigin(
          buildForward({
            snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
            fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
            channelName: 'general',
            permissionsForResult: { has: flag => flag === PermissionFlagsBits.ViewChannel },
          })
        );

        expect(origin?.channelName).toBe('general');
      });

      it('omits channelName when the forwarder lacks ViewChannel on the origin channel', async () => {
        const origin = await resolveForwardedOrigin(
          buildForward({
            snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
            fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
            channelName: 'secret-channel',
            // Resolved, but WITHOUT ViewChannel — a distinct fail-closed path
            // from the unresolvable-member case below.
            permissionsForResult: { has: () => false },
          })
        );

        expect(origin?.channelName).toBeUndefined();
      });

      it('omits channelName when the origin member cannot be resolved from cache', async () => {
        const origin = await resolveForwardedOrigin(
          buildForward({
            snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
            fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
            channelName: 'general',
            // permissionsFor returns null — the default, and a DIFFERENT
            // fail-closed path than a resolved bitfield missing ViewChannel.
            permissionsForResult: null,
          })
        );

        expect(origin?.channelName).toBeUndefined();
      });

      it('names a PRIVATE thread the forwarder is still a member of', async () => {
        const threadMembersFetch = vi.fn(() => Promise.resolve({ id: 'forwarder-1' }));

        const origin = await resolveForwardedOrigin(
          buildForward({
            snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
            fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
            channelName: 'private-planning',
            channelType: ChannelType.PrivateThread,
            channelIsThread: true,
            permissionsForResult: { has: flag => flag === PermissionFlagsBits.ViewChannel },
            threadMembersFetch,
          })
        );

        expect(origin?.channelName).toBe('private-planning');
        expect(threadMembersFetch).toHaveBeenCalledWith('forwarder-1');
      });

      it('omits a PRIVATE thread name when the forwarder is no longer a member', async () => {
        // The gap ViewChannel alone cannot see: threads hold no overwrites of
        // their own, so `permissionsFor` reports the PARENT's — which someone
        // removed from the thread typically still has.
        const origin = await resolveForwardedOrigin(
          buildForward({
            snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
            fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
            channelName: 'private-planning',
            channelType: ChannelType.PrivateThread,
            channelIsThread: true,
            // Parent ViewChannel still granted — this is the whole point.
            permissionsForResult: { has: flag => flag === PermissionFlagsBits.ViewChannel },
            threadMembersFetch: vi.fn(() => Promise.reject(new Error('Unknown Member'))),
          })
        );

        expect(origin?.channelName).toBeUndefined();
      });

      it('names a PUBLIC thread without a membership lookup', async () => {
        // Public and announcement threads are treated as inheriting parent
        // access, matching the reasoning already recorded in
        // `LinkExtractor.verifyInvokerCanAccessSource`; not independently
        // probed against Discord here. Skipping the lookup for them keeps
        // this PR's no-extra-REST property everywhere but private threads.
        const threadMembersFetch = vi.fn(() => Promise.resolve({ id: 'forwarder-1' }));

        const origin = await resolveForwardedOrigin(
          buildForward({
            snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
            fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
            channelName: 'public-thread',
            channelType: ChannelType.PublicThread,
            channelIsThread: true,
            permissionsForResult: { has: flag => flag === PermissionFlagsBits.ViewChannel },
            threadMembersFetch,
          })
        );

        expect(origin?.channelName).toBe('public-thread');
        expect(threadMembersFetch).not.toHaveBeenCalled();
      });

      it('names an ANNOUNCEMENT thread without a membership lookup', async () => {
        // The docstring claims announcement threads inherit parent access
        // alongside public ones; without this the claim rests on the enum
        // value never being constructed in a test.
        const threadMembersFetch = vi.fn(() => Promise.resolve({ id: 'forwarder-1' }));

        const origin = await resolveForwardedOrigin(
          buildForward({
            snapshotCreatedTimestamp: Date.UTC(2026, 7, 18, 11, 13, 53),
            fetchedAuthor: { id: 'author-1', displayName: 'COLD' },
            channelName: 'announcements-thread',
            channelType: ChannelType.AnnouncementThread,
            channelIsThread: true,
            permissionsForResult: { has: flag => flag === PermissionFlagsBits.ViewChannel },
            threadMembersFetch,
          })
        );

        expect(origin?.channelName).toBe('announcements-thread');
        expect(threadMembersFetch).not.toHaveBeenCalled();
      });

      it('omits channelName for a DM origin and never calls permissionsFor', async () => {
        const permissionsFor = vi.fn(() => ({ has: () => true }));
        const messagesFetch = vi.fn(() =>
          Promise.resolve({
            author: { id: 'author-1', displayName: 'COLD' },
            webhookId: null,
            createdAt: DEFAULT_ORIGINAL_CREATED_AT,
          })
        );
        const dmChannel = {
          id: 'dm-2',
          isTextBased: () => true,
          isDMBased: () => true,
          permissionsFor,
          messages: { fetch: messagesFetch },
        };

        const origin = await resolveForwardedOrigin(
          buildForward({
            referenceChannelId: 'dm-2',
            channelFetch: vi.fn(() => Promise.resolve(dmChannel)),
          })
        );

        expect(origin?.channelName).toBeUndefined();
        expect(permissionsFor).not.toHaveBeenCalled();
      });
    });
  });
});
