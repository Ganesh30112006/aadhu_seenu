import { setupWorker } from 'msw/browser';
import { LECTURE_IDS } from '../fixtures/lectures';
import { handlers } from './handlers';
import { dropConnections, runFor, seek, setSpeed } from './live/simulator';

/** Controls for the simulated live lecture, used by Playwright and for demos (mock mode only). */
export interface MockLiveControls {
  liveLectureId: string;
  setSpeed(lectureId: string, speed: number): void;
  seek(lectureId: string, elapsedMs: number): void;
  drop(lectureId: string): void;
  elapsed(lectureId: string): number | null;
}

declare global {
  interface Window {
    __mockLive?: MockLiveControls;
  }
}

export const worker = setupWorker(...handlers);

window.__mockLive = {
  liveLectureId: LECTURE_IDS.schedulingLive,
  setSpeed,
  seek,
  drop: dropConnections,
  elapsed: (lectureId) => {
    const run = runFor(lectureId);
    if (run?.baseWall == null) return null;
    return run.baseElapsed + (Date.now() - run.baseWall) * run.speed;
  },
};
