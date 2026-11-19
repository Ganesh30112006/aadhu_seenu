import { liveHandler } from '../live/handler';
import { authHandlers } from './auth';
import { lectureHandlers } from './lectures';
import { adminHandlers, searchHandlers } from './searchAndAdmin';
import { studyHandlers } from './study';

/** REST + WebSocket mocks implementing openapi/contract.yaml and the live protocol. */
export const handlers = [
  ...authHandlers,
  ...lectureHandlers,
  ...studyHandlers,
  ...searchHandlers,
  ...adminHandlers,
  liveHandler,
];
