import { describe, it, expect } from 'vitest';
import { MESSAGES } from './no-raw-log-content-messages.js';

describe('no-raw-log-content messages', () => {
  it('every Error-sink message says why: the message rides err into log lines', () => {
    for (const id of ['rawTruncationInError', 'previewInError', 'rawFilenameInError'] as const) {
      expect(MESSAGES[id]).toMatch(/rides `err` into/);
    }
  });
});
