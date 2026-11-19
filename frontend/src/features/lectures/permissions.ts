import type { Lecture, User } from '@/api/types';

/** Mirrors the backend's can_edit: the lecture's own lecturer, or any admin (UX only). */
export function canEditLecture(user: User | null, lecture: Lecture | undefined): boolean {
  if (user === null || lecture === undefined) return false;
  return user.role === 'admin' || (user.role === 'lecturer' && lecture.lecturer_id === user.id);
}
