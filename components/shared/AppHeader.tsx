import Link from 'next/link';
import { auth, signOut } from '@/auth';

const roleLabel: Record<string, string> = {
  owner: 'เจ้าของร้าน',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

export async function AppHeader() {
  const session = await auth();
  if (!session?.user) return null;

  const { name, role } = session.user;

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-sm font-medium text-slate-900 hover:text-slate-700"
        >
          ร้านชาบู ERP
        </Link>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium leading-tight text-slate-900">{name}</p>
            <p className="text-xs leading-tight text-slate-500">
              {roleLabel[role] ?? role}
            </p>
          </div>

          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button
              type="submit"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              ออกจากระบบ
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
