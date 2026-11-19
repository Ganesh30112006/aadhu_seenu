import { describe, expect, it } from 'vitest';
import { INITIAL_QUIZ, quizReducer, quizScore, unanswered, type QuizAction } from './quiz';

const QUESTIONS = [
  { id: 'q1', correct_index: 0 },
  { id: 'q2', correct_index: 2 },
  { id: 'q3', correct_index: 1 },
] as const;

const run = (...actions: QuizAction[]) => actions.reduce(quizReducer, INITIAL_QUIZ);

describe('quizReducer', () => {
  it('records the latest answer per question', () => {
    const state = run(
      { type: 'answer', questionId: 'q1', option: 3 },
      { type: 'answer', questionId: 'q1', option: 0 },
      { type: 'answer', questionId: 'q2', option: 2 },
    );
    expect(state.answers).toEqual({ q1: 0, q2: 2 });
    expect(state.submitted).toBe(false);
  });

  it('freezes answers after submit, and reset starts over', () => {
    const submitted = run(
      { type: 'answer', questionId: 'q1', option: 1 },
      { type: 'submit' },
      { type: 'answer', questionId: 'q1', option: 0 },
    );
    expect(submitted).toEqual({ answers: { q1: 1 }, submitted: true });
    expect(quizReducer(submitted, { type: 'reset' })).toBe(INITIAL_QUIZ);
  });

  it('does not mutate the previous state', () => {
    const before = run({ type: 'answer', questionId: 'q1', option: 1 });
    const after = quizReducer(before, { type: 'answer', questionId: 'q2', option: 0 });
    expect(before.answers).toEqual({ q1: 1 });
    expect(after).not.toBe(before);
  });
});

describe('quizScore and unanswered', () => {
  it('counts correct answers and missing ones', () => {
    const state = run(
      { type: 'answer', questionId: 'q1', option: 0 },
      { type: 'answer', questionId: 'q2', option: 1 },
    );
    expect(quizScore(state, QUESTIONS)).toBe(1);
    expect(unanswered(state, QUESTIONS)).toBe(1);
    expect(quizScore(INITIAL_QUIZ, QUESTIONS)).toBe(0);
    expect(unanswered(INITIAL_QUIZ, QUESTIONS)).toBe(3);
  });
});
