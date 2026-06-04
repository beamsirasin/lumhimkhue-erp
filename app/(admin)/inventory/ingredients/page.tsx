import { redirect } from 'next/navigation';
import { IngredientsPage } from '@/components/admin/IngredientsPage';
import { getIngredientPageData } from '@/lib/actions/inventory';

export const metadata = { title: 'วัตถุดิบ — ร้านชาบู ERP' };

export default async function InventoryIngredientsPage() {
  const result = await getIngredientPageData();
  if (!result.ok) redirect('/dashboard');
  return (
    <IngredientsPage
      initialData={result.data}
      initialDataUpdatedAt={Date.now()}
    />
  );
}
