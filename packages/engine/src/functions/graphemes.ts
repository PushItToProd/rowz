const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Whether text contains only single-code-unit ASCII characters. */
export function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

/** Splits text into grapheme clusters, using a fast path for ASCII text. */
export function graphemes(value: string): string[] {
  if (isAscii(value)) return value.split("");
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

/** Counts grapheme clusters without allocating an array for ASCII text. */
export function graphemeLength(value: string): number {
  if (isAscii(value)) return value.length;
  let length = 0;
  for (const part of segmenter.segment(value)) {
    if (part.segment.length > 0) length += 1;
  }
  return length;
}

/** Slices text using grapheme-cluster indexes and JavaScript slice semantics. */
export function sliceGraphemes(value: string, start?: number, end?: number): string {
  if (isAscii(value)) return value.slice(start, end);
  const first = Math.trunc(start ?? 0);
  const last = end === undefined ? undefined : Math.trunc(end);
  if (first >= 0 && (last === undefined || last >= 0)) {
    if (last !== undefined && last <= first) return "";
    if (!Number.isFinite(first) || first >= value.length) return "";
    const selected: string[] = [];
    let index = 0;
    for (const part of segmenter.segment(value)) {
      if (index >= first) selected.push(part.segment);
      index += 1;
      if (last !== undefined && index >= last) break;
    }
    return selected.join("");
  }
  return graphemes(value).slice(start, end).join("");
}

/** Returns the code-unit offset at a zero-based grapheme position, clamped to the end. */
export function offsetAtGrapheme(value: string, position: number): number {
  if (isAscii(value)) return Math.min(position, value.length);
  if (position <= 0) return 0;
  let index = 0;
  for (const part of segmenter.segment(value)) {
    if (index === position) return part.index;
    index += 1;
  }
  return value.length;
}

/** Returns the one-based grapheme position containing a code-unit offset. */
export function positionAtGrapheme(value: string, offset: number): number {
  if (isAscii(value)) return Math.min(offset, value.length) + 1;
  let position = 1;
  for (const part of segmenter.segment(value)) {
    if (offset < part.index + part.segment.length) return position;
    position += 1;
  }
  return position;
}
