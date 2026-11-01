import type { DB } from './db';
import { createKbEntry, createProduct, listKbEntries, listProducts } from './db';

export interface SeedResult {
  kbInserted: number;
  productsInserted: number;
}

const SAMPLE_KB = [
  {
    type: 'shop_info' as const,
    title: '店铺信息',
    content:
      '青禾生活馆是一家专注家居日用与天然洗护的零售店。营业时间：每天 9:00–21:00。客服在线时间：9:00–21:00。联系电话：400-000-0000（示例）。',
    keywords: '店铺 营业时间 客服 联系 电话 shop info',
  },
  {
    type: 'policy' as const,
    title: '退换货政策',
    content:
      '签收后 7 天内，商品未拆封且不影响二次销售可申请无理由退货；质量问题 15 天内可换货。退货运费由买家承担，质量问题由本店承担。生鲜与贴身用品不支持无理由退货。',
    keywords: '退货 换货 退款 售后 7天 15天 return refund',
  },
  {
    type: 'policy' as const,
    title: '物流与配送',
    content:
      '默认使用中通/圆通快递，下单后 48 小时内发货。江浙沪一般 1–2 天送达，其他地区 3–5 天。偏远地区（新疆、西藏、内蒙古部分区域）可能延迟。满 99 元包邮，未满收取 8 元运费。',
    keywords: '物流 快递 发货 配送 包邮 运费 shipping delivery',
  },
  {
    type: 'faq' as const,
    title: '如何联系人工客服？',
    content:
      '您可以在聊天中直接回复“人工”，客服会在营业时间内尽快接入；也可拨打 400-000-0000。',
    keywords: '人工 客服 转人工 human agent',
  },
  {
    type: 'faq' as const,
    title: '支持哪些支付方式？',
    content: '支持微信支付、支付宝与银行卡支付，暂不支持货到付款。',
    keywords: '支付 付款 微信 支付宝 payment',
  },
];

const SAMPLE_PRODUCTS = [
  {
    sku: 'QH-001',
    name: '青禾竹纤维洗碗巾（3 条装）',
    category: '厨房清洁',
    price: 29.9,
    stock: 320,
    description: '天然竹纤维材质，吸水快、不易掉毛，可反复清洗使用。',
    sellingPoints: '吸油不挂油；可机洗；3 条装更划算',
  },
  {
    sku: 'QH-002',
    name: '青禾山茶花洗护套装',
    category: '洗护',
    price: 89.0,
    stock: 150,
    description: '山茶花精粹洗发水 500ml + 护发素 300ml，温和清洁，适合日常使用。',
    sellingPoints: '温和配方；淡淡山茶花香；大容量',
  },
  {
    sku: 'QH-003',
    name: '青禾折叠收纳箱 45L',
    category: '收纳',
    price: 49.9,
    stock: 80,
    description: '可折叠设计，承重 15kg，适合衣物与杂物收纳。',
    sellingPoints: '不用时折叠省空间；加厚箱体；带盖防尘',
  },
];

/** Inserts sample KB entries and products. Idempotent for KB by title, products by SKU. */
export function seedSampleData(db: DB): SeedResult {
  let kbInserted = 0;
  let productsInserted = 0;

  const existingKb = new Set(listKbEntries(db).map((entry) => entry.title));
  for (const entry of SAMPLE_KB) {
    if (existingKb.has(entry.title)) continue;
    createKbEntry(db, entry);
    kbInserted += 1;
  }

  const existingSkus = new Set(
    listProducts(db)
      .map((product) => product.sku)
      .filter((sku): sku is string => Boolean(sku)),
  );
  for (const product of SAMPLE_PRODUCTS) {
    if (existingSkus.has(product.sku)) continue;
    createProduct(db, product);
    productsInserted += 1;
  }

  return { kbInserted, productsInserted };
}
