/**
 * GitHub release shape shared by every consumer that reads the releases API
 * (api-gateway's announce/reconcile pipeline, bot-client's release-flag nag).
 * Passthrough fields are stripped; `id` is GitHub's numeric release id.
 */

import { z } from 'zod';

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

/**
 * Newest non-draft release by published_at, or null if none. Drafts carry a
 * null published_at and are excluded rather than sorted last.
 */
export function newestPublishedRelease(releases: GitHubRelease[]): GitHubRelease | null {
  let newest: GitHubRelease | null = null;
  let newestTime = -Infinity;
  for (const release of releases) {
    if (release.published_at === null || release.published_at === undefined) {
      continue;
    }
    const time = new Date(release.published_at).getTime();
    if (time > newestTime) {
      newest = release;
      newestTime = time;
    }
  }
  return newest;
}
