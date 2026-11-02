import { NextResponse, type NextRequest } from 'next/server';
import { csvTemplate } from '@/lib/importer';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** CSV import template download. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  return new NextResponse(csvTemplate(), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="shoppulse-products-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
