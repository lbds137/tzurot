import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Collection, MessageFlags, type Attachment, type Message } from 'discord.js';
import { COALESCING } from '@tzurot/common-types/constants/message';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import {
  CoalescingHoldRegistry,
  type CoalescingChatManagerPort,
} from './CoalescingHoldRegistry.js';
import { hasImageOrFileAttachment } from './coalescingHoldability.js';
import type { StartFanOutInput } from './multiTagCoordinatorHelpers.js';
import type { ResolvedSlot, SlotSource } from './SlotResolver.js';
import type { NsfwGate } from './character/sharedNsfwGate.js';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => loggerMocks,
  };
});

// Ascending Discord-style createdTimestamp for each constructed message, so
// construction order stays the latest-wins order unless a test pins explicit
// timestamps (fake timers freeze Date.now, hence the counter).
let timestampCounter = 0;
const nextTimestamp = (): number => 1_700_000_000_000 + ++timestampCounter;

/** Drain the detached survivor fan-out's microtask chain after a release. */
async function flushDetachedFanOut(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

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

function buildChannel(id = 'channel-1'): TypingChannel {
  return { id, sendTyping: vi.fn() } as unknown as TypingChannel;
}

function buildFanOutInput(
  message: Message,
  slot: ResolvedSlot,
  content = `content-${message.id}`,
  channel = buildChannel()
): StartFanOutInput {
  return {
    message,
    channel,
    slots: [slot],
    content,
    truncated: false,
    maxTags: 5,
  };
}

describe('CoalescingHoldRegistry', () => {
  const nsfwGate: NsfwGate = vi.fn().mockResolvedValue('allowed');
  let chatManager: {
    submitChatJob: ReturnType<typeof vi.fn>;
    saveUserMessage: ReturnType<typeof vi.fn>;
  };
  let registry: CoalescingHoldRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    let jobCounter = 0;
    chatManager = {
      submitChatJob: vi.fn().mockImplementation(async ({ personality, message }) => ({
        kind: 'submitted',
        jobId: `job-${++jobCounter}-${message.id}`,
        trackingContext: {
          kind: 'message',
          personality,
          personaId: `persona-${personality.id}`,
          userMessageTime: new Date(),
        },
      })),
      saveUserMessage: vi.fn().mockResolvedValue({ kind: 'saved' }),
    };

    registry = new CoalescingHoldRegistry(
      chatManager as unknown as CoalescingChatManagerPort,
      async releasedInput => {
        for (const slot of releasedInput.slots) {
          await registry.submitOrHoldSlot(releasedInput, slot, nsfwGate);
        }
      }
    );
  });

  afterEach(() => {
    registry.clear();
    vi.useRealTimers();
  });

  it('submits an idle activation trigger immediately and records awaitedJobId', async () => {
    const slot = buildSlot('activation');
    const input = buildFanOutInput(buildMessage('m1', 'u1'), slot);

    const outcome = await registry.submitOrHoldSlot(input, slot, nsfwGate);

    expect(outcome).toMatchObject({ kind: 'submitted', jobId: 'job-1-m1' });
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(1);
    expect(chatManager.saveUserMessage).not.toHaveBeenCalled();
    expect(registry.getEntry('channel-1', 'pers-1')).toMatchObject({
      awaitedJobId: 'job-1-m1',
      newest: null,
      skipped: [],
    });
  });

  it('holds subsequent plain activation triggers (latest-wins) and submits once on release with skipUserMessageSave and skippedMessages', async () => {
    const slot = buildSlot('activation');
    const m1 = buildFanOutInput(buildMessage('m1', 'u1'), slot, 'first');
    const m2 = buildFanOutInput(buildMessage('m2', 'u2'), slot, 'second');
    const m3 = buildFanOutInput(buildMessage('m3', 'u3'), slot, 'third');
    const m4 = buildFanOutInput(buildMessage('m4', 'u1'), slot, 'fourth');

    await registry.submitOrHoldSlot(m1, slot, nsfwGate);
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(1);

    const o2 = await registry.submitOrHoldSlot(m2, slot, nsfwGate);
    const o3 = await registry.submitOrHoldSlot(m3, slot, nsfwGate);
    const o4 = await registry.submitOrHoldSlot(m4, slot, nsfwGate);

    expect(o2).toEqual({ kind: 'held' });
    expect(o3).toEqual({ kind: 'held' });
    expect(o4).toEqual({ kind: 'held' });
    expect(chatManager.saveUserMessage).toHaveBeenCalledTimes(3);
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(1);

    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(chatManager.submitChatJob.mock.calls[1][0]).toMatchObject({
      message: m4.message,
      content: 'fourth',
      skipUserMessageSave: true,
      skippedMessages: [
        { messageId: 'm2', authorId: 'u2' },
        { messageId: 'm3', authorId: 'u3' },
      ],
    });
    expect(registry.getEntry('channel-1', 'pers-1')?.awaitedJobId).toBe('job-2-m4');
  });

  it('caps skipped messages at COALESCING.MAX_SKIPPED_MESSAGES, dropping oldest first', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m0', 'u0'), slot),
      slot,
      nsfwGate
    );

    const totalHeld = COALESCING.MAX_SKIPPED_MESSAGES + 4;
    for (let i = 1; i <= totalHeld; i++) {
      await registry.submitOrHoldSlot(
        buildFanOutInput(buildMessage(`m${i}`, `u${i}`), slot),
        slot,
        nsfwGate
      );
    }

    const entry = registry.getEntry('channel-1', 'pers-1');
    expect(entry?.skipped).toHaveLength(COALESCING.MAX_SKIPPED_MESSAGES);
    expect(entry?.skipped[0]).toEqual({ messageId: 'm4', authorId: 'u4' });
    expect(entry?.skipped.at(-1)).toEqual({
      messageId: `m${totalHeld - 1}`,
      authorId: `u${totalHeld - 1}`,
    });
    expect(entry?.newest?.input.message.id).toBe(`m${totalHeld}`);
  });

  it('submits attachment-bearing activation triggers immediately while leaving an active hold untouched', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2'), slot),
      slot,
      nsfwGate
    );

    const imageMsg = buildMessage('m-img', 'u3', [
      buildAttachment('att-1', 'image/png', 'diagram.png'),
    ]);
    const imageOutcome = await registry.submitOrHoldSlot(
      buildFanOutInput(imageMsg, slot, 'check this image'),
      slot,
      nsfwGate
    );

    expect(imageOutcome).toMatchObject({ kind: 'submitted', jobId: 'job-2-m-img' });
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(chatManager.submitChatJob.mock.calls[1][0].skipUserMessageSave).toBeUndefined();

    // Original hold is still waiting on job-1-m1 with m2 as newest
    expect(registry.getEntry('channel-1', 'pers-1')).toMatchObject({
      awaitedJobId: 'job-1-m1',
      skipped: [],
    });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest?.input.message.id).toBe('m2');
  });

  it('does not hold a trigger whose pre-save gate denies it', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );

    chatManager.saveUserMessage.mockResolvedValueOnce({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });
    const deniedOutcome = await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m-denied', 'u-blocked'), slot),
      slot,
      nsfwGate
    );

    expect(deniedOutcome).toEqual({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest).toBeNull();
  });

  it('releases the held survivor when the hold deadline timer expires before completion', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2'), slot, 'deadline survivor'),
      slot,
      nsfwGate
    );

    await vi.advanceTimersByTimeAsync(COALESCING.HOLD_DEADLINE_MS + 10);

    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(chatManager.submitChatJob.mock.calls[1][0]).toMatchObject({
      content: 'deadline survivor',
      skipUserMessageSave: true,
    });
    expect(chatManager.submitChatJob.mock.calls[1][0].skippedMessages).toBeUndefined();

    // Late completion of job-1-m1 must not release the survivor's new cycle
    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
  });

  it('classifies a contentType-based image attachment with no type field and does not hold its trigger', async () => {
    const slot = buildSlot('activation');
    const imgMsg = buildMessage('m-img-raw', 'u5', [
      buildAttachment('att-img-raw', 'image/png', 'photo.png'),
    ]);

    // Classification goes through the contentType fallback (classifyForPreprocessing)
    expect(hasImageOrFileAttachment(imgMsg)).toBe(true);

    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );
    const outcome = await registry.submitOrHoldSlot(buildFanOutInput(imgMsg, slot), slot, nsfwGate);

    expect(outcome).toMatchObject({ kind: 'submitted' });
    expect(registry.getEntry('channel-1', 'pers-1')).toMatchObject({
      awaitedJobId: 'job-1-m1',
      newest: null,
    });
  });

  it('ignores a completion whose jobId does not match and ignores filtered releases during the null-await window', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );
    const before = registry.getEntry('channel-1', 'pers-1');

    await registry.release('channel-1', 'pers-1', 'job-OTHER');
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(1);
    expect(registry.getEntry('channel-1', 'pers-1')).toBe(before);

    // Null-await window on an idle pair: the fresh cycle's job id is not
    // recorded yet, so a filtered completion must not release the new hold.
    let resolveSubmit!: (value: unknown) => void;
    chatManager.submitChatJob.mockImplementationOnce(
      () => new Promise(resolve => (resolveSubmit = resolve))
    );
    const slot2 = buildSlot('activation', buildPersonality('pers-2'));
    const pending = registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m9', 'u9'), slot2, 'content-9', buildChannel('channel-2')),
      slot2,
      nsfwGate
    );
    expect(registry.getEntry('channel-2', 'pers-2')?.awaitedJobId).toBeNull();

    await registry.release('channel-2', 'pers-2', 'job-any');
    expect(registry.getEntry('channel-2', 'pers-2')).toBeDefined();

    resolveSubmit({
      kind: 'submitted',
      jobId: 'job-9-m9',
      trackingContext: { kind: 'message', userMessageTime: new Date() },
    });
    const outcome = await pending;
    expect(outcome).toMatchObject({ kind: 'submitted', jobId: 'job-9-m9' });
    expect(registry.getEntry('channel-2', 'pers-2')?.awaitedJobId).toBe('job-9-m9');
  });

  it('promotes the newest skipped trigger when the survivor submission is denied', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2', [], [], 2_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m3', 'u3', [], [], 3_000), slot),
      slot,
      nsfwGate
    );

    chatManager.submitChatJob.mockResolvedValueOnce({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });
    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    // Survivor m3 denied → m2 (the newest skipped context) promoted: a third
    // submission fires, resubmitting through a fresh cycle.
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(3);
    expect(chatManager.submitChatJob.mock.calls[2][0]).toMatchObject({
      message: expect.objectContaining({ id: 'm2' }),
      skipUserMessageSave: true,
    });
    // Nothing left to ride along — the promoted resubmission carries no wire skipped
    expect(chatManager.submitChatJob.mock.calls[2][0].skippedMessages).toBeUndefined();
    // The promoted cycle is live, not torn down
    expect(registry.getEntry('channel-1', 'pers-1')).toBeDefined();
    expect(registry.getEntry('channel-1', 'pers-1')?.survivorCreatedTimestamp).toBe(2_000);
    // Nothing was lost, so the counts warn did not fire for this reason
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'submit-denied' }),
      expect.any(String)
    );
  });

  it('promotes with remaining skipped riding along as ids on a denied survivor', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2', [], [], 2_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m3', 'u3', [], [], 3_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m4', 'u4', [], [], 4_000), slot),
      slot,
      nsfwGate
    );

    chatManager.submitChatJob.mockResolvedValueOnce({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });
    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    // m4 denied → m3 promoted; m2 rides along as an id-only wire row
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(3);
    expect(chatManager.submitChatJob.mock.calls[2][0]).toMatchObject({
      message: expect.objectContaining({ id: 'm3' }),
      skipUserMessageSave: true,
      skippedMessages: [{ messageId: 'm2', authorId: 'u2' }],
    });
  });

  it('promotes the newest skipped trigger when the survivor submission errors', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2', [], [], 2_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m3', 'u3', [], [], 3_000), slot),
      slot,
      nsfwGate
    );

    chatManager.submitChatJob.mockRejectedValueOnce(new Error('gateway down'));
    // The survivor fan-out is detached: release resolves, the submit error is
    // logged by the detached chain's catch, and the promotion fires from the
    // synchronous failure arm inside releaseCycle.
    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      expect.any(String)
    );
    // m2 promoted after m3's errored submission
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(3);
    expect(chatManager.submitChatJob.mock.calls[2][0]).toMatchObject({
      message: expect.objectContaining({ id: 'm2' }),
      skipUserMessageSave: true,
    });
    expect(registry.getEntry('channel-1', 'pers-1')).toBeDefined();
    expect(registry.getEntry('channel-1', 'pers-1')?.survivorCreatedTimestamp).toBe(2_000);
    // Nothing lost → no counts warn for submit-error
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'submit-error' }),
      expect.any(String)
    );
  });

  it('warns and idles when a survivor submission fails with nothing promotable', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2', [], [], 2_000), slot),
      slot,
      nsfwGate
    );

    chatManager.submitChatJob.mockResolvedValueOnce({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });
    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    // m2 denied with an empty skipped list: today's teardown, no promotion
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(registry.getEntry('channel-1', 'pers-1')).toBeUndefined();
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'submit-denied' }),
      expect.any(String)
    );
  });

  it('keeps the newest trigger by createdTimestamp; an older arrival goes to skipped instead of becoming newest', async () => {
    const slot = buildSlot('activation');
    const m1 = buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot, 'first');
    const mNew = buildFanOutInput(buildMessage('m-new', 'u2', [], [], 2_000), slot, 'newest');
    const mOld = buildFanOutInput(buildMessage('m-old', 'u3', [], [], 1_500), slot, 'older');

    await registry.submitOrHoldSlot(m1, slot, nsfwGate);
    await registry.submitOrHoldSlot(mNew, slot, nsfwGate);
    const entry = registry.getEntry('channel-1', 'pers-1');
    expect(entry?.newest?.input.message.id).toBe('m-new');
    expect(entry?.skipped).toEqual([]);

    const heldOutcome = await registry.submitOrHoldSlot(mOld, slot, nsfwGate);
    expect(heldOutcome).toEqual({ kind: 'held' });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest?.input.message.id).toBe('m-new');
    expect(registry.getEntry('channel-1', 'pers-1')?.skipped).toEqual([
      { messageId: 'm-old', authorId: 'u3' },
    ]);

    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(chatManager.submitChatJob.mock.calls[1][0]).toMatchObject({
      message: mNew.message,
      content: 'newest',
      skipUserMessageSave: true,
      skippedMessages: [{ messageId: 'm-old', authorId: 'u3' }],
    });
  });

  it('submits immediately with skipUserMessageSave when the cycle releases while saveUserMessage is still awaiting', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );

    let resolveSave!: (value: unknown) => void;
    chatManager.saveUserMessage.mockImplementationOnce(
      () => new Promise(resolve => (resolveSave = resolve))
    );
    const held = registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2'), slot),
      slot,
      nsfwGate
    );

    // Release cycle 1 while m2's save is pending: cycle 1 has no newest yet,
    // so its entry is torn down with no handoff for m2.
    await registry.release('channel-1', 'pers-1', 'job-1-m1');

    resolveSave({ kind: 'saved' });
    const outcome = await held;

    expect(outcome).toMatchObject({ kind: 'submitted' });
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(chatManager.submitChatJob.mock.calls[1][0]).toMatchObject({
      message: expect.objectContaining({ id: 'm2' }),
      skipUserMessageSave: true,
    });
    expect(chatManager.submitChatJob.mock.calls[1][0].skippedMessages).toBeUndefined();
  });

  it('replaces the deadline timer with each cycle: an old cycle deadline produces no duplicate survivor submission', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2'), slot),
      slot,
      nsfwGate
    );
    const replacedEntry = registry.getEntry('channel-1', 'pers-1');

    await vi.advanceTimersByTimeAsync(COALESCING.HOLD_DEADLINE_MS + 10);
    // m2 released by the deadline into a new cycle with its own fresh timer
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    const currentEntry = registry.getEntry('channel-1', 'pers-1');
    expect(currentEntry?.cycleId).not.toBe(replacedEntry?.cycleId);
    expect(currentEntry?.deadlineTimer).not.toBe(replacedEntry?.deadlineTimer);

    // The next deadline window runs only the NEW cycle's timer: m2 must not
    // be submitted a second time.
    await vi.advanceTimersByTimeAsync(COALESCING.HOLD_DEADLINE_MS + 10);
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(registry.getEntry('channel-1', 'pers-1')).toBeUndefined();
  });

  it('submits a mention slot immediately on a pair with an active hold without touching the hold', async () => {
    const activationSlot = buildSlot('activation');
    const mentionSlot = buildSlot('mention');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), activationSlot),
      activationSlot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2'), activationSlot),
      activationSlot,
      nsfwGate
    );

    const outcome = await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m-mention', 'u3'), mentionSlot, 'mention content'),
      mentionSlot,
      nsfwGate
    );

    expect(outcome).toMatchObject({ kind: 'submitted' });
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(registry.getEntry('channel-1', 'pers-1')).toMatchObject({
      awaitedJobId: 'job-1-m1',
    });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest?.input.message.id).toBe('m2');
  });

  it('submits a non-voice audio upload immediately instead of holding it', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2'), slot),
      slot,
      nsfwGate
    );

    const mp3Msg = buildMessage('m-mp3', 'u3', [
      buildAttachment('att-mp3', 'audio/mpeg', 'song.mp3'),
    ]);
    const outcome = await registry.submitOrHoldSlot(
      buildFanOutInput(mp3Msg, slot, 'listen to this'),
      slot,
      nsfwGate
    );

    expect(outcome).toMatchObject({ kind: 'submitted' });
    // The existing hold is untouched
    expect(registry.getEntry('channel-1', 'pers-1')).toMatchObject({
      awaitedJobId: 'job-1-m1',
    });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest?.input.message.id).toBe('m2');
  });

  it('sends an arrival older than the released survivor straight to skipped across a release', async () => {
    const slot = buildSlot('activation');
    const m1 = buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot, 'first');
    const survivor = buildFanOutInput(
      buildMessage('m-surv', 'u2', [], [], 2_000),
      slot,
      'survivor'
    );
    const older = buildFanOutInput(buildMessage('m-old', 'u3', [], [], 1_500), slot, 'older');
    const newer = buildFanOutInput(buildMessage('m-new', 'u4', [], [], 2_500), slot, 'newer');

    await registry.submitOrHoldSlot(m1, slot, nsfwGate);
    await registry.submitOrHoldSlot(survivor, slot, nsfwGate);
    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    // Cycle 2 carries the released survivor's timestamp
    expect(registry.getEntry('channel-1', 'pers-1')?.survivorCreatedTimestamp).toBe(2_000);

    // Strictly older than the survivor: straight to skipped, never newest
    const olderOutcome = await registry.submitOrHoldSlot(older, slot, nsfwGate);
    expect(olderOutcome).toEqual({ kind: 'held' });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest).toBeNull();
    expect(registry.getEntry('channel-1', 'pers-1')?.skipped).toEqual([
      { messageId: 'm-old', authorId: 'u3' },
    ]);

    // Newer than the survivor: still becomes newest
    const newerOutcome = await registry.submitOrHoldSlot(newer, slot, nsfwGate);
    expect(newerOutcome).toEqual({ kind: 'held' });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest?.input.message.id).toBe('m-new');
    expect(registry.getEntry('channel-1', 'pers-1')?.skipped).toEqual([
      { messageId: 'm-old', authorId: 'u3' },
    ]);
  });

  it('does not let an unrelated trigger consume a pending handoff; the real survivor still does', async () => {
    const slot = buildSlot('activation');
    // Gate the fan-out before it reaches submitOrHoldSlot, simulating the
    // startFanOut-await window where an unrelated trigger could steal the
    // handoff.
    let openFanOutGate!: () => void;
    const gatedRegistry = new CoalescingHoldRegistry(
      chatManager as unknown as CoalescingChatManagerPort,
      async releasedInput => {
        await new Promise<void>(resolve => {
          openFanOutGate = resolve;
        });
        for (const slot of releasedInput.slots) {
          await gatedRegistry.submitOrHoldSlot(releasedInput, slot, nsfwGate);
        }
      }
    );

    await gatedRegistry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );
    await gatedRegistry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2', [], [], 2_000), slot),
      slot,
      nsfwGate
    );

    // Release cycle 1: the handoff is written, but the gated fan-out has not
    // reached the registry yet.
    await gatedRegistry.release('channel-1', 'pers-1', 'job-1-m1');

    // An unrelated trigger for the same pair arrives in the window: it must
    // take the normal hold path (its row persists) and leave the handoff.
    const other = buildFanOutInput(buildMessage('m-other', 'u9', [], [], 3_000), slot, 'other');
    const otherOutcome = await gatedRegistry.submitOrHoldSlot(other, slot, nsfwGate);
    expect(otherOutcome).toEqual({ kind: 'held' });
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(1);
    expect(chatManager.saveUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ id: 'm-other' }) })
    );

    // The real survivor passes the gate and consumes its handoff
    openFanOutGate();
    await flushDetachedFanOut();
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(2);
    expect(chatManager.submitChatJob.mock.calls[1][0]).toMatchObject({
      message: expect.objectContaining({ id: 'm2' }),
      skipUserMessageSave: true,
    });
    gatedRegistry.clear();
  });

  it('clears an unconsumed handoff after a fan-out that resolves without submitting', async () => {
    // A fan-out that resolves without ever consuming the handoff
    const silentRegistry = new CoalescingHoldRegistry(
      chatManager as unknown as CoalescingChatManagerPort,
      async () => {}
    );
    const slot = buildSlot('activation');
    await silentRegistry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );
    await silentRegistry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2', [], [], 2_000), slot),
      slot,
      nsfwGate
    );

    await silentRegistry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    // The next trigger for the pair takes the normal hold path — it is never
    // submitted with skipUserMessageSave/skippedMessages from the stale handoff.
    const m3 = buildFanOutInput(buildMessage('m3', 'u3', [], [], 3_000), slot, 'third');
    const outcome = await silentRegistry.submitOrHoldSlot(m3, slot, nsfwGate);
    expect(outcome).toEqual({ kind: 'held' });
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(1);
    expect(chatManager.saveUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ id: 'm3' }) })
    );
    silentRegistry.clear();
  });

  it('merges a failed survivor carried skipped triggers into the new cycle when a newer trigger arrived during the survivor submit window', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('mA', 'uA', [], [], 2_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('mB', 'uB', [], [], 3_000), slot),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('mS', 'uS', [], [], 4_000), slot),
      slot,
      nsfwGate
    );

    let resolveSurvivorSubmit!: (value: unknown) => void;
    chatManager.submitChatJob.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveSurvivorSubmit = resolve;
        })
    );

    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    // Trigger C arrives while mS's submission is in flight and becomes the cycle's newest
    const mC = buildFanOutInput(buildMessage('mC', 'uC', [], [], 5_000), slot, 'content-mC');
    const cOutcome = await registry.submitOrHoldSlot(mC, slot, nsfwGate);
    expect(cOutcome).toEqual({ kind: 'held' });
    expect(registry.getEntry('channel-1', 'pers-1')?.newest?.input.message.id).toBe('mC');

    // Survivor mS submission is denied
    resolveSurvivorSubmit({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });
    await flushDetachedFanOut();

    // New cycle for mC carries A and B as wire skippedMessages, entry is live, nothing lost
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(3);
    expect(chatManager.submitChatJob.mock.calls[2][0]).toMatchObject({
      message: expect.objectContaining({ id: 'mC' }),
      content: 'content-mC',
      skipUserMessageSave: true,
      skippedMessages: [
        { messageId: 'mA', authorId: 'uA' },
        { messageId: 'mB', authorId: 'uB' },
      ],
    });
    expect(registry.getEntry('channel-1', 'pers-1')?.awaitedJobId).toBe('job-2-mC');
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'submit-denied' }),
      expect.any(String)
    );
  });

  it('trims merged skipped triggers and contexts in alignment at COALESCING.MAX_SKIPPED_MESSAGES (dropping oldest by createdTimestamp) and logs the dropped count', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m0', 'u0', [], [], 1_000), slot),
      slot,
      nsfwGate
    );

    const carriedCount = COALESCING.MAX_SKIPPED_MESSAGES - 1;
    for (let i = 1; i <= carriedCount; i++) {
      await registry.submitOrHoldSlot(
        buildFanOutInput(buildMessage(`s${i}`, `us${i}`, [], [], 1_000 + i), slot),
        slot,
        nsfwGate
      );
    }
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('mS', 'uS', [], [], 2_000), slot),
      slot,
      nsfwGate
    );

    let resolveSurvivorSubmit!: (value: unknown) => void;
    chatManager.submitChatJob.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveSurvivorSubmit = resolve;
        })
    );

    await registry.release('channel-1', 'pers-1', 'job-1-m0');
    await flushDetachedFanOut();

    // Four triggers arrive during mS's submit window: c1..c3 sit in entry.skipped, c4 is entry.newest.
    // Total skipped on merge = 9 + 3 = 12 > MAX_SKIPPED_MESSAGES (10), so 2 oldest (s1, s2) drop.
    for (let i = 1; i <= 4; i++) {
      await registry.submitOrHoldSlot(
        buildFanOutInput(buildMessage(`c${i}`, `uc${i}`, [], [], 3_000 + i), slot),
        slot,
        nsfwGate
      );
    }

    loggerMocks.info.mockClear();
    // Also deny c4's submission so c4's trimmed skippedContexts drives a promotion,
    // proving skipped and skippedContexts stayed the same length and aligned.
    chatManager.submitChatJob.mockResolvedValueOnce({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });

    resolveSurvivorSubmit({
      kind: 'denied',
      reason: 'denylisted',
      silent: true,
    });
    await flushDetachedFanOut();

    expect(loggerMocks.info).toHaveBeenCalledWith(
      { channelId: 'channel-1', personalityId: 'pers-1', droppedCount: 2 },
      'Dropped oldest skipped coalesced triggers at the cap'
    );

    // c4's submission received the 10 surviving wire skippedMessages (s3..s9, c1..c3)
    const c4Skipped = chatManager.submitChatJob.mock.calls[2][0].skippedMessages;
    expect(c4Skipped).toHaveLength(COALESCING.MAX_SKIPPED_MESSAGES);
    expect(c4Skipped[0]).toEqual({ messageId: 's3', authorId: 'us3' });
    expect(c4Skipped.at(-1)).toEqual({ messageId: 'c3', authorId: 'uc3' });

    // c4 was denied → c3 promoted from c4's trimmed skippedContexts, carrying the remaining 9 (c2..s3 descending)
    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(4);
    const c3Call = chatManager.submitChatJob.mock.calls[3][0];
    expect(c3Call.message.id).toBe('c3');
    expect(c3Call.skippedMessages).toHaveLength(COALESCING.MAX_SKIPPED_MESSAGES - 1);
    expect(c3Call.skippedMessages[0]).toEqual({ messageId: 'c2', authorId: 'uc2' });
    expect(c3Call.skippedMessages.at(-1)).toEqual({ messageId: 's3', authorId: 'us3' });
  });

  it('logs a counts-only line with the number of dropped hold entries on clear()', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1'), slot, 'c1', buildChannel('channel-1')),
      slot,
      nsfwGate
    );
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m2', 'u2'), slot, 'c2', buildChannel('channel-2')),
      slot,
      nsfwGate
    );
    loggerMocks.info.mockClear();

    registry.clear();

    expect(registry.getEntry('channel-1', 'pers-1')).toBeUndefined();
    expect(registry.getEntry('channel-2', 'pers-1')).toBeUndefined();
    expect(loggerMocks.info).toHaveBeenCalledWith(
      { droppedEntryCount: 2 },
      'Cleared coalescing hold registry entries'
    );
  });

  it('bounds the promotion cascade when survivor submissions fail systemically and tears down the entry once no promotable contexts remain', async () => {
    const slot = buildSlot('activation');
    await registry.submitOrHoldSlot(
      buildFanOutInput(buildMessage('m1', 'u1', [], [], 1_000), slot),
      slot,
      nsfwGate
    );

    for (let i = 1; i <= COALESCING.MAX_SKIPPED_MESSAGES; i++) {
      await registry.submitOrHoldSlot(
        buildFanOutInput(buildMessage(`t${i}`, `u${i}`, [], [], 1_000 + i), slot),
        slot,
        nsfwGate
      );
    }

    await vi.advanceTimersByTimeAsync(250);
    chatManager.submitChatJob.mockRejectedValue(new Error('gateway down'));

    await registry.release('channel-1', 'pers-1', 'job-1-m1');
    await flushDetachedFanOut();

    expect(chatManager.submitChatJob).toHaveBeenCalledTimes(11);
    expect(chatManager.submitChatJob.mock.calls.map(c => c[0].message.id)).toEqual([
      'm1',
      't10',
      't9',
      't8',
      't7',
      't6',
      't5',
      't4',
      't3',
      't2',
      't1',
    ]);
    expect(registry.getEntry('channel-1', 'pers-1')).toBeUndefined();
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        personalityId: 'pers-1',
        previousJobId: 'job-1-m1',
        survivorMessageId: 't10',
        skippedCount: 9,
        reason: 'completion',
        holdDurationMs: 250,
      }),
      'Releasing coalesced survivor trigger'
    );
    expect(loggerMocks.info).toHaveBeenCalledWith(
      {
        channelId: 'channel-1',
        personalityId: 'pers-1',
        promotedMessageId: 't1',
        remainingCount: 0,
        reason: 'submit-error',
      },
      'Promoting newest skipped trigger after failed survivor submission'
    );
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'submit-error' }),
      expect.any(String)
    );
  });
});
