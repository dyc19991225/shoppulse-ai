import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db-runtime';
import { getStats } from '@/lib/stats';
import { jsonError } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Dashboard analytics: totals, 7-day volume, intent split, top question terms. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const rangeParam = request.nextUrl.searchParams.get('days');
  let rangeDays: number | undefined;
  if (rangeParam !== null) {
    const parsed = Number(rangeParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      return jsonError(400, 'invalid_days');
    }
    rangeDays = parsed;
  }

  return NextResponse.json(getStats(getDb(), auth.user.id, { rangeDays }));
}
