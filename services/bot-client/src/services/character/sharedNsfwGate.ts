import type { Message, SendableChannels } from 'discord.js';
import {
  handleNsfwVerification,
  sendVerificationConfirmation,
} from '../../utils/nsfwVerification.js';

/** Runs the NSFW gate for one message; resolves true when the message may proceed. */
export type NsfwGate = () => Promise<boolean>;

/** The whole NSFW step: decision, any refusal reply, and the first-time confirmation. */
export async function runNsfwGate(message: Message): Promise<boolean> {
  const verificationResult = await handleNsfwVerification(message);
  if (!verificationResult.allowed) {
    return false;
  }

  if (verificationResult.wasNewVerification) {
    // First-time verification gets a self-destructing confirmation. Cast
    // through SendableChannels because the helper accepts any channel that
    // implements .send (including DMs/threads/text channels).
    void sendVerificationConfirmation(message.channel as SendableChannels);
  }

  return true;
}

/**
 * A gate that does its work at most once however many slots call it. Slots run
 * in parallel, so it holds the in-flight promise rather than a resolved value.
 * Nothing runs until the first call (pinned by `createSharedNsfwGate` in
 * `character/sharedNsfwGate.test.ts`).
 */
export function createSharedNsfwGate(message: Message): NsfwGate {
  let inFlight: Promise<boolean> | undefined;
  return (): Promise<boolean> => {
    inFlight ??= runNsfwGate(message);
    return inFlight;
  };
}
