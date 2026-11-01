import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { createProduct, getProductBySku, listProducts } from '@/lib/db';
import {
  buildHeaderMap,
  csvTemplate,
  detectFormat,
  importProducts,
  importProductsFromFile,
  ImportError,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  parsePrice,
  parseStock,
  parseXlsx,
} from '@/lib/importer';
import { createTempDb, type TempDb } from './helpers/tempdb';

let temp: TempDb | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function setup() {
  temp = createTempDb();
  return temp.db;
}

async function makeXlsx(rows: (string | number)[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

describe('header mapping', () => {
  it('recognizes Chinese, English and bilingual headers', () => {
    const map = buildHeaderMap([
      '名称 / name',
      'SKU',
      '价格 / price',
      '库存',
      '描述',
      '卖点 / selling_points',
      '图片 / image',
      '链接 / url',
    ]);
    expect([...map.values()]).toEqual([
      'name',
      'sku',
      'price',
      'stock',
      'description',
      'sellingPoints',
      'imageUrl',
      'url',
    ]);
  });

  it('ignores unknown columns and duplicate field mapping', () => {
    const map = buildHeaderMap(['备注', 'Name', '名称']);
    expect(map.size).toBe(1);
    expect(map.get(1)).toBe('name');
  });
});

describe('parsePrice / parseStock', () => {
  it('parses currency-decorated prices', () => {
    expect(parsePrice('29.9')).toBe(29.9);
    expect(parsePrice('¥1,299.00')).toBe(1299);
    expect(parsePrice('89 元')).toBe(89);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('-5')).toBeNull();
  });

  it('parses integer stock, defaulting empty to 0', () => {
    expect(parseStock('')).toBe(0);
    expect(parseStock('1,200')).toBe(1200);
    expect(parseStock('1.5')).toBeNull();
    expect(parseStock('-2')).toBeNull();
  });
});

describe('format detection and CSV parsing', () => {
  it('detects by extension and by xlsx magic bytes', () => {
    expect(detectFormat('a.xlsx', new Uint8Array())).toBe('xlsx');
    expect(detectFormat('a.csv', new Uint8Array())).toBe('csv');
    expect(detectFormat('data', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx');
  });

  it('parses CSV with quoted fields and BOM', () => {
    const parsed = parseCsv('﻿名称,价格\n"洗碗巾, 3 条装",29.9\n');
    expect(parsed.headers).toEqual(['名称', '价格']);
    expect(parsed.rows).toEqual([['洗碗巾, 3 条装', '29.9']]);
    expect(parsed.rowNumbers).toEqual([2]);
  });

  it('rejects an empty CSV', () => {
    expect(() => parseCsv('')).toThrow(ImportError);
  });

  it('parses an xlsx workbook and skips empty rows', async () => {
    const bytes = await makeXlsx([
      ['名称', 'SKU', '价格', '库存'],
      ['洗碗巾', 'QH-001', 29.9, 5],
      [],
      ['收纳箱', 'QH-003', 49.9, 8],
    ]);
    const parsed = await parseXlsx(bytes);
    expect(parsed.headers).toEqual(['名称', 'SKU', '价格', '库存']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rowNumbers).toEqual([2, 4]);
  });

  it('rejects non-xlsx bytes with an ImportError', async () => {
    await expect(parseXlsx(new TextEncoder().encode('not a workbook'))).rejects.toBeInstanceOf(
      ImportError,
    );
  });
});

describe('importProducts', () => {
  it('inserts CSV rows and reports counts', () => {
    const db = setup();
    const parsed = parseCsv(
      [
        '名称,SKU,分类,价格,库存,描述,卖点,图片,链接',
        '洗碗巾,QH-100,厨房,29.9,10,好用,吸水,https://img.example.com/a.png,https://shop.example.com/a',
        '收纳箱,QH-101,收纳,49.9,5,加厚,省空间,,',
      ].join('\n'),
    );
    const result = importProducts(db, parsed);
    expect(result).toMatchObject({ created: 2, updated: 0, failed: 0, total: 2 });

    const product = getProductBySku(db, 'QH-100')!;
    expect(product).toMatchObject({
      name: '洗碗巾',
      category: '厨房',
      price: 29.9,
      stock: 10,
      imageUrl: 'https://img.example.com/a.png',
      url: 'https://shop.example.com/a',
    });
  });

  it('upserts by SKU', () => {
    const db = setup();
    createProduct(db, { sku: 'QH-200', name: '旧名称', price: 10 });

    const result = importProducts(
      db,
      parseCsv('name,sku,price\n新名称,QH-200,19.9\n全新商品,QH-201,5\n'),
    );
    expect(result).toMatchObject({ created: 1, updated: 1, failed: 0 });
    expect(getProductBySku(db, 'QH-200')!.name).toBe('新名称');
    expect(getProductBySku(db, 'QH-200')!.price).toBe(19.9);
    expect(listProducts(db)).toHaveLength(2);
  });

  it('collects per-row errors without aborting', () => {
    const db = setup();
    const parsed = parseCsv(
      [
        'name,sku,price,stock,image',
        '好的,QH-300,29.9,1,',
        ',QH-301,10,1,',
        '坏价格,QH-302,abc,1,',
        '坏库存,QH-303,10,1.5,',
        '坏链接,QH-304,10,1,javascript:alert(1)',
      ].join('\n'),
    );
    const result = importProducts(db, parsed);
    expect(result).toMatchObject({ created: 1, updated: 0, failed: 4, total: 5 });
    expect(result.errors.map((error) => error.row)).toEqual([3, 4, 5, 6]);
    expect(getProductBySku(db, 'QH-300')).not.toBeNull();
    expect(getProductBySku(db, 'QH-302')).toBeNull();
  });

  it('requires a name column', () => {
    const db = setup();
    expect(() => importProducts(db, parseCsv('sku,price\nQH-1,10\n'))).toThrow(
      /Missing name column/,
    );
  });

  it('supports dry runs without writing', () => {
    const db = setup();
    createProduct(db, { sku: 'QH-400', name: 'existing' });
    const result = importProducts(
      db,
      parseCsv('name,sku\nupdated,QH-400\nnew,QH-401\n'),
      { dryRun: true },
    );
    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(getProductBySku(db, 'QH-401')).toBeNull();
  });

  it('parses enabled/disabled status aliases', () => {
    const db = setup();
    importProducts(
      db,
      parseCsv('name,sku,enabled\n上架商品,QH-500,是\n下架商品,QH-501,停用\n'),
    );
    expect(getProductBySku(db, 'QH-500')!.enabled).toBe(true);
    expect(getProductBySku(db, 'QH-501')!.enabled).toBe(false);
  });

  it('rejects files with more than the row limit', () => {
    const db = setup();
    const rows = ['name,sku'];
    for (let i = 0; i <= MAX_IMPORT_ROWS; i += 1) rows.push(`p${i},S${i}`);
    const parsed = parseCsv(rows.join('\n'));
    expect(() => importProducts(db, parsed)).toThrow(/5000/);
  });
});

describe('importProductsFromFile', () => {
  it('imports xlsx uploads', async () => {
    const db = setup();
    const bytes = await makeXlsx([
      ['名称', 'SKU', '价格', '库存'],
      ['山茶花洗护套装', 'QH-600', 89, 12],
    ]);
    const result = await importProductsFromFile(db, 'products.xlsx', bytes);
    expect(result).toMatchObject({ created: 1, failed: 0 });
    expect(getProductBySku(db, 'QH-600')!.price).toBe(89);
  });

  it('imports CSV uploads with a BOM', async () => {
    const db = setup();
    const bytes = new TextEncoder().encode('﻿名称,SKU,价格\n折叠箱,QH-700,49.9\n');
    const result = await importProductsFromFile(db, 'products.csv', bytes);
    expect(result.created).toBe(1);
  });

  it('rejects oversized and empty files', async () => {
    const db = setup();
    await expect(
      importProductsFromFile(db, 'big.csv', new Uint8Array(MAX_IMPORT_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'file_too_large' });
    await expect(
      importProductsFromFile(db, 'empty.csv', new Uint8Array()),
    ).rejects.toMatchObject({ code: 'invalid_file' });
  });
});

describe('csvTemplate', () => {
  it('round-trips through the importer', () => {
    const db = setup();
    const template = csvTemplate();
    expect(template.startsWith('﻿')).toBe(true);
    const parsed = parseCsv(template.slice(1));
    const result = importProducts(db, parsed);
    expect(result.created).toBe(1);
    expect(getProductBySku(db, 'QH-001')).not.toBeNull();
  });
});
