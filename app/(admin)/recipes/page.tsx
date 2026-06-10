import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/permissions';
import { getMenuItemCostMatrix, getIngredientsForRecipe } from '@/lib/actions/recipes';
import { RecipesPage } from '@/components/admin/RecipesPage';

export default async function RecipesPageRoute() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'recipe:manage')) redirect('/login');

  const [matrixRes, ingredientsRes] = await Promise.all([
    getMenuItemCostMatrix(),
    getIngredientsForRecipe(),
  ]);

  if (!matrixRes.ok || !ingredientsRes.ok) {
    return <div className="p-6 text-sm text-red-600">เกิดข้อผิดพลาด</div>;
  }

  return (
    <RecipesPage
      initialMatrix={matrixRes.data}
      allIngredients={ingredientsRes.data}
    />
  );
}
