import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db-runtime';
import {
  DEFAULT_REPORT_DAYS,
  getReportSummary,
  isReportDays,
  reportSummaryCsv,
} from '@/lib/reports';
import { jsonError } from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** CSV export of the daily report rows (F1). */
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

  const summary = getReportSummary(getDb(), auth.user.id, days);
  return new NextResponse(reportSummaryCsv(summary), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="shoppulse-report-${days}d.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
