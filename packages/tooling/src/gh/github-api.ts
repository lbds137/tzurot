/**
 * GitHub API Helpers
 *
 * Wraps the `gh api` command which works reliably, unlike `gh pr edit`
 * which fails due to the Projects (classic) deprecation GraphQL error.
 *
 * Usage:
 *   pnpm ops gh:pr-reviews 478
 *   pnpm ops gh:pr-comments 478
 *   pnpm ops gh:pr-edit 478 --title "New title" --body "New body"
 */

import { execFileSync } from 'node:child_process';

const REPO = 'lbds137/tzurot';

interface PrReview {
  id: number;
  user: { login: string };
  body: string;
  state: string;
  submitted_at: string;
}

interface PrComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  path?: string;
  line?: number;
}

interface PrInfo {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
}

/**
 * Execute gh api command and return parsed JSON
 */
function ghApi<T>(endpoint: string, method = 'GET', fields?: Record<string, string>): T {
  const args = ['api', endpoint];

  if (method !== 'GET') {
    args.push('-X', method);
  }

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      args.push('-f', `${key}=${value}`);
    }
  }

  const result = execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return JSON.parse(result) as T;
}

/**
 * Get PR info
 */
export function getPrInfo(prNumber: number): PrInfo {
  return ghApi<PrInfo>(`repos/${REPO}/pulls/${prNumber}`);
}

/**
 * Get all reviews on a PR
 */
export function getPrReviews(prNumber: number): PrReview[] {
  return ghApi<PrReview[]>(`repos/${REPO}/pulls/${prNumber}/reviews`);
}

/**
 * Get line-level review comments on a PR
 */
export function getPrLineComments(prNumber: number): PrComment[] {
  return ghApi<PrComment[]>(`repos/${REPO}/pulls/${prNumber}/comments`);
}

/**
 * Get all comments on a PR (both line-level and conversation-level)
 */
export function getPrAllComments(prNumber: number): {
  line: PrComment[];
  conversation: PrComment[];
} {
  const line = ghApi<PrComment[]>(`repos/${REPO}/pulls/${prNumber}/comments`);
  const conversation = ghApi<PrComment[]>(`repos/${REPO}/issues/${prNumber}/comments`);
  return { line, conversation };
}

/**
 * Get issue comments (conversation-level comments)
 */
export function getPrIssueComments(prNumber: number): PrComment[] {
  return ghApi<PrComment[]>(`repos/${REPO}/issues/${prNumber}/comments`);
}

/**
 * Edit PR title and/or body
 * This uses the REST API directly, avoiding the GraphQL Projects (classic) bug
 */
export function editPr(prNumber: number, updates: { title?: string; body?: string }): PrInfo {
  const fields: Record<string, string> = {};
  if (updates.title) fields.title = updates.title;
  if (updates.body) fields.body = updates.body;

  return ghApi<PrInfo>(`repos/${REPO}/pulls/${prNumber}`, 'PATCH', fields);
}

/**
 * Format reviews for display
 */
export function formatReviews(reviews: PrReview[]): string {
  if (reviews.length === 0) {
    return 'No reviews found.';
  }

  return reviews
    .map(review => {
      const date = new Date(review.submitted_at).toLocaleString();
      const header = `## ${review.user.login} - ${review.state} (${date})`;
      const body = review.body || '(no comment)';
      return `${header}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Format comments for display
 */
export function formatComments(comments: PrComment[]): string {
  if (comments.length === 0) {
    return 'No comments found.';
  }

  return comments
    .map(comment => {
      const date = new Date(comment.created_at).toLocaleString();
      const location = comment.path ? ` on ${comment.path}:${comment.line ?? '?'}` : '';
      const header = `## ${comment.user.login}${location} (${date})`;
      return `${header}\n\n${comment.body}`;
    })
    .join('\n\n---\n\n');
}
