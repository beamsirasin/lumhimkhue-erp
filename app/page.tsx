import { auth } from '@/auth';
import { redirect } from 'next/navigation';

const roleHome: Record<string, string> = {
  owner: '/dashboard',
  manager: '/dashboard',
  cashier: '/pos',
  kitchen: '/kds',
  host: '/queue',
};

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  redirect(roleHome[session.user.role] ?? '/pos');
}
