/** Joins truthy class names. A five-line replacement for `clsx`. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
