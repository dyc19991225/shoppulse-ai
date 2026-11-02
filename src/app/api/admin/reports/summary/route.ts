import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db-runtime';
import { DEFAULT_REPORT_DAYS, getReportSummary, isReportDays } from '@/lib/reports';
import { jsonError } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Reports summary for 7 / 30 / 90 days (F1). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const daysParam = request.nextUrl.searchParams.get('days');
  let days: number = DEFAULT_REPORT_DAYS;
  if (daysParam !== null) {
    const parsed = Number(daysParam);
    if (!isReportDays(parsed)) return jsonError(400, 'invalid_days');
    days = parsed;
  }

  return NextResponse.json(getReportSummary(getDb(), auth.user.id, days));
}
