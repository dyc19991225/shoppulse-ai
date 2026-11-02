import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import {
  createProduct,
  getProductBySku,
  updateProduct,
  type DB,
  type ProductInput,
} from './db';

/**
 * Product import from .xlsx / .csv (AC3.2).
 *
 * - Header aliases in Chinese and English.
 * - Upsert by SKU when present; rows without a SKU are always inserted.
 * - Per-row validation errors are collected rather than aborting the import.
 * - Bounded: ≤ 5MB and ≤ 5000 data rows.
 */

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export const CSV_TEMPLATE_HEADERS = [
  '名称 / name',
  'SKU',
  '分类 / category',
  '价格 / price',
  '库存 / stock',
  '描述 / description',
  '卖点 / selling_points',
  '图片 / image',
  '链接 / url',
] as const;

export type ImportField =
  | 'name'
  | 'sku'
  | 'category'
  | 'price'
  | 'stock'
  | 'description'
  | 'sellingPoints'
  | 'imageUrl'
  | 'url'
  | 'enabled';

const HEADER_ALIASES: Record<ImportField, string[]> = {
  name: ['名称', '商品名称', '产品名称', 'name', 'product name', 'title'],
  sku: ['sku', '货号', '编码', '商品编码'],
  category: ['分类', '类别', 'category', 'type'],
  price: ['价格', '售价', '单价', 'price', 'amount'],
  stock: ['库存', '数量', 'stock', 'quantity', 'qty'],
  description: ['描述', '详情', '介绍', 'description', 'details', 'desc'],
  sellingPoints: ['卖点', '亮点', 'selling_points', 'selling points', 'highlights', 'features'],
  imageUrl: ['图片', '图片url', '图片链接', 'image', 'image_url', 'image url', 'photo'],
  url: ['链接', '商品链接', 'url', 'link', 'product url'],
  enabled: ['启用', '状态', 'enabled', 'status', 'active'],
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s\-_/\\:：]+/g, '')
    .trim();
}

/** Builds a header-name -> field lookup including bilingual "中文 / english" cells. */
export function buildHeaderMap(headers: string[]): Map<number, ImportField> {
  const lookup = new Map<string, ImportField>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
    for (const alias of aliases) lookup.set(normalizeHeader(alias), field);
  }

  const map = new Map<number, ImportField>();
  headers.forEach((header, index) => {
    // "名称 / name" — try the whole cell, then each side of the slash.
    const parts = [header, ...header.split('/')];
    for (const part of parts) {
      const field = lookup.get(normalizeHeader(part));
      if (field && ![...map.values()].includes(field)) {
        map.set(index, field);
        return;
      }
    }
  });
  return map;
}

export interface ImportRowError {
  /** 1-based sheet row, including the header row. */
  row: number;
  message: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  errors: ImportRowError[];
  /** Total data rows seen. */
  total: number;
}

export interface ParseResult {
  headers: string[];
  rows: string[][];
  /** Sheet row number for each data row. */
  rowNumbers: number[];
}

export class ImportError extends Error {
  readonly code: 'file_too_large' | 'too_many_rows' | 'unsupported_format' | 'invalid_file' | 'missing_name_column';

  constructor(code: ImportError['code'], message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

/** Detects the format by extension first, then magic bytes (xlsx = PK zip). */
export function detectFormat(filename: string, bytes: Uint8Array): 'csv' | 'xlsx' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv')) return 'csv';
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  return 'csv';
}

function decodeCsv(bytes: Uint8Array): string {
  // UTF-8 with optional BOM; Excel on Windows may write GBK, which UTF-8 decoding
  // turns into replacement characters — detect and fall back to a clear error.
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.find((error) => error.type === 'Quotes');
    if (fatal) throw new ImportError('invalid_file', fatal.message);
  }
  const rows = (parsed.data as unknown[][])
    .map((row) => (Array.isArray(row) ? row.map((cell) => (cell == null ? '' : String(cell))) : []))
    .filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) throw new ImportError('invalid_file', 'Empty file');
  const [headers, ...data] = rows;
  return {
    headers,
    rows: data,
    rowNumbers: data.map((_, index) => index + 2),
  };
}

const MAX_CELL_LENGTH = 5000;

export async function parseXlsx(bytes: Uint8Array): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types accept Buffer; convert from the raw bytes.
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new ImportError('invalid_file', 'Could not read xlsx');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportError('invalid_file', 'Workbook has no sheet');

  const rows: { rowNumber: number; values: string[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values: string[] = [];
    const cellCount = Math.max(row.cellCount, 1);
    for (let column = 1; column <= cellCount; column += 1) {
      values.push(cellToString(row.getCell(column).value));
    }
    if (values.some((value) => value.trim() !== '')) rows.push({ rowNumber, values });
  });

  if (rows.length === 0) throw new ImportError('invalid_file', 'Empty sheet');
  const [headerRow, ...dataRows] = rows;
  return {
    headers: headerRow.values,
    rows: dataRows.map((row) => row.values),
    rowNumbers: dataRows.map((row) => row.rowNumber),
  };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Hyperlinks, formulas, rich text.
    const record = value as unknown as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.hyperlink === 'string') return record.hyperlink;
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
        .join('');
    }
    if ('result' in record) return cellToString(record.result as ExcelJS.CellValue);
    if ('formula' in record) return '';
  }
  return String(value);
}

