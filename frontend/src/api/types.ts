/**
 * Short aliases for generated schema types. These are references, not hand-written copies:
 * every shape comes from openapi/contract.yaml via `npm run api:generate`.
 */
import type { components, operations } from './generated/schema';

type Schemas = components['schemas'];

export type User = Schemas['User'];
export type Role = Schemas['User']['role'];
export type UserCreate = Schemas['UserCreate'];
export type UserUpdate = Schemas['UserUpdate'];
export type Subject = Schemas['Subject'];
export type SubjectCreate = Schemas['SubjectCreate'];
export type SubjectRef = Schemas['SubjectRef'];
export type Lecture = Schemas['Lecture'];
export type LecturePage = Schemas['LecturePage'];
export type LectureCreate = Schemas['LectureCreate'];
export type LectureStatus = Schemas['Lecture']['status'];
export type LanguageCode = Schemas['Lecture']['language'];
export type TranscriptSegment = Schemas['TranscriptSegment'];
export type TranscriptGap = Schemas['TranscriptGap'];
export type TranscriptPage = Schemas['TranscriptPage'];
export type Notes = Schemas['Notes'];
export type NoteSection = Schemas['NoteSection'];
export type NotesUpdate = Schemas['NotesUpdate'];
export type Summary = Schemas['Summary'];
export type KeyTerm = Schemas['KeyTerm'];
export type KeyTermList = Schemas['KeyTermList'];
export type McqQuestion = Schemas['McqQuestion'];
export type ShortAnswerQuestion = Schemas['ShortAnswerQuestion'];
export type QuestionSet = Schemas['QuestionSet'];
export type AskResponse = Schemas['AskResponse'];
export type SearchResponse = Schemas['SearchResponse'];
export type SearchGroup = Schemas['SearchGroup'];
export type SearchHit = Schemas['SearchHit'];
export type Device = Schemas['Device'];
export type DeviceCreate = Schemas['DeviceCreate'];
export type ExportFormat = operations['export_lecture']['parameters']['query']['format'];
export type LectureUpdate = Schemas['LectureUpdate'];
export type DeviceRegistered = Schemas['DeviceRegistered'];
export type SearchLecture = Schemas['SearchLecture'];
export type ErrorResponse = Schemas['ErrorResponse'];
export type SegmentUpdate = Schemas['SegmentUpdate'];
export type LectureControl = Schemas['LectureControl'];
export type ControlAction = Schemas['LectureControl']['action'];
export type ControlAccepted = Schemas['ControlAccepted'];
export type Flashcard = Schemas['Flashcard'];
export type FlashcardSet = Schemas['FlashcardSet'];
export type RevisionNotes = Schemas['RevisionNotes'];
export type DeviceUpdate = Schemas['DeviceUpdate'];
export type DeviceLecturers = Schemas['DeviceLecturers'];
export type ProfileUpdate = Schemas['ProfileUpdate'];
export type PasswordChange = Schemas['PasswordChange'];
export type SystemInfo = Schemas['SystemInfo'];
export type Health = Schemas['Health'];
