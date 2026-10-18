// HTTP Range requests (RFC 9110 §14): the bytes a client asked for out of a file of `size` bytes.

export type ByteRange = { start: number; end: number }; // both inclusive

/**
 * - `null`: no usable Range header (absent, malformed, a unit other than bytes, or several ranges): serve the whole file.
 * - `"unsatisfiable"`: a well-formed single range that starts past the end: answer 416.
 * - otherwise the range, clipped to the file.
 *
 * Supports `bytes=a-b`, `bytes=a-` and the suffix form `bytes=-n` (the last n bytes). Several ranges are not supported
 * and are ignored, which the standard allows: the client gets the whole file and carries on.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (size <= 0) return "unsatisfiable";
  if (a === "") {
    // The last n bytes.
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start >= size) return "unsatisfiable";
  // A last position before the first is not a range at all: ignore the header.
  if (b !== "" && Number(b) < start) return null;
  return { start, end };
}
