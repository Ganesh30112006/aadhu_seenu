/** Quiz state (pure, unit-tested). Answers are ephemeral: nothing is saved or graded. */
export interface QuizState {
  answers: Readonly<Record<string, number>>;
  submitted: boolean;
}

export type QuizAction =
  { type: 'answer'; questionId: string; option: number } | { type: 'submit' } | { type: 'reset' };

export const INITIAL_QUIZ: QuizState = { answers: {}, submitted: false };

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'answer':
      return state.submitted
        ? state
        : { ...state, answers: { ...state.answers, [action.questionId]: action.option } };
    case 'submit':
      return { ...state, submitted: true };
    case 'reset':
      return INITIAL_QUIZ;
  }
}

export function quizScore(
  state: QuizState,
  questions: readonly { id: string; correct_index: number }[],
): number {
  return questions.filter((q) => state.answers[q.id] === q.correct_index).length;
}

export function unanswered(state: QuizState, questions: readonly { id: string }[]): number {
  return questions.filter((q) => state.answers[q.id] === undefined).length;
}
