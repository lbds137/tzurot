import { describe, it, expect } from 'vitest';
import {
  buildSummarizerUserMessage,
  buildQuestionUserMessage,
  buildJudgeAnswerUserMessage,
  buildJudgeSummaryUserMessage,
  buildJudgeFactsUserMessage,
  SUMMARIZER_SYSTEM_PROMPT,
  QUESTION_SYSTEM_PROMPT,
  DEFAULT_VOICE_TRIGGERS,
} from './render-pilot-prompts.js';

describe('buildSummarizerUserMessage', () => {
  it('includes both turns and omits the referenced block when absent', () => {
    const msg = buildSummarizerUserMessage({
      displayName: 'Nova',
      subjectName: 'Alice',
      userText: 'hi there',
      assistantText: 'hello!',
      referenced: null,
    });
    expect(msg).toContain('Alice: hi there');
    expect(msg).toContain('Nova: hello!');
    expect(msg).not.toContain('Referenced content');
  });

  it('appends the referenced block when present', () => {
    const msg = buildSummarizerUserMessage({
      displayName: 'Nova',
      subjectName: 'Alice',
      userText: 'hi',
      assistantText: 'hello',
      referenced: 'a photo was posted',
    });
    expect(msg).toContain('[Referenced content: a photo was posted]');
  });
});

describe('buildQuestionUserMessage', () => {
  it('states the requested question count', () => {
    const msg = buildQuestionUserMessage({
      displayName: 'Nova',
      subjectName: 'Alice',
      userText: 'hi',
      assistantText: 'hello',
      referenced: null,
      questionsPerRow: 3,
    });
    expect(msg).toContain('Questions to produce: 3');
  });
});

describe('buildJudgeAnswerUserMessage', () => {
  it('includes the question, reference answer, and reply', () => {
    const msg = buildJudgeAnswerUserMessage({
      subjectName: 'Alice',
      displayName: 'Nova',
      userText: 'hi',
      assistantText: 'hello',
      referenced: null,
      question: 'What did Nova say?',
      referenceAnswer: 'hello',
      reply: 'Nova said hello',
    });
    expect(msg).toContain('Question asked: What did Nova say?');
    expect(msg).toContain("Character's reply: Nova said hello");
  });
});

describe('buildJudgeSummaryUserMessage', () => {
  it('includes the summary text', () => {
    const msg = buildJudgeSummaryUserMessage({
      subjectName: 'Alice',
      displayName: 'Nova',
      userText: 'hi',
      assistantText: 'hello',
      referenced: null,
      summary: 'Alice greeted Nova.',
    });
    expect(msg).toContain('Summary: Alice greeted Nova.');
  });
});

describe('buildJudgeFactsUserMessage', () => {
  it('lists fact statements when present', () => {
    const msg = buildJudgeFactsUserMessage({
      subjectName: 'Alice',
      displayName: 'Nova',
      userText: 'hi',
      assistantText: 'hello',
      referenced: null,
      factStatements: ["Alice's cat is named Miso"],
    });
    expect(msg).toContain("- Alice's cat is named Miso");
  });

  it('reports "(none)" when there are no facts', () => {
    const msg = buildJudgeFactsUserMessage({
      subjectName: 'Alice',
      displayName: 'Nova',
      userText: 'hi',
      assistantText: 'hello',
      referenced: null,
      factStatements: [],
    });
    expect(msg).toContain('Facts on file: (none)');
  });
});

describe('system prompt constants', () => {
  it('summarizer prompt requires strict JSON with a "summary" key', () => {
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('"summary"');
  });

  it('question prompt requires a basis tag', () => {
    expect(QUESTION_SYSTEM_PROMPT).toContain('"basis"');
  });

  // Canary: the worked examples must match buildSummarizerUserMessage's real shape
  // (placeholders already resolved to names) — reintroducing a `{user}:`/`{assistant}:`
  // prefix in an example must redden this test.
  it('summarizer worked examples carry no unresolved {user}/{assistant} placeholders', () => {
    expect(SUMMARIZER_SYSTEM_PROMPT).not.toContain('{user}');
    expect(SUMMARIZER_SYSTEM_PROMPT).not.toContain('{assistant}');
  });
});

describe('DEFAULT_VOICE_TRIGGERS', () => {
  it('provides exactly 5 default triggers', () => {
    expect(DEFAULT_VOICE_TRIGGERS).toHaveLength(5);
  });
});
