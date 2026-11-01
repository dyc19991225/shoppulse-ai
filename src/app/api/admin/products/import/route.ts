import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db-runtime';
import { ImportError, importProductsFromFile, MAX_IMPORT_BYTES } from '@/lib/importer';
import { jsonError } from '@/lib/api';

export const dynamic = 'force-dynamic';
// Excel parsing is CPU-bound; keep the runtime as Node and don't cache.
export const runtime = 'nodejs';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Reject oversized bodies early via Content-Length when the client provides it.
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_IMPORT_BYTES + 4096) {
    return jsonError(413, 'file_too_large');
  }

  let form: FormData;
  try {
    form = await request.formData();
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

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await importProductsFromFile(getDb(), name, bytes);
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
