import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db-runtime';
import { ImportError, importProductsFromFile, MAX_IMPORT_BYTES } from '@/lib/importer';
import { jsonError } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';
import { BodyTooLargeError, readBodyWithLimit } from '@/lib/http-body';

export const dynamic = 'force-dynamic';
// Excel parsing is CPU-bound; keep the runtime as Node and don't cache.
export const runtime = 'nodejs';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];
/** Multipart envelope overhead (boundaries, part headers) above the file cap. */
const MULTIPART_OVERHEAD = 64 * 1024;
const MAX_UPLOAD_BODY_BYTES = MAX_IMPORT_BYTES + MULTIPART_OVERHEAD;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  // Read the raw body with a hard byte cap *before* multipart parsing, so a
  // missing/understated Content-Length cannot make us buffer an unlimited
  // upload. Parsing happens afterwards on the bounded bytes.
  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, MAX_UPLOAD_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return jsonError(413, 'file_too_large');
    throw error;
  }

  let form: FormData;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    form = await new Response(bytes.slice().buffer, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    return jsonError(400, 'invalid_form');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'missing_file');

  const name = file.name || 'upload.csv';
  const lower = name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return jsonError(415, 'unsupported_format');
  }
  if (file.size > MAX_IMPORT_BYTES) return jsonError(413, 'file_too_large');

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await importProductsFromFile(getDb(), name, fileBytes);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ImportError) {
      const status = error.code === 'file_too_large' ? 413
        : error.code === 'too_many_rows' ? 413
        : error.code === 'unsupported_format' ? 415
        : 400;
      return jsonError(status, error.code, { message: error.message });
    }
    throw error;
  }
}
