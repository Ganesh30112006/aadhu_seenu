/** Mock-mode controls for the simulated live lecture (see src/test/msw/browser.ts). */
interface MockLiveControls {
  liveLectureId: string;
  setSpeed(lectureId: string, speed: number): void;
  seek(lectureId: string, elapsedMs: number): void;
  drop(lectureId: string): void;
  elapsed(lectureId: string): number | null;
}

interface Window {
  __mockLive?: MockLiveControls;
}
