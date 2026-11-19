import type { Lecture, Notes, TranscriptSegment } from '@/api/types';
import { formatOffset } from '@/lib/time';

/** Builds the export body the real backend would stream (txt / md / a minimal valid PDF). */
export function buildExport(
  format: 'pdf' | 'txt' | 'md',
  lecture: Lecture,
  segments: readonly TranscriptSegment[],
  notes: Notes | null,
): { bytes: Uint8Array; contentType: string; filename: string } {
  const slug = lecture.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const header = [
    lecture.title,
    lecture.subject === null ? '' : `${lecture.subject.code} · ${lecture.subject.name}`,
    lecture.lecturer_name ?? '',
  ];
  const encoder = new TextEncoder();
  if (format === 'txt') {
    const text = [
      ...header,
      '',
      ...segments.map((s) => `[${formatOffset(s.start_ms)}] ${s.text}`),
    ].join('\n');
    return {
      bytes: encoder.encode(text),
      contentType: 'text/plain; charset=utf-8',
      filename: `${slug}.txt`,
    };
  }
  if (format === 'md') {
    const notesMd = notes?.published
      ? [
          '## Notes',
          '',
          ...notes.sections.flatMap((s) => [`### ${s.heading}`, '', s.body_markdown, '']),
        ]
      : [];
    const md = [
      `# ${lecture.title}`,
      '',
      `*${header.slice(1).join(' · ')}*`,
      '',
      ...notesMd,
      '## Transcript',
      '',
      ...segments.map((s) => `- **${formatOffset(s.start_ms)}** ${s.text}`),
    ].join('\n');
    return {
      bytes: encoder.encode(md),
      contentType: 'text/markdown; charset=utf-8',
      filename: `${slug}.md`,
    };
  }
  // PDF standard fonts are Latin-1 only; the real backend embeds Noto fonts for Telugu/Hindi.
  const ascii = (s: string): string => s.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '\\$&');
  const lines = [
    ...header,
    '',
    ...segments.slice(0, 45).map((s) => `[${formatOffset(s.start_ms)}] ${ascii(s.text)}`),
  ];
  return {
    bytes: minimalPdf(lines.map(ascii)),
    contentType: 'application/pdf',
    filename: `${slug}.pdf`,
  };
}

function minimalPdf(lines: string[]): Uint8Array {
  const content = [
    'BT',
    '/F1 10 Tf',
    '14 TL',
    '50 800 Td',
    ...lines.map((l) => `(${l.slice(0, 95)}) '`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Streams bytes in chunks so the UI can show real download progress. */
export function chunkedStream(
  bytes: Uint8Array,
  chunks: number,
  delayMs: number,
): ReadableStream<Uint8Array> {
  const size = Math.ceil(bytes.length / chunks);
  let offset = 0;
  return new ReadableStream({
    async pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}
