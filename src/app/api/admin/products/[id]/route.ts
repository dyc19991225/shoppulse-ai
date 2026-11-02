import { NextResponse, type NextRequest } from 'next/server';
import { deleteProduct, getProduct, updateProduct, type ProductInput } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import {
  asBoolean,
  asOptionalString,
  asString,
  isSafeHttpUrl,
  isUniqueSkuError,
  jsonError,
  parseId,
  readJsonObject,
} from '@/lib/api';
import { requireAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface Params {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');
  const product = getProduct(getDb(), id);
  return product ? NextResponse.json({ item: product }) : jsonError(404, 'not_found');
}

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const updates: Partial<ProductInput> = {};

  if (body.name !== undefined) {
    const name = asString(body.name, 200);
    if (!name) return jsonError(400, 'invalid_name');
    updates.name = name;
  }
  if (body.sku !== undefined) {
    const sku = asOptionalString(body.sku, 100);
    if (sku === null) return jsonError(400, 'invalid_sku');
    updates.sku = sku.trim() || null;
  }
  if (body.category !== undefined) {
    const category = asOptionalString(body.category, 100);
    if (category === null) return jsonError(400, 'invalid_category');
    updates.category = category;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return jsonError(400, 'invalid_price');
    updates.price = Math.round(price * 100) / 100;
  }
  if (body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0) return jsonError(400, 'invalid_stock');
    updates.stock = stock;
  }
  if (body.description !== undefined) {
    const description = asOptionalString(body.description, 5000);
    if (description === null) return jsonError(400, 'invalid_description');
    updates.description = description;
  }
  if (body.sellingPoints !== undefined) {
    const points = asOptionalString(body.sellingPoints, 1000);
    if (points === null) return jsonError(400, 'invalid_selling_points');
    updates.sellingPoints = points;
  }
  if (body.imageUrl !== undefined) {
    const imageUrl = asOptionalString(body.imageUrl, 2000);
    if (imageUrl === null || !isSafeHttpUrl(imageUrl)) return jsonError(400, 'unsafe_url');
    updates.imageUrl = imageUrl;
  }
  if (body.url !== undefined) {
    const url = asOptionalString(body.url, 2000);
    if (url === null || !isSafeHttpUrl(url)) return jsonError(400, 'unsafe_url');
    updates.url = url;
  }
  if (body.enabled !== undefined) updates.enabled = asBoolean(body.enabled, true);

  if (Object.keys(updates).length === 0) return jsonError(400, 'no_updates');

  try {
    const product = updateProduct(getDb(), id, updates);
    return product ? NextResponse.json({ item: product }) : jsonError(404, 'not_found');
  } catch (error) {
    if (isUniqueSkuError(error)) return jsonError(409, 'duplicate_sku');
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAdminApi(request);
  if (auth instanceof NextResponse) return auth;

  const id = parseId(params.id);
  if (!id) return jsonError(400, 'invalid_id');
  return deleteProduct(getDb(), id)
    ? NextResponse.json({ ok: true })
    : jsonError(404, 'not_found');
}
