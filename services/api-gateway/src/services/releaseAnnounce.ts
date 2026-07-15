/**
 * The announce core shared by BOTH release triggers (webhook + reconcile
 * sweep): gate → classify → format → enqueue. Keeping the draft/prerelease
 * gate here means the two callers cannot drift on what is announceable.
 *
 * Only the newest release is ever non-prerelease in this repo —
 * `release:publish` demotes the previous release when a new one lands — so
 * the prerelease gate doubles as a "current release only" filter.
 */

import { z } from 'zod';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';
import type { NotifyLevelValue } from '@tzurot/common-types/schemas/api/notifications';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { enqueueBroadcast } from './releaseBroadcast.js';
import {
  parseReleaseSections,
  classifyReleaseLevel,
  formatReleaseAnnouncement,
} from './releaseNotes.js';

const logger = createLogger('ReleaseAnnounce');

/**
 * The subset of GitHub's release object both triggers consume. Passthrough
 * fields are stripped; `id` is GitHub's numeric release id (stored stringly
 * as the announcement's githubReleaseId).
 */
export const GitHubReleaseSchema = z.object({
  id: z.number().int(),
  tag_name: z.string().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  html_url: z.string().min(1),
  published_at: z.string().nullable().optional(),
});

export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;

export type AnnounceOutcome =
  | {
      status: 'announced';
      version: string;
      level: NotifyLevelValue;
      recipients: number;
      batches: number;
    }
  | { status: 'already-announced'; version: string }
  | { status: 'skipped'; version: string; reason: 'draft' | 'prerelease' };

export interface AnnounceDeps {
  prisma: PrismaClient;
  queue: Queue;
}

/**
 * Announce one GitHub release through the broadcast pipeline. Idempotent:
 * the version key (tag_name verbatim) hits enqueueBroadcast's unique-version
 * backbone, so webhook replays and reconcile overlap resolve to
 * already-announced instead of double-sending.
 */
export async function announceGitHubRelease(
  deps: AnnounceDeps,
  release: GitHubRelease
): Promise<AnnounceOutcome> {
  const version = release.tag_name;

  if (release.draft) {
    return { status: 'skipped', version, reason: 'draft' };
  }
  if (release.prerelease) {
    return { status: 'skipped', version, reason: 'prerelease' };
  }

  const parsed = parseReleaseSections(release.body ?? '');
  const level = classifyReleaseLevel(parsed);
  const body = formatReleaseAnnouncement({ tagName: version, htmlUrl: release.html_url }, parsed);

  const result = await enqueueBroadcast(deps.prisma, deps.queue, {
    version,
    level,
    body,
    githubReleaseId: String(release.id),
  });

  if (!result.ok) {
    return { status: 'already-announced', version };
  }

  logger.info(
    // notifyLevel, not level — a `level` field shadows pino's own level key.
    { version, notifyLevel: level, recipients: result.recipients, batches: result.batches },
    'GitHub release announced'
  );
  return {
    status: 'announced',
    version,
    level,
    recipients: result.recipients,
    batches: result.batches,
  };
}
