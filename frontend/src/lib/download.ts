import { ApiError } from '@/api/errors';

export interface DownloadResult {
  blob: Blob;
  filename: string;
}

/** Fetches a file while reporting progress (total is null without Content-Length). */
export async function downloadWithProgress(
  url: string,
  onProgress: (loaded: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...(signal !== undefined && { signal }),
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw ApiError.fromResponse(response, body);
  }
  const length = Number(response.headers.get('Content-Length'));
  const total = Number.isFinite(length) && length > 0 ? length : null;
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'download';
  const type = response.headers.get('Content-Type') ?? 'application/octet-stream';
  if (response.body === null) return { blob: await response.blob(), filename };

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return { blob: new Blob([merged], { type }), filename };
}

/** Hands a blob to the browser's download manager. */
export function saveBlob({ blob, filename }: DownloadResult): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 1000);
}