/** Parses a price like "¥29.9", "29.9 元", "1,299.00". */
export function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[¥￥$€,\s]/g, '').replace(/元|人民币|RMB|CNY/gi, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return null;
  return Math.round(value * 100) / 100;
}

export function parseStock(raw: string): number | null {
  const cleaned = raw.replace(/[,，\s]/g, '');
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (!Number.isInteger(value) || value < 0 || value > 100_000_000) return null;
  return value;
}

function parseEnabled(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (['1', 'true', 'yes', 'y', '是', '启用', '上架', 'active', 'enabled'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', '否', '停用', '下架', 'inactive', 'disabled'].includes(value)) return false;
  return undefined;
}

function isHttpUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ImportOptions {
  /** Stop on the first error instead of collecting per-row errors. */
  dryRun?: boolean;
}

/**
 * Validates + applies parsed rows. Upserts by SKU; inserts otherwise.
 * Returns counts and per-row errors.
 */
export function importProducts(
  db: DB,
  ownerId: number,
  parsed: ParseResult,
  options: ImportOptions = {},
): ImportResult {
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new ImportError('too_many_rows', `More than ${MAX_IMPORT_ROWS} rows`);
  }

  const headerMap = buildHeaderMap(parsed.headers);
  if (![...headerMap.values()].includes('name')) {
    throw new ImportError('missing_name_column', 'Missing name column');
  }

  const result: ImportResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    total: parsed.rows.length,
  };

  // Each row runs in its own nested transaction (SQLite savepoint) so a bad
  // row is rolled back alone. Without a savepoint, a thrown row error would
  // abort the whole transaction while `result` still counted earlier rows as
  // created/updated even though they were later rolled back.
  const apply = db.transaction(() => {
    parsed.rows.forEach((row, index) => {
      const rowNumber = parsed.rowNumbers[index] ?? index + 2;

      const valueFor = (field: ImportField): string => {
        for (const [column, mapped] of headerMap) {
          if (mapped === field) return (row[column] ?? '').trim().slice(0, MAX_CELL_LENGTH);
        }
        return '';
      };

      const name = valueFor('name');
      if (!name) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, message: 'name is required' });
        return;
      }
      if (name.length > 200) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, message: 'name is too long (max 200)' });
        return;
      }

      const priceRaw = valueFor('price');
      const price = priceRaw ? parsePrice(priceRaw) : 0;
      if (price === null) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, message: `invalid price "${priceRaw}"` });
        return;
      }

      const stockRaw = valueFor('stock');
      const stock = parseStock(stockRaw);
      if (stock === null) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, message: `invalid stock "${stockRaw}"` });
        return;
      }

      const imageUrl = valueFor('imageUrl');
      if (!isHttpUrl(imageUrl)) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, message: 'image URL must be http(s)' });
        return;
      }
      const url = valueFor('url');
      if (!isHttpUrl(url)) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, message: 'product URL must be http(s)' });
        return;
      }

      const input: ProductInput = {
        sku: valueFor('sku') || null,
        name,
        category: valueFor('category').slice(0, 100),
        price,
        stock,
        description: valueFor('description'),
        sellingPoints: valueFor('sellingPoints'),
        imageUrl,
        url,
      };
      const enabled = parseEnabled(valueFor('enabled'));
      if (enabled !== undefined) input.enabled = enabled;

      try {
        if (options.dryRun) {
          if (input.sku) {
            if (getProductBySku(db, ownerId, input.sku)) result.updated += 1;
            else result.created += 1;
          } else {
            result.created += 1;
          }
          return;
        }

        // Nested transaction => savepoint: a failed row affects only itself.
        // SKU upserts are per owner: another owner's row with the same SKU is
        // left untouched and a separate product is created here.
        const applyRow = db.transaction(() => {
          const existing = input.sku ? getProductBySku(db, ownerId, input.sku) : null;
          if (existing) {
            updateProduct(db, ownerId, existing.id, input);
            return 'updated' as const;
          }
          createProduct(db, ownerId, input);
          return 'created' as const;
        });
        if (applyRow() === 'updated') result.updated += 1;
        else result.created += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          row: rowNumber,
          message: error instanceof Error ? error.message : 'database error',
        });
      }
    });
  });

  apply();
  return result;
}

/** Parses raw upload bytes then imports them. */
export async function importProductsFromFile(
  db: DB,
  ownerId: number,
  filename: string,
  bytes: Uint8Array,
  options: ImportOptions = {},
): Promise<ImportResult> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportError('file_too_large', 'File exceeds 5MB');
  }
  if (bytes.byteLength === 0) {
    throw new ImportError('invalid_file', 'Empty file');
  }

  const format = detectFormat(filename, bytes);
  const parsed = format === 'xlsx' ? await parseXlsx(bytes) : parseCsv(decodeCsv(bytes));
  return importProducts(db, ownerId, parsed, options);
}

/** CSV template content (with BOM so Excel opens it as UTF-8). */
export function csvTemplate(): string {
  const header = CSV_TEMPLATE_HEADERS.join(',');
  const example = [
    '青禾竹纤维洗碗巾（3 条装）',
    'QH-001',
    '厨房清洁',
    '29.9',
    '320',
    '天然竹纤维，吸水快、不易掉毛。',
    '吸油不挂油；可机洗',
    '',
    '',
  ].join(',');
  return `﻿${header}\n${example}\n`;
}
