import { NextResponse, type NextRequest } from 'next/server';
import { createProduct, listProducts, type ProductInput } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import {
  asBoolean,
  asOptionalString,
  asString,
  isSafeHttpUrl,
  isUniqueSkuError,
  jsonError,
  readJsonObject,
} from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const db = getDb();
  const params = request.nextUrl.searchParams;
  const products = listProducts(db, {
    search: params.get('search')?.trim() || undefined,
    category: params.get('category')?.trim() || undefined,
  });
  return NextResponse.json({ items: products, total: products.length });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const name = asString(body.name, 200);
  if (!name) return jsonError(400, 'invalid_name', { fields: { name: true } });

  const price = body.price === undefined ? 0 : Number(body.price);
  if (!Number.isFinite(price) || price < 0) return jsonError(400, 'invalid_price');

  const stock = body.stock === undefined ? 0 : Number(body.stock);
  if (!Number.isInteger(stock) || stock < 0) return jsonError(400, 'invalid_stock');

  const sku = asOptionalString(body.sku, 100);
  if (sku === null) return jsonError(400, 'invalid_sku');

  const imageUrl = asOptionalString(body.imageUrl, 2000);
  const url = asOptionalString(body.url, 2000);
  if (imageUrl === null || url === null) return jsonError(400, 'invalid_url');
  if (!isSafeHttpUrl(imageUrl) || !isSafeHttpUrl(url)) {
    return jsonError(400, 'unsafe_url');
  }

  const input: ProductInput = {
    name,
    sku: sku.trim() || null,
    category: asOptionalString(body.category, 100) ?? '',
    price: Math.round(price * 100) / 100,
    stock,
    description: asOptionalString(body.description, 5000) ?? '',
    sellingPoints: asOptionalString(body.sellingPoints, 1000) ?? '',
    imageUrl,
    url,
    enabled: asBoolean(body.enabled, true),
  };

  try {
    const product = createProduct(getDb(), input);
    return NextResponse.json({ item: product }, { status: 201 });
  } catch (error) {
    if (isUniqueSkuError(error)) return jsonError(409, 'duplicate_sku');
    throw error;
  }
}
