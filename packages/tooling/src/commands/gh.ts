/**
 * GitHub Commands
 *
 * Reliable GitHub API wrappers that avoid the broken `gh pr edit` command.
 *
 * The `gh pr edit` command fails with:
 *   "Projects (classic) is being deprecated..."
 *
 * These commands use `gh api` directly which works reliably.
 */

import type { CAC } from 'cac';

function registerPrInfoCommands(cli: CAC): void {
  cli
    .command('gh:pr-info <number>', 'Get PR title, body, and state')
    .example('ops gh:pr-info 478')
    .action(async (number: string) => {
      const { getPrInfo } = await import('../gh/github-api.js');
      const prNumber = parseInt(number, 10);
      const pr = getPrInfo(prNumber);
      console.log(`# PR #${pr.number}: ${pr.title}\n`);
      console.log(`State: ${pr.state}`);
      console.log(`URL: ${pr.html_url}\n`);
      console.log('## Body\n');
      console.log(pr.body || '(no body)');
    });

  cli
    .command('gh:pr-reviews <number>', 'Get all reviews on a PR')
    .example('ops gh:pr-reviews 478')
    .action(async (number: string) => {
      const { getPrReviews, formatReviews } = await import('../gh/github-api.js');
      const prNumber = parseInt(number, 10);
      const reviews = getPrReviews(prNumber);
      console.log(`# Reviews for PR #${prNumber}\n`);
      console.log(formatReviews(reviews));
    });

  cli
    .command(
      'gh:pr-comments <number>',
      'Get all comments on a PR (both line-level and conversation)'
    )
    .example('ops gh:pr-comments 478')
    .action(async (number: string) => {
      const { getPrAllComments, formatComments } = await import('../gh/github-api.js');
      const prNumber = parseInt(number, 10);
      const comments = getPrAllComments(prNumber);

      console.log(`# Comments for PR #${prNumber}\n`);

      if (comments.conversation.length > 0) {
        console.log('## Conversation Comments\n');
        console.log(formatComments(comments.conversation));
      }

      if (comments.line.length > 0) {
        if (comments.conversation.length > 0) {
          console.log('\n---\n');
        }
        console.log('## Line Comments\n');
        console.log(formatComments(comments.line));
      }

      if (comments.conversation.length === 0 && comments.line.length === 0) {
        console.log('No comments found.');
      }
    });

  cli
    .command('gh:pr-conversation <number>', 'Get conversation-level comments on a PR')
    .example('ops gh:pr-conversation 478')
    .action(async (number: string) => {
      const { getPrIssueComments, formatComments } = await import('../gh/github-api.js');
      const prNumber = parseInt(number, 10);
      const comments = getPrIssueComments(prNumber);
      console.log(`# Conversation for PR #${prNumber}\n`);
      console.log(formatComments(comments));
    });
}

function registerPrEditCommand(cli: CAC): void {
  cli
    .command('gh:pr-edit <number>', 'Edit PR title and/or body (avoids gh pr edit bug)')
    .option('--title <title>', 'New PR title')
    .option('--body <body>', 'New PR body')
    .option('--body-file <file>', 'Read PR body from file')
    .example('ops gh:pr-edit 478 --title "New title"')
    .example('ops gh:pr-edit 478 --body-file pr-body.md')
    .action(
      async (number: string, options: { title?: string; body?: string; bodyFile?: string }) => {
        const { editPr } = await import('../gh/github-api.js');
        const prNumber = parseInt(number, 10);

        let body = options.body;
        if (options.bodyFile) {
          const { readFileSync } = await import('node:fs');
          body = readFileSync(options.bodyFile, 'utf-8');
        }

        if (!options.title && !body) {
          console.error('Error: Must provide --title, --body, or --body-file');
          process.exit(1);
        }

        const updates: { title?: string; body?: string } = {};
        if (options.title) updates.title = options.title;
        if (body) updates.body = body;

        const pr = editPr(prNumber, updates);
        console.log(`✅ Updated PR #${pr.number}`);
        console.log(`   Title: ${pr.title}`);
        console.log(`   URL: ${pr.html_url}`);
      }
    );
}

function registerPrAllCommand(cli: CAC): void {
  cli
    .command('gh:pr-all <number>', 'Get all PR info: reviews, comments, and conversation')
    .example('ops gh:pr-all 478')
    .action(async (number: string) => {
      const {
        getPrInfo,
        getPrReviews,
        getPrLineComments,
        getPrIssueComments,
        formatReviews,
        formatComments,
      } = await import('../gh/github-api.js');
      const prNumber = parseInt(number, 10);

      const pr = getPrInfo(prNumber);
      const reviews = getPrReviews(prNumber);
      const lineComments = getPrLineComments(prNumber);
      const conversation = getPrIssueComments(prNumber);

      console.log(`# PR #${pr.number}: ${pr.title}\n`);
      console.log(`State: ${pr.state}`);
      console.log(`URL: ${pr.html_url}\n`);
      console.log('---\n');
      console.log('## Body\n');
      console.log(pr.body || '(no body)');
      console.log('\n---\n');
      console.log('## Reviews\n');
      console.log(formatReviews(reviews));
      console.log('\n---\n');
      console.log('## Line Comments\n');
      console.log(formatComments(lineComments));
      console.log('\n---\n');
      console.log('## Conversation\n');
      console.log(formatComments(conversation));
    });
}

export function registerGhCommands(cli: CAC): void {
  registerPrInfoCommands(cli);
  registerPrEditCommand(cli);
  registerPrAllCommand(cli);
}
