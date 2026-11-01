import { NextResponse } from 'next/server';
import { csvTemplate } from '@/lib/importer';

export const dynamic = 'force-dynamic';

/** CSV import template download. */
export function GET(): NextResponse {
  return new NextResponse(csvTemplate(), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="shoppulse-products-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
