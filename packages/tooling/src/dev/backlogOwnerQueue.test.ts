import { describe, expect, it } from 'vitest';
import {
  checkOwnerQueue,
  ownerQueue,
  OWNER_STATE_LABEL,
  parseOwnerLines,
  renderOwnerQueueLine,
} from './backlogOwnerQueue.js';
import type { TrackerTask } from './trackerTasks.js';

function task(overrides: Partial<TrackerTask> = {}): TrackerTask {
  return {
    id: 'TASK-1',
    title: 'A task',
    status: 'To Do',
    createdDate: '2026-05-16',
    labels: ['area:db', 'size:S', OWNER_STATE_LABEL],
    priority: 'medium',
    body: '',
    file: 'tracker/tasks/task-1 - a-task.md',
    ...overrides,
  };
}

describe('parseOwnerLines', () => {
  it('parses plain Owner question / Recommendation lines', () => {
    const body = [
      'Owner question: Should we widen the cap?',
      'Recommendation: No — widen risk.',
    ].join('\n');
    expect(parseOwnerLines(task({ body }))).toEqual({
      question: 'Should we widen the cap?',
      recommendation: 'No — widen risk.',
    });
  });

  it('parses bold `**Owner question:**` lines', () => {
    const body = [
      '**Owner question:** Should we widen the cap?',
      '**Recommendation:** No — widen risk.',
    ].join('\n');
    expect(parseOwnerLines(task({ body }))).toEqual({
      question: 'Should we widen the cap?',
      recommendation: 'No — widen risk.',
    });
  });

  it('parses list-marker lines', () => {
    const body = ['- Owner question: Should we widen the cap?', '- Recommendation: No.'].join('\n');
    expect(parseOwnerLines(task({ body }))).toEqual({
      question: 'Should we widen the cap?',
      recommendation: 'No.',
    });
  });

  it('parses combined list-marker + bold lines', () => {
    const body = [
      '- **Owner question:** Should we widen the cap?',
      '- **Recommendation:** No — widen risk.',
    ].join('\n');
    expect(parseOwnerLines(task({ body }))).toEqual({
      question: 'Should we widen the cap?',
      recommendation: 'No — widen risk.',
    });
  });

  it('first match wins when a prefix appears twice', () => {
    const body = [
      'Owner question: First question.',
      'Owner question: Second question (should be ignored).',
    ].join('\n');
    expect(parseOwnerLines(task({ body })).question).toBe('First question.');
  });

  it('returns null for each missing line', () => {
    expect(parseOwnerLines(task({ body: 'Just prose, no markers.' }))).toEqual({
      question: null,
      recommendation: null,
    });
  });

  it('does not match a lowercase prefix — the check is case-sensitive', () => {
    const body = 'owner question: should not match';
    expect(parseOwnerLines(task({ body })).question).toBeNull();
  });
});

describe('checkOwnerQueue', () => {
  it('flags a state:owner task missing only the question line', () => {
    const problems = checkOwnerQueue([task({ body: 'Recommendation: Ship it.' })]);
    expect(problems).toEqual([
      "tracker/tasks/task-1 - a-task.md: state:owner task has no 'Owner question:' line (06-backlog § State)",
    ]);
  });

  it('flags a state:owner task missing only the recommendation line', () => {
    const problems = checkOwnerQueue([task({ body: 'Owner question: Ship it?' })]);
    expect(problems).toEqual([
      "tracker/tasks/task-1 - a-task.md: state:owner task has no 'Recommendation:' line (06-backlog § State)",
    ]);
  });

  it('flags both, question problem first, when a state:owner task has neither line', () => {
    const problems = checkOwnerQueue([task({ body: 'No markers here.' })]);
    expect(problems).toEqual([
      "tracker/tasks/task-1 - a-task.md: state:owner task has no 'Owner question:' line (06-backlog § State)",
      "tracker/tasks/task-1 - a-task.md: state:owner task has no 'Recommendation:' line (06-backlog § State)",
    ]);
  });

  it('passes a state:owner task carrying both lines', () => {
    const body = ['Owner question: Ship it?', 'Recommendation: Yes — low risk.'].join('\n');
    expect(checkOwnerQueue([task({ body })])).toEqual([]);
  });

  it('ignores Done tasks even when both lines are missing', () => {
    expect(checkOwnerQueue([task({ status: 'Done', body: '' })])).toEqual([]);
  });

  it('ignores tasks without the state:owner label', () => {
    expect(
      checkOwnerQueue([task({ labels: ['area:db', 'size:S', 'state:ready'], body: '' })])
    ).toEqual([]);
  });
});

describe('ownerQueue', () => {
  it('orders by priority high → medium → low, then createdDate ascending', () => {
    const tasks = [
      task({ id: 'TASK-3', priority: 'low', createdDate: '2026-01-01' }),
      task({ id: 'TASK-1', priority: 'high', createdDate: '2026-02-01' }),
      task({ id: 'TASK-2', priority: 'medium', createdDate: '2026-01-01' }),
      task({ id: 'TASK-4', priority: 'high', createdDate: '2026-01-01' }),
    ];
    expect(ownerQueue(tasks).map(t => t.id)).toEqual(['TASK-4', 'TASK-1', 'TASK-2', 'TASK-3']);
  });

  it("filters on the state:owner label only — status filtering is the caller's job", () => {
    const tasks = [
      task({ id: 'TASK-1', status: 'Done' }),
      task({ id: 'TASK-2', labels: ['area:db', 'size:S', 'state:ready'] }),
      task({ id: 'TASK-3' }),
    ];
    expect(ownerQueue(tasks).map(t => t.id)).toEqual(['TASK-1', 'TASK-3']);
  });
});

describe('renderOwnerQueueLine', () => {
  it('renders the full line when both values are present', () => {
    const body = ['Owner question: Ship it?', 'Recommendation: Yes — low risk.'].join('\n');
    expect(renderOwnerQueueLine(task({ body, priority: 'high' }))).toBe(
      '- TASK-1 [high] — Ship it? → Yes — low risk.'
    );
  });

  it('falls back for a missing question', () => {
    const body = 'Recommendation: Yes.';
    expect(renderOwnerQueueLine(task({ body }))).toBe(
      '- TASK-1 [medium] — (no Owner question line) → Yes.'
    );
  });

  it('falls back for a missing recommendation', () => {
    const body = 'Owner question: Ship it?';
    expect(renderOwnerQueueLine(task({ body }))).toBe(
      '- TASK-1 [medium] — Ship it? → (no Recommendation line)'
    );
  });

  it('falls back for both missing values, and never throws', () => {
    expect(renderOwnerQueueLine(task({ body: '' }))).toBe(
      '- TASK-1 [medium] — (no Owner question line) → (no Recommendation line)'
    );
  });
});
