/**
 * Request-body reading with an enforced byte ceiling.
 *
 * `Content-Length` is only a hint: it can be absent (chunked uploads) or
 * understated. The stream is therefore counted as it is read, and the read is
 * cancelled as soon as the cap is crossed — before JSON/multipart parsing.
 */

export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    // Cancelling a fully-read stream is a no-op; on the error path it stops
    // the client from continuing to upload.
    await reader.cancel().catch(() => undefined);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Reads a JSON object with a byte cap; returns null when invalid. */
export async function readJsonObjectWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, maxBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw error;
    return null;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
