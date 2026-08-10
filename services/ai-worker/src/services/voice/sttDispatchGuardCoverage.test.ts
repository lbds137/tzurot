/**
 * Structural guard against a fifth ad-hoc STT dispatch site.
 *
 * TASK-511 found three independent copies of "skip STT/rendering for the
 * persona's own voice" (the reference pipeline, extended-context
 * re-resolution, the chat_log renderer) plus one live gap (the reference
 * pipeline had none at all) — four sites that each had to be found by
 * reading code, not by a check that would fail on a missing one. This test
 * is that check: it scans ai-worker's source tree for every
 * `transcribeAudio(` call site and asserts each one either references the
 * shared `isOwnPersonaVoice` predicate (`@tzurot/common-types/utils/ownVoice`)
 * — directly, or via the render-side `ownVoiceGuard` redact — or is named in
 * the ALLOWLIST below with a reason. A new call site added without
 * consulting the guard fails here until it does one or the other —
 * exemption becomes a reviewed decision instead of a silent gap.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../..');

/**
 * Repo-relative (to `services/ai-worker/src`) paths of files that call
 * `transcribeAudio(` but are legitimately exempt from consulting
 * `ownVoiceGuard` directly. Each reason is the actual mechanism, not "it's
 * fine" — a reviewer re-checking this file should be able to verify the
 * claim without re-deriving it.
 */
const ALLOWLIST: Record<string, string> = {
  'services/multimodal/AudioProcessor.ts':
    'The transcribeAudio DEFINITION, not a caller — nothing to guard against itself.',
  'services/MultimodalProcessor.ts':
    "processAttachment (via the exported processAttachments) handles the CURRENT message's own " +
    'attachments only — ConversationInputProcessor.processInputs calls it for context.attachments, ' +
    'which is always the human user in-band upload, never a reference. authorRole cannot apply here ' +
    'because there is no reference to carry it.',
  'jobs/AudioTranscriptionJob.ts':
    "The BullMQ handler's reference-pipeline producer (api-gateway's jobChainOrchestrator) gates " +
    'before dispatch: processAttachmentsForJobs consults isOwnPersonaVoice (from ' +
    '@tzurot/common-types/utils/ownVoice) against the reference authorship and skips ' +
    'createAudioTranscriptionJobs entirely for an assistant-authored reference (api-gateway is out ' +
    "of this ai-worker-scoped scan). The second producer, api-gateway's routes/ai/transcribe.ts, is " +
    'an explicit user-triggered transcription request with no reference authorship to gate on — ' +
    'deliberately ungated. The render-side guard in ReferencedMessageFormatter/storedReference ' +
    'remains as belt-and-suspenders for any transcript computed or persisted before this gate ' +
    'existed.',
  'jobs/handlers/pipeline/steps/ContextStep.ts':
    'reTranscribeExtendedContextVoice is a plain STT callback with no role of its own; the guard runs ' +
    'one call frame up, in ContextAssembler.injectExtendedContextVoiceTranscripts, which returns before ' +
    'ever invoking this callback for the assistant-role case.',
};

/** Recursively collect non-test `.ts` source files under `dir`. */
function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      walk(full, files);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

const callers = walk(SRC_ROOT).filter(f => /\btranscribeAudio\(/.test(readFileSync(f, 'utf-8')));

describe('transcribeAudio dispatch sites consult the shared own-voice guard', () => {
  // A loose floor, not an exact count: the point is proving the scan itself
  // works (a path bug that scans an empty tree would otherwise pass
  // vacuously), not pinning the exact number of call sites.
  it('the scan finds real call sites', () => {
    expect(callers.length).toBeGreaterThanOrEqual(4);
  });

  it.each(callers.map(f => [path.relative(SRC_ROOT, f), f] as const))(
    '%s references isOwnPersonaVoice/ownVoiceGuard, or is allowlisted with a reason',
    (relPath, fullPath) => {
      const content = readFileSync(fullPath, 'utf-8');
      const referencesGuard =
        content.includes('isOwnPersonaVoice') || content.includes('ownVoiceGuard');
      const allowlistReason = ALLOWLIST[relPath];
      expect(
        referencesGuard || allowlistReason !== undefined,
        `${relPath} calls transcribeAudio( but neither imports isOwnPersonaVoice/ownVoiceGuard nor is ` +
          'allowlisted above. Either gate the call with isOwnPersonaVoice from ' +
          "'@tzurot/common-types/utils/ownVoice', or add an ALLOWLIST entry here naming why the guard " +
          'does not apply.'
      ).toBe(true);
    }
  );

  it('every allowlist entry still names a real caller — a stale entry hides a fixed gap', () => {
    const callerRelPaths = new Set(callers.map(f => path.relative(SRC_ROOT, f)));
    const stale = Object.keys(ALLOWLIST).filter(entry => !callerRelPaths.has(entry));
    expect(
      stale,
      `Allowlist entries no longer calling transcribeAudio(: ${stale.join(', ')}`
    ).toEqual([]);
  });
});
