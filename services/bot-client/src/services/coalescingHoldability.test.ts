import { describe, it, expect } from 'vitest';
import { Collection, MessageFlags, type Attachment, type Message } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { hasImageOrFileAttachment, isHoldableActivationSlot } from './coalescingHoldability.js';
import type { ResolvedSlot, SlotSource } from './SlotResolver.js';

function buildPersonality(id = 'pers-1', name = 'Alice'): LoadedPersonality {
  return {
    id,
    name,
    displayName: name,
    slug: name.toLowerCase(),
  } as unknown as LoadedPersonality;
}

function buildSlot(
  source: SlotSource = 'activation',
  personality = buildPersonality()
): ResolvedSlot {
  return {
    personality,
    source,
    isAutoResponse: source === 'activation',
  };
}

function buildAttachment(
  id: string,
  contentType: string | null,
  name: string | null,
  duration: number | null = null
): Attachment {
  return {
    id,
    contentType,
    name,
    duration,
    url: `https://cdn.discordapp.com/attachments/1/${id}/${name ?? 'file'}`,
  } as unknown as Attachment;
}

// Ascending Discord-style createdTimestamp per constructed message (fake timers
// freeze Date.now, hence the counter).
let timestampCounter = 0;
const nextTimestamp = (): number => 1_700_000_000_000 + ++timestampCounter;

function buildMessage(
  id: string,
  authorId = 'user-1',
  attachments: Attachment[] = [],
  snapshotAttachments: Attachment[] = [],
  createdTimestamp: number = nextTimestamp(),
  isVoice = false
): Message {
  const attachmentCollection = new Collection<string, Attachment>();
  for (const att of attachments) {
    attachmentCollection.set(att.id, att);
  }
  const snapshots = new Collection<string, { attachments: Collection<string, Attachment> }>();
  if (snapshotAttachments.length > 0) {
    const snapCol = new Collection<string, Attachment>();
    for (const att of snapshotAttachments) {
      snapCol.set(att.id, att);
    }
    snapshots.set('snap-1', { attachments: snapCol });
  }
  return {
    id,
    author: { id: authorId },
    guildId: 'guild-1',
    client: { user: { id: 'bot-1' } },
    createdTimestamp,
    ...(isVoice
      ? {
          flags: {
            has: (flag: MessageFlags) => flag === MessageFlags.IsVoiceMessage,
          },
        }
      : {}),
    attachments: attachmentCollection,
    messageSnapshots: snapshots,
  } as unknown as Message;
}

describe('isHoldableActivationSlot & hasImageOrFileAttachment', () => {
  it('returns true for plain-text activation slots and voice-only activation slots', () => {
    const slot = buildSlot('activation');
    const plainMsg = buildMessage('m-plain');
    const voiceMsg = buildMessage(
      'm-voice',
      'user-1',
      [buildAttachment('att-1', 'audio/ogg', 'voice-message.ogg', 5)],
      [],
      undefined,
      true
    );

    expect(hasImageOrFileAttachment(plainMsg)).toBe(false);
    expect(hasImageOrFileAttachment(voiceMsg)).toBe(false);
    expect(isHoldableActivationSlot(plainMsg, slot)).toBe(true);
    expect(isHoldableActivationSlot(voiceMsg, slot)).toBe(true);
  });

  it('treats a non-voice audio upload like a file for holdability; voice-flagged audio stays holdable', () => {
    const slot = buildSlot('activation');
    const plainAudioMsg = buildMessage('m-mp3', 'user-1', [
      buildAttachment('att-mp3', 'audio/mpeg', 'song.mp3'),
    ]);
    const voiceMsg = buildMessage(
      'm-voice2',
      'user-1',
      [buildAttachment('att-voice2', 'audio/ogg', 'voice-message.ogg', 7)],
      [],
      undefined,
      true
    );

    expect(hasImageOrFileAttachment(plainAudioMsg)).toBe(true);
    expect(hasImageOrFileAttachment(voiceMsg)).toBe(false);
    expect(isHoldableActivationSlot(plainAudioMsg, slot)).toBe(false);
    expect(isHoldableActivationSlot(voiceMsg, slot)).toBe(true);
  });

  it('returns false for image and file/document attachments (direct or forwarded)', () => {
    const slot = buildSlot('activation');
    const imageMsg = buildMessage('m-img', 'user-1', [
      buildAttachment('att-img', 'image/png', 'photo.png'),
    ]);
    const fileMsg = buildMessage('m-pdf', 'user-1', [
      buildAttachment('att-pdf', 'application/pdf', 'doc.pdf'),
    ]);
    const forwardedImageMsg = buildMessage(
      'm-fwd',
      'user-1',
      [],
      [buildAttachment('att-fwd', 'image/jpeg', 'fwd.jpg')]
    );

    expect(hasImageOrFileAttachment(imageMsg)).toBe(true);
    expect(hasImageOrFileAttachment(fileMsg)).toBe(true);
    expect(hasImageOrFileAttachment(forwardedImageMsg)).toBe(true);
    expect(isHoldableActivationSlot(imageMsg, slot)).toBe(false);
    expect(isHoldableActivationSlot(fileMsg, slot)).toBe(false);
    expect(isHoldableActivationSlot(forwardedImageMsg, slot)).toBe(false);
  });

  it.each(['mention', 'reply', 'dm-session'] as const)(
    'returns false for non-activation slot source %s even without attachments',
    source => {
      const msg = buildMessage('m-1');
      expect(isHoldableActivationSlot(msg, buildSlot(source))).toBe(false);
    }
  );
});
