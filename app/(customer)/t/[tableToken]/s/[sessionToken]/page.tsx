import { notFound } from 'next/navigation';
import { getSessionData, getMenuCategories } from '@/lib/actions/orders';
import { CustomerMenuPage } from '@/components/customer/CustomerMenuPage';

interface Props {
  params: Promise<{ tableToken: string; sessionToken: string }>;
}

export default async function CustomerOrderPage({ params }: Props) {
  const { tableToken, sessionToken } = await params;

  const [sessionResult, menuResult] = await Promise.all([
    getSessionData(tableToken, sessionToken),
    getMenuCategories(),
  ]);

  if (!sessionResult.ok || !menuResult.ok) notFound();

  return (
    <CustomerMenuPage
      sessionData={sessionResult.data}
      categories={menuResult.data}
      sessionToken={sessionToken}
    />
  );
}
