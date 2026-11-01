import { getRequestTranslator } from '@/lib/i18n/server';
import { PageHeader } from '@/components/admin/page-header';
import { ProductsManager } from '@/components/admin/products-manager';

export const dynamic = 'force-dynamic';

export default function ProductsPage() {
  const t = getRequestTranslator();

  return (
    <div className="space-y-6">
      <PageHeader title={t('products.title')} subtitle={t('products.subtitle')} />
      <ProductsManager
        labels={{
          newProduct: t('products.new'),
          editProduct: t('products.edit'),
          searchPlaceholder: t('products.searchPlaceholder'),
          empty: t('products.empty'),
          emptyHint: t('products.emptyHint'),
          name: t('products.name'),
          sku: t('products.sku'),
          category: t('products.category'),
          price: t('products.price'),
          stock: t('products.stock'),
          description: t('products.description'),
          sellingPoints: t('products.sellingPoints'),
          imageUrl: t('products.imageUrl'),
          url: t('products.url'),
          enabledHint: t('products.enabledHint'),
          deleteConfirm: t('products.deleteConfirm'),
          importLabel: t('products.import'),
          importing: t('products.importing'),
          importHint: t('products.importHint'),
          importResult: t('products.importResult'),
          importErrors: t('products.importErrors'),
          row: t('products.row'),
          downloadTemplate: t('products.downloadTemplate'),
          invalidUrl: t('products.invalidUrl'),
          count: t('products.count'),
          loadFailed: t('products.loadFailed'),
          error: t('common.error'),
          save: t('common.save'),
          saving: t('common.saving'),
          cancel: t('common.cancel'),
          delete: t('common.delete'),
          edit: t('common.edit'),
          enabled: t('common.enabled'),
          disabled: t('common.disabled'),
          status: t('products.status'),
          product: t('products.product'),
        }}
      />
    </div>
  );
}
